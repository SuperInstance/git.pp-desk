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
  setRoot,
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

/** What one refresh did — the desk's refresh economics, made observable. */
export interface RefreshResult {
  digest: string | null;
  /** Checkpoint-v2 set root over the held records (see digest.ts). */
  root: string | null;
  updatedAt: string | null;
  /** True when the repo manifest proved nothing moved and the record
   * documents were NOT re-read. */
  skipped: boolean;
  /** Desk→Worker HTTP calls this refresh made (1 = manifest only). */
  apiCalls: number;
  /** Project repos whose `updatedAt` moved since the last full read
   * (all of them, on a cold desk). */
  changedRepos: string[];
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
  /** sha256 over the canonical JSON of `state` — pins what was derived. */
  digest: string | null;
  /**
   * Checkpoint-v2 set root over the held records — pins what the state
   * was derived FROM (every held record's id + whole content). The
   * state digest alone cannot distinguish two record sets that leave
   * the same state behind; the root can.
   */
  root: string | null;
  updatedAt: string | null;
  /** The captain's five lines, digest.py's shape. */
  lines: string[];
  /**
   * Operational (not record) state: the per-repo `updatedAt` manifest
   * from the last full read — the etag sheet the refresh gate compares
   * against — and the refresh counters. Like `updatedAt`, these are
   * facts about the desk's own activity, kept honest by the burn: a
   * rebuilt desk re-reads and re-earns them.
   */
  repoManifest: { [repo: string]: string | null } | null;
  refreshStats: {
    ticks: number;
    skippedTicks: number;
    lastApiCalls: number;
    lastSkipped: boolean;
    lastChangedRepos: string[];
  };
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
  root: null,
  updatedAt: null,
  lines: [],
  repoManifest: null,
  refreshStats: {
    ticks: 0,
    skippedTicks: 0,
    lastApiCalls: 0,
    lastSkipped: false,
    lastChangedRepos: [],
  },
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
   * refresh() — the desk's only input path, now manifest-gated.
   *
   * Step 1 is the etag sheet: GET /api/repos returns every repo's
   * `updatedAt` (the same manifest the git.pp Worker's own delta
   * reads key on). Filtered to this project's repos (the project repo
   * plus its `<project>--*` task repos — the Worker's own matching
   * rule), it is compared with the manifest stored at the last full
   * read. If nothing moved and the desk already holds a projection,
   * the record documents are NOT re-read: the tick cost is the one
   * manifest call. (The trust assumption is the etag assumption, the
   * same one the Worker's delta reads make: a repo's `updatedAt`
   * advances whenever its record changes. Anything the manifest
   * cannot prove — a changed, added, or removed repo — falls through
   * to the full read.)
   *
   * Step 2 (anything moved, cold desk, or `force`) is the original
   * read: the record's two public documents (/api/state +
   * /api/records — both credential-free, like every reader of git.pp),
   * folded into the projection and stored. setState broadcasts the
   * new projection to every connected chair automatically.
   */
  @callable()
  async refresh(opts?: { force?: boolean }): Promise<RefreshResult> {
    const project = this.name;
    const base = deskConfig.source.replace(/\/$/, "");
    let apiCalls = 0;

    const reposRes = await fetch(`${base}/api/repos`);
    apiCalls++;
    if (!reposRes.ok) {
      throw new Error(`manifest read failed for ${project}: repos=${reposRes.status}`);
    }
    const reposDoc = (await reposRes.json()) as {
      repos?: { name?: unknown; updatedAt?: unknown }[];
    };
    const manifest: { [repo: string]: string | null } = {};
    for (const r of reposDoc.repos ?? []) {
      const name = typeof r?.name === "string" ? r.name : null;
      if (name && (name === project || name.startsWith(project + "--"))) {
        manifest[name] = typeof r.updatedAt === "string" ? r.updatedAt : null;
      }
    }
    // State-shape migration: an instance warmed under v1 holds a
    // state with no repoManifest / refreshStats / root at all (the
    // fields are absent, not null). Durable Object code deploys do
    // not migrate stored state, so every v2 field is read through a
    // default; the first successful refresh stores the full shape.
    const prev = this.state.repoManifest ?? null;
    const changed = (
      prev === null
        ? Object.keys(manifest)
        : [...new Set([...Object.keys(manifest), ...Object.keys(prev)])].filter(
            (n) => manifest[n] !== prev[n],
          )
    ).sort();
    const prevStats = this.state.refreshStats ?? EMPTY.refreshStats;
    const stats = {
      ticks: prevStats.ticks + 1,
      skippedTicks: prevStats.skippedTicks,
      lastApiCalls: apiCalls,
      lastSkipped: false,
      lastChangedRepos: changed,
    };

    if (!opts?.force && this.state.ready && prev !== null && changed.length === 0) {
      stats.skippedTicks++;
      stats.lastSkipped = true;
      this.setState({ ...this.state, repoManifest: manifest, refreshStats: stats });
      return {
        digest: this.state.digest,
        root: this.state.root ?? null,
        updatedAt: this.state.updatedAt,
        skipped: true,
        apiCalls,
        changedRepos: changed,
      };
    }

    const [stateRes, recordsRes] = await Promise.all([
      fetch(`${base}/api/state?project=${encodeURIComponent(project)}`),
      fetch(`${base}/api/records?project=${encodeURIComponent(project)}`),
    ]);
    apiCalls += 2;
    if (!stateRes.ok || !recordsRes.ok) {
      throw new Error(
        `record read failed for ${project}: state=${stateRes.status} records=${recordsRes.status}`,
      );
    }
    const stateDoc = (await stateRes.json()) as StateDoc;
    const recordsDoc = (await recordsRes.json()) as RecordsDoc;

    const digest = await stateDigest(stateDoc.state);
    const root = setRoot(recordsDoc.records);
    const witnesses = recordsDoc.records
      .filter((r) => r.kind === "witness")
      .map((r) => ({ id: r.id, recordsBehind: r.recordsBehind ?? null }));
    stats.lastApiCalls = apiCalls;

    this.setState({
      project,
      ready: true,
      state: stateDoc.state,
      conflicts: stateDoc.conflicts ?? [],
      witnesses,
      records: recordsDoc.records,
      order: stateDoc.order ?? [],
      digest,
      root,
      updatedAt: new Date().toISOString(),
      lines: digestLines(project, stateDoc, recordsDoc),
      repoManifest: manifest,
      refreshStats: stats,
    });
    return {
      digest,
      root,
      updatedAt: this.state.updatedAt,
      skipped: false,
      apiCalls,
      changedRepos: changed,
    };
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
   * come back different. (The nuclear form — destroyInstance() below —
   * drops the whole Durable Object, schedules and all; the drill here
   * is about the store, so the projection is what burns.)
   */
  @callable()
  async burn(): Promise<{ burnedDigest: string | null; burnedRoot: string | null }> {
    const burnedDigest = this.state.digest;
    const burnedRoot = this.state.root ?? null;
    this.setState({ ...EMPTY, project: this.name });
    return { burnedDigest, burnedRoot };
  }

  /**
   * rebuild() — a FORCED refresh from the record alone, after a burn
   * (the manifest gate is bypassed: a rebuilt desk must re-earn its
   * manifest, not trust a remembered one). The beauty test on the
   * page compares digest AND root with the pre-burn pair: both
   * identical means the desk was only ever a projection.
   */
  @callable()
  async rebuild(): Promise<RefreshResult> {
    return this.refresh({ force: true });
  }

  /**
   * destroyInstance() — the fit note's deciding test in its nuclear
   * form: this.destroy() drops the whole Durable Object — every
   * table (the projection, the manifest, the counters), the alarm,
   * all storage. Nothing here is the truth, so nothing here is worth
   * protecting from this button; the record is elsewhere. The destroy
   * is deferred to a one-second schedule so this reply lands first
   * (destroy() aborts the isolate; the SDK's own guidance is to treat
   * it as fire-and-forget). After it fires, the next touch wakes a
   * fresh instance under the same name: onStart re-registers the
   * cadence, and the cadence rebuilds the projection from the record.
   * If that sentence ever stops being true, this drill is how we find
   * out — it is the desk's whole thesis, run against the platform.
   */
  @callable()
  async destroyInstance(): Promise<{ destroying: string; inSeconds: number }> {
    await this.schedule(1, "doDestroy");
    return { destroying: this.name, inSeconds: 1 };
  }

  /** The deferred destroy, run by the alarm with its own budget. */
  async doDestroy() {
    await this.destroy();
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
    // Same callables, same boundary: read/draft/burn/rebuild/destroy
    // only — every one of them acts on the desk, never on the record.
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
          case "destroy":
            return Response.json(await stub.destroyInstance());
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
