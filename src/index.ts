/**
 * index.ts — the Desk: git.pp's captain's surface as a Cloudflare Agent.
 *
 * THE IDEA, IN ONE PARAGRAPH
 * git.pp keeps truth in an append-only record of task/witness/override
 * records, held as plain Git in Cloudflare Artifacts; state is DERIVED
 * by a deterministic fold, never stored. This worker is the "desk" the
 * research note (cloudflare-agents-fit.md) argued for: a per-project
 * Agent (a Durable Object) that holds a PROJECTION of that record —
 * derived state, conflicts, witness staleness, a digest — and serves
 * it live over WebSockets, refreshing on a cadence. The verdict it
 * implements is "adopt as projection": the desk may be warm, stateful
 * and always-on, but everything it holds must be re-derivable from
 * the record alone. The burn/rebuild drill below is that property,
 * made push-button: burn the desk's store, rebuild from the record,
 * and the digest must come back identical.
 *
 * THE BOUNDARY (what may and may not live here)
 *   MAY:  fold output + the records it was folded from (a cache of a
 *         pure function), the digest, the refresh cadence's alarm.
 *   MAY NOT: decisions, rulings, drafts that matter, learned defaults
 *         — anything another agent must see or the captain has decided
 *         belongs in the record as a record. Accordingly the Desk
 *         NEVER WRITES: there is no admin key in this worker, no
 *         Artifacts binding, no path from here to a push. The one
 *         gesture that looks like a write — draftOverride — returns a
 *         record JSON for the captain's own tooling (pp.py) to check
 *         and push. The desk is a view and a pen that only drafts;
 *         the record is the vault.
 *
 * CADENCE: desk.json (committed beside this code) declares the source
 * worker, the projects, and the refresh interval; onStart registers
 * it as a schedule. Spike simplification, stated plainly: the full
 * design declares cadences IN the record (a declaration record, like
 * every other default in the scoped cascade) and re-registers them on
 * wake; here the declaration lives in the repo we ship from. The
 * shape is the same — the alarm is the desk's, the intent is written
 * down somewhere the desk does not own.
 */

import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import deskConfig from "../desk.json";
import {
  digestLines,
  frontier,
  resolveKey,
  stateDigest,
  type Conflict,
  type Rec,
  type RecordsDoc,
  type StateDoc,
} from "./digest";
import { PAGE } from "./page";

export interface Env {
  DESK: DurableObjectNamespace<Desk>;
}

/** Everything the Desk holds. A pure function of the record, cached. */
export interface DeskState {
  project: string;
  ready: boolean;
  state: Record<string, unknown>;
  conflicts: Conflict[];
  witnesses: { id: string; recordsBehind: number | null }[];
  records: Rec[];
  order: string[];
  /** sha256 over the canonical JSON of `state` — spike-grade pin. */
  digest: string | null;
  updatedAt: string | null;
  /** The captain's five lines, digest.py's shape. */
  lines: string[];
}

const EMPTY: DeskState = {
  project: "",
  ready: false,
  state: {},
  conflicts: [],
  witnesses: [],
  records: [],
  order: [],
  digest: null,
  updatedAt: null,
  lines: [],
};

export class Desk extends Agent<Env, DeskState> {
  initialState: DeskState = EMPTY;

  /**
   * On every wake: make sure the refresh cadence from desk.json is
   * registered as a schedule. (Schedules persist in the agent's own
   * SQLite, so this is a no-op after the first wake — the check keeps
   * onStart honest after a cadence change ships.)
   */
  async onStart() {
    const seconds = deskConfig.refreshSeconds ?? 60;
    const existing = await this.getSchedules();
    if (!existing.some((s) => s.type === "interval")) {
      await this.scheduleEvery(seconds, "tick");
    }
  }

  /** The scheduled heartbeat: re-derive the projection from the record. */
  async tick() {
    await this.refresh();
  }

  /**
   * refresh() — the desk's only input path. Fetch the record's two
   * public documents (/api/state + /api/records — both credential-free,
   * like every reader of git.pp), fold nothing ourselves beyond what
   * the projection needs, and store the result. setState broadcasts
   * the new projection to every connected chair automatically.
   */
  @callable()
  async refresh(): Promise<{ digest: string | null; updatedAt: string | null }> {
    const project = this.name;
    const base = deskConfig.source.replace(/\/$/, "");
    const [stateRes, recordsRes] = await Promise.all([
      fetch(`${base}/api/state?project=${encodeURIComponent(project)}`),
      fetch(`${base}/api/records?project=${encodeURIComponent(project)}`),
    ]);
    if (!stateRes.ok || !recordsRes.ok) {
      throw new Error(
        `record read failed for ${project}: state=${stateRes.status} records=${recordsRes.status}`,
      );
    }
    const stateDoc = (await stateRes.json()) as StateDoc;
    const recordsDoc = (await recordsRes.json()) as RecordsDoc;

    const digest = await stateDigest(stateDoc.state);
    const witnesses = recordsDoc.records
      .filter((r) => r.kind === "witness")
      .map((r) => ({ id: r.id, recordsBehind: r.recordsBehind ?? null }));

    this.setState({
      project,
      ready: true,
      state: stateDoc.state,
      conflicts: stateDoc.conflicts ?? [],
      witnesses,
      records: recordsDoc.records,
      order: stateDoc.order ?? [],
      digest,
      updatedAt: new Date().toISOString(),
      lines: digestLines(project, stateDoc, recordsDoc),
    });
    return { digest, updatedAt: this.state.updatedAt };
  }

