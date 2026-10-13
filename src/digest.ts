/**
 * digest.ts — the projection logic of the Desk.
 *
 * Everything in this file is a PURE function over the record: the same
 * records in, the same projection out, no clocks, no storage, no I/O.
 * That purity is the whole architectural claim of git.pp — state is
 * what completed tasks leave behind, derived by a deterministic fold,
 * never stored as truth. The Desk (src/index.ts) keeps the OUTPUT of
 * these functions in a Durable Object as a conven­ience cache; if the
 * cache and this code ever disagree with a fresh run over the live
 * record, the record wins and the cache is rebuilt. (That rebuild is
 * the burn/rebuild drill on the page.)
 *
 * The resolution replay below mirrors DESIGN §2 of the git.pp
 * submission repo and the referee pattern in toolkit/digest.py:
 *
 *   1. Class precedence — override > task > witness, absolute.
 *   2. Exact maximality — a candidate is dominated iff it is a
 *      transitive ancestor of ANY other candidate in its class pool.
 *   3. Cleanest chain — most intent ancestors (task/override), then
 *      fewest witness ancestors, then smallest record id.
 *
 * Ancestry is always the FULL transitive closure: cleanliness is
 * defined over the whole chain, and a shallower count would let this
 * projection disagree with the fold it reports on.
 */

export interface Rec {
  id: string;
  repo?: string;
  kind: "task" | "witness" | "override" | string;
  parents: string[];
  effects: Record<string, unknown>;
  reason?: string;
  orphan?: boolean;
  recordsBehind?: number | null;
}

export interface Conflict {
  key: string;
  winner: string;
  losers: string[];
}

export interface StateDoc {
  state: Record<string, unknown>;
  order: string[];
  conflicts: Conflict[];
  orphans: string[];
}

export interface RecordsDoc {
  project: string;
  count: number;
  records: Rec[];
}

/** Class precedence, DESIGN §2 step 1. */
const CLASS_RANK: Record<string, number> = { override: 3, task: 2, witness: 1 };
/** Kinds whose ancestry lends a chain "intent" (cleanliness, step 3). */
const INTENT_KINDS = new Set(["task", "override"]);

const MAXLEN = 140;

/* ------------------------------------------------------------------ */
/* Canonical form + digest                                             */
/* ------------------------------------------------------------------ */

/**
 * Canonical JSON: object keys sorted recursively, arrays in order,
 * compact separators. This is the byte string the Desk's digest is
 * taken over — the same canonicalisation discipline the git.pp fold
 * pins for its checkpoints, at spike grade: it covers the state
 * object only, not (yet) the closure of records behind it.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/** sha256 hex over the canonical form of the derived state. */
export async function stateDigest(state: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(state));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Ancestry                                                            */
/* ------------------------------------------------------------------ */

export interface Graph {
  byId: Map<string, Rec>;
  ancestors: (id: string) => Set<string>;
  cleanliness: (id: string) => { intent: number; witness: number };
}

export function buildGraph(records: Rec[]): Graph {
  const byId = new Map(records.map((r) => [r.id, r]));
  const cache = new Map<string, Set<string>>();

  function ancestors(id: string): Set<string> {
    const hit = cache.get(id);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [...(byId.get(id)?.parents ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x) || !byId.has(x)) continue;
      seen.add(x);
      stack.push(...(byId.get(x)?.parents ?? []));
    }
    cache.set(id, seen);
    return seen;
  }

  function cleanliness(id: string) {
    let intent = 0;
    let witness = 0;
    for (const a of ancestors(id)) {
      const kind = byId.get(a)?.kind;
      if (kind && INTENT_KINDS.has(kind)) intent++;
      else if (kind === "witness") witness++;
    }
    return { intent, witness };
  }

  return { byId, ancestors, cleanliness };
}

/* ------------------------------------------------------------------ */
/* DESIGN §2 replay — why a key resolved the way it did                */
/* ------------------------------------------------------------------ */

export interface CandidateInfo {
  id: string;
  kind: string;
  value: unknown;
  reason?: string;
  maximal: boolean;
  intentAncestors: number;
  witnessAncestors: number;
}

export interface Resolution {
  key: string;
  winner: CandidateInfo;
  losers: CandidateInfo[];
  /** Which step of §2 actually decided: class | maximality | cleanest-chain | smallest-id. */
  decidedBy: "class" | "maximality" | "cleanest-chain" | "smallest-id";
  explanation: string;
}

/**
 * Replay the fold's resolution rule for one key over the records.
 * Used by the Desk's why() — the chair's "read why" gesture from
 * IDEATION-GLM: a captain should never have to take a winner on faith
 * when the ancestry that elected it is sitting in the record.
 */
export function resolveKey(records: Rec[], key: string): Resolution | null {
  const graph = buildGraph(records);
  const cands = records.filter(
    (r) => !r.orphan && Object.prototype.hasOwnProperty.call(r.effects ?? {}, key),
  );
  if (cands.length < 2) return null;
  const distinct = new Set(cands.map((c) => canonical(c.effects[key])));
  if (distinct.size < 2) return null; // same value everywhere: no conflict

  const info = (r: Rec, maximal: boolean): CandidateInfo => {
    const cl = graph.cleanliness(r.id);
    return {
      id: r.id,
      kind: r.kind,
      value: r.effects[key],
      reason: r.reason,
      maximal,
      intentAncestors: cl.intent,
      witnessAncestors: cl.witness,
    };
  };

  // Step 1 — class precedence: only the strongest class present competes.
  const top = Math.max(...cands.map((c) => CLASS_RANK[c.kind] ?? 0));
  const pool = cands.filter((c) => (CLASS_RANK[c.kind] ?? 0) === top);
  const weaker = cands.filter((c) => (CLASS_RANK[c.kind] ?? 0) !== top);

  // Step 2 — exact maximality within the pool.
  const maximal = pool.filter(
    (c) => !pool.some((o) => o !== c && graph.ancestors(o.id).has(c.id)),
  );
  const dominated = pool.filter((c) => !maximal.includes(c));

  // Step 3 — cleanest chain, then smallest id.
  const byCleanliness = [...maximal].sort((a, b) => {
    const ca = graph.cleanliness(a.id);
    const cb = graph.cleanliness(b.id);
    if (cb.intent !== ca.intent) return cb.intent - ca.intent;
    if (ca.witness !== cb.witness) return ca.witness - cb.witness;
    return a.id < b.id ? -1 : 1;
  });
  const winner = byCleanliness[0];

  let decidedBy: Resolution["decidedBy"];
  if (weaker.length > 0) decidedBy = "class";
  else if (maximal.length === 1) decidedBy = "maximality";
  else {
    const w = graph.cleanliness(winner.id);
    const tied = byCleanliness.some(
      (o) =>
        o !== winner &&
        graph.cleanliness(o.id).intent === w.intent &&
        graph.cleanliness(o.id).witness === w.witness,
    );
    decidedBy = tied ? "smallest-id" : "cleanest-chain";
  }

  const winnerInfo = info(winner, true);
  const losers = [
    ...dominated.map((r) => info(r, false)),
    ...maximal.filter((r) => r !== winner).map((r) => info(r, true)),
    ...weaker.map((r) => info(r, false)),
  ];

  const wv = JSON.stringify(winner.effects[key]);
  let explanation: string;
  switch (decidedBy) {
    case "class":
      explanation =
        `${winner.id} wins ${key}=${wv} on class precedence: a ${winner.kind} record ` +
        `outranks every rival outright (override > task > witness), so ancestry never ` +
        `had to speak.${winner.reason ? ` Its stated reason: "${winner.reason}".` : ""}`;
      break;
    case "maximality":
      explanation =
        `${winner.id} wins ${key}=${wv} by descent: every rival in its class is its own ` +
        `ancestor, so it is the only maximal candidate — the chain itself decided.`;
      break;
    case "cleanest-chain": {
      const cl = graph.cleanliness(winner.id);
      explanation =
        `${winner.id} wins ${key}=${wv} on the cleanest chain: ${cl.intent} intent ` +
        `ancestor(s), ${cl.witness} witness ancestor(s) — the strongest provenance ` +
        `among the maximal candidates.`;
      break;
    }
    case "smallest-id":
      explanation =
        `${winner.id} wins ${key}=${wv} by the smallest-id tie-break: maximal rivals ` +
        `tied on cleanliness, so the record id — the one arbitrary step in the rule — ` +
        `decided. This is the case worth a captain's ruling.`;
      break;
  }

  return { key, winner: winnerInfo, losers, decidedBy, explanation };
}

/**
 * True iff a conflict's winner was decided by the smallest-id
 * tie-break — digest.py's L5 test, same replay: the winner survived
 * class + maximality beside a rival of EQUAL cleanliness.
 */
export function decidedBySmallestId(records: Rec[], conflict: Conflict): boolean {
  const res = resolveKey(records, conflict.key);
  return !!res && res.winner.id === conflict.winner && res.decidedBy === "smallest-id";
}

/* ------------------------------------------------------------------ */
/* Frontier — where a new record's parents come from                   */
/* ------------------------------------------------------------------ */

/**
 * The frontier: records no other record descends from, in the fold's
 * application order. A new record (an override drafted at the chair,
 * say) names the frontier as its parents — that is what "descends
 * from everything currently standing" means in this system.
 */