  /** The current projection, as held. */
  @callable()
  async status(): Promise<DeskState> {
    return this.state;
  }

  /**
   * why(key) — the chair's first gesture: read why. Replays DESIGN §2
   * over the records the desk holds (class, maximality, cleanest
   * chain) and returns the winner, the preserved losers, and the
   * ancestry counts that elected them. If the desk is cold it
   * refreshes first — an explanation must never be served from an
   * empty cache and mistaken for the record's silence.
   */
  @callable()
  async why(key: string) {
    if (!this.state.ready) await this.refresh();
    const res = resolveKey(this.state.records, key);
    if (!res) {
      return {
        key,
        contested: false,
        note: "No conflict on this key in the record the desk holds — either uncontested (a single value among applied records) or absent.",
      };
    }
    return { contested: true, ...res };
  }

  /**
   * draftOverride(key, recordId, reason) — the chair's second gesture,
   * deliberately defanged: it DRAFTS the captain's ruling as a
   * pp.py-ready override record and hands it back. Nothing is pushed;
   * the desk has no key and no write path. The draft re-asserts the
   * key's current standing value under the captain's reason ("rule
   * for the winner"); to promote a loser instead, edit the effect
   * before pushing — the captain's tooling, not the desk, makes that
   * call. Parents = the current frontier, so the ruling descends from
   * everything presently standing in the record.
   */
  @callable()
  async draftOverride(key: string, recordId: string, reason: string) {
    if (!this.state.ready) await this.refresh();
    if (!(key in this.state.state)) {
      return {
        drafted: false,
        note: `Key "${key}" is not in the derived state — there is no standing value to rule for.`,
      };
    }
    return {
      drafted: true,
      note: "Draft only — the desk never writes. Push with the captain's tooling (pp.py) after checking it.",
      record: {
        id: recordId,
        kind: "override",
        parents: frontier(this.state.records, this.state.order),
        effects: { [key]: this.state.state[key] },
        reason: reason || "captain's ruling (drafted at the desk)",
      },
    };
  }

  /**
   * burn() — wipe the desk's stored projection entirely. This is the
   * fit note's deciding test, operationalised: if anything the
   * captain would notice lived ONLY here, the rebuild below would
   * come back different. (The nuclear form, this.destroy(), would
   * also drop the instance's schedules and name; the drill here is
   * about the store, so the projection is what burns.)
   */
  @callable()
  async burn(): Promise<{ burnedDigest: string | null }> {
    const burnedDigest = this.state.digest;
    this.setState({ ...EMPTY, project: this.name });
    return { burnedDigest };
  }

  /**
   * rebuild() — refresh() from the record alone, after a burn. The
   * beauty test on the page compares this digest with the pre-burn
   * one: identical means the desk was only ever a projection.
   */
  @callable()
  async rebuild(): Promise<{ digest: string | null; updatedAt: string | null }> {
    return this.refresh();
  }
}

/* ------------------------------------------------------------------ */
/* Worker front door                                                   */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The chair itself: one page, served by the Worker.
    if (url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // A small HTTP proxy over the agent, so the desk can be driven
    // (and playtested) with curl as well as from the page's socket.
    // Same callables, same boundary: read/draft/burn/rebuild only.
    if (url.pathname === "/api/desk") {
      const project = url.searchParams.get("project") ?? deskConfig.projects[0];
      const action = url.searchParams.get("action") ?? "status";
      const stub = await getAgentByName(env.DESK, project);
      try {
        switch (action) {
          case "status":
            return Response.json(await stub.status());
          case "refresh":
            return Response.json(await stub.refresh());
          case "why":
            return Response.json(await stub.why(url.searchParams.get("key") ?? ""));
          case "draft":
            return Response.json(
              await stub.draftOverride(
                url.searchParams.get("key") ?? "",
                url.searchParams.get("id") ?? "",
                url.searchParams.get("reason") ?? "",
              ),
            );
          case "burn":
            return Response.json(await stub.burn());
          case "rebuild":
            return Response.json(await stub.rebuild());
          default:
            return Response.json({ error: `unknown action ${action}` }, { status: 400 });
        }
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 502 },
        );
      }
    }

    // WebSocket + HTTP access to the agents themselves
    // (/agents/desk/<project>).
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("not found", { status: 404 });
  },
};