export function frontier(records: Rec[], order: string[]): string[] {
  const isParent = new Set<string>();
  for (const r of records) for (const p of r.parents ?? []) isParent.add(p);
  const known = new Set(records.map((r) => r.id));
  return order.filter((id) => known.has(id) && !isParent.has(id));
}

/* ------------------------------------------------------------------ */
/* The captain's five lines (port of toolkit/digest.py)                */
/* ------------------------------------------------------------------ */

const plural = (n: number, one: string, many?: string) =>
  n === 1 ? one : (many ?? one + "s");

function fmtValue(v: unknown): string {
  let s: string;
  if (typeof v === "boolean") s = v ? "true" : "false";
  else if (v === null || v === undefined) s = "null";
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return s.length <= 24 ? s : s.slice(0, 23) + "…";
}

const fit = (line: string) =>
  line.length <= MAXLEN ? line : line.slice(0, MAXLEN - 1) + "…";

/**
 * Exactly five lines, each ≤140 chars, every number from the two API
 * documents. The five-line discipline is the design, not a formatting
 * quirk — a sixth line would be a dashboard starting. (digest.py's
 * argument, carried into the Desk unchanged.)
 */
export function digestLines(
  project: string,
  stateDoc: StateDoc,
  recordsDoc: RecordsDoc,
): string[] {
  const { state, conflicts } = stateDoc;
  const records = recordsDoc.records;

  // L1 — the record, by kind.
  const kinds = { task: 0, witness: 0, override: 0 } as Record<string, number>;
  for (const r of records) if (r.kind in kinds) kinds[r.kind]++;
  let l1 =
    `${project}: ${records.length} ${plural(records.length, "record")} — ` +
    `${kinds.task} ${plural(kinds.task, "task")} completed, ` +
    `${kinds.witness} ${plural(kinds.witness, "witness", "witnesses")}`;
  if (kinds.override) l1 += `, ${kinds.override} ${plural(kinds.override, "override")}`;
  const orphans = records.filter((r) => r.orphan);
  if (orphans.length) l1 += `, ${orphans.length} orphaned`;
  l1 += ".";

  // L2 — headline state: alphabetical keys, `project` omitted, max 4.
  let keys = Object.keys(state).filter((k) => k !== "project").sort().slice(0, 4);
  let l2 = "Headline state: (empty — no derived keys).";
  while (keys.length) {
    const candidate = "Headline state: " + keys.map((k) => `${k}=${fmtValue(state[k])}`).join(" · ");
    if (candidate.length <= MAXLEN) {
      l2 = candidate;
      break;
    }
    keys = keys.slice(0, -1);
  }

  // L3 — conflicts, decided by the record alone.
  let l3: string;
  if (conflicts.length) {
    const totalLosers = conflicts.reduce((n, c) => n + c.losers.length, 0);
    const most = [...conflicts].sort(
      (a, b) => b.losers.length - a.losers.length || (a.key < b.key ? -1 : 1),
    )[0];
    l3 =
      `Conflicts: ${conflicts.length} decided by the record alone — most contested ` +
      `${most.key} won by ${most.winner}; ${totalLosers} ${plural(totalLosers, "loser")} preserved.`;
  } else {
    l3 = "Conflicts: none — no key was contested; nothing needed deciding.";
  }

  // Witnesses and staleness (shared by L4 and L5).
  const witnesses = records.filter((r) => r.kind === "witness");
  const known = witnesses
    .filter((r) => typeof r.recordsBehind === "number")
    .sort((a, b) => (b.recordsBehind! - a.recordsBehind!) || (a.id < b.id ? -1 : 1));
  const stalest = known[0];

  // L4 — staleness.
  let l4: string;
  if (!witnesses.length) l4 = "Staleness: no witnesses — nothing observes the world here.";
  else if (stalest)
    l4 =
      `Staleness: ${stalest.id} is the stalest witness, ${stalest.recordsBehind} ` +
      `${plural(stalest.recordsBehind!, "record")} behind the frontier.`;
  else l4 = `Staleness: ${witnesses.length} ${plural(witnesses.length, "witness", "witnesses")} present; staleness unknown.`;

  // L5 — the one open question, in digest.py's order: a tie-break the
  // captain should rule on, else a witness 3+ behind, else quiet.
  let l5: string;
  const tieBreak = conflicts.find((c) => decidedBySmallestId(records, c));
  if (tieBreak)
    l5 = `Open question: ${tieBreak.key} was decided by the smallest-id tie-break — worth a captain's ruling?`;
  else if (stalest && (stalest.recordsBehind ?? 0) >= 3)
    l5 = `Open question: ${stalest.id} is ${stalest.recordsBehind} records behind — is its view of the world still current?`;
  else l5 = "Open question: none — the record is quiet.";

  return [l1, l2, l3, l4, l5].map(fit);
}
