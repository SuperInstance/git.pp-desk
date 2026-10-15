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

/* ------------------------------------------------------------------ */
/* Checkpoint v2 — closure-root pinning (Desk v2)                      */
/* ------------------------------------------------------------------ */
/*
 * The state digest above pins WHAT the fold derived. It does not pin
 * what the derivation was derived FROM: two different record sets can
 * leave the same state behind (a reason re-versioned, a loser swapped),
 * and the state digest cannot tell them apart. Checkpoint v2 (the
 * submission repo's docs/CHECKPOINT-V2.md, DESIGN §6) closes that with
 * a closure root over the records themselves. This section ports that
 * construction faithfully from the submission repo's src/fold.ts —
 * same canonical JSON (Python json.dumps byte form), same leaf-number
 * encoding in the float64 domain, same synchronous SHA-256 — so the
 * desk's roots are the referee's roots, reproducible by any port.
 *
 *   leaf(rec)  = SHA-256 of the canonical form of the record's WHOLE
 *                content {id, parents-as-set, kind, effects, reason}
 *   root       = SHA-256 of "\n".join(id + ":" + leaf) over a set of
 *                ids sorted by Unicode code point.
 *
 * closureRoot(records, at) is the v2 primitive itself (at's ancestor
 * closure; null if any ancestor is absent). setRoot(records) is the
 * desk's whole-set form: the closure taken at the FRONTIER — the union
 * of the ancestor closures of every frontier record (a record no held
 * record descends from) is the held set itself, so the set root pins
 * exactly what the desk holds: every held record's id and whole
 * content. Adding, removing, or re-versioning any held record — even
 * in a way the fold ignores, like a reason edit — moves the root.
 * What it does NOT pin: repo origins and arrival order (the leaf reads
 * neither), and records the desk does not hold.
 */

/** Compare two strings by Unicode code point (Python's ordering). */
export function cmpCodePoints(a: string, b: string): number {
  const ai = Array.from(a);
  const bi = Array.from(b);
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const ca = ai[i].codePointAt(0) as number;
    const cb = bi[i].codePointAt(0) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return ai.length - bi.length;
}

function pyEscapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20 || code >= 0x7f) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + '"';
}

/** Python's float repr for the leaf-number domain (see fold.ts). */
function pyFloatRepr(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const exp = abs.toExponential();
  const eIdx = exp.indexOf("e");
  const mant = exp.slice(0, eIdx);
  const E = parseInt(exp.slice(eIdx + 1), 10);
  const decpt = E + 1;
  let s: string;
  if (decpt <= -4 || decpt > 16) {
    const eSign = E < 0 ? "-" : "+";
    s = mant + "e" + eSign + String(Math.abs(E)).padStart(2, "0");
  } else {
    s = String(abs);
  }
  return neg ? "-" + s : s;
}

function pyNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return "0";
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  return pyFloatRepr(n);
}

/** Python-compatible canonical JSON (json.dumps, sort_keys, ", "/": "). */
export function pyCanonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return pyNumber(value);
  if (typeof value === "string") return pyEscapeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(pyCanonical).join(", ") + "]";
  }
  if (typeof value === "object") {
    const obj = value as { [key: string]: unknown };
    const keys = Object.keys(obj).sort(cmpCodePoints);
    return (
      "{" +
      keys.map((k) => pyEscapeString(k) + ": " + pyCanonical(obj[k])).join(", ") +
      "}"
    );
  }
  return pyEscapeString(String(value));
}

/* Synchronous SHA-256 (the fold's, verbatim in behaviour): the digest
 * is a pure function of the string, reproducible by the Python referee
 * (hashlib) and any third implementation. Validated against the same
 * standard vectors as src/fold.ts's copy. */
const _SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1 + 8) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let hex = "";
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, "0");
  return hex;
}

function leafParentsOf(rec: Rec): string[] {
  const ps = (rec as { parents?: unknown }).parents;
  if (!Array.isArray(ps)) return [];
  return ps.map((p) => String(p));
}

function leafEffectsOf(rec: Rec): { [key: string]: unknown } {
  const eff = (rec as { effects?: unknown }).effects;
  const out: { [key: string]: unknown } = {};
  if (eff && typeof eff === "object" && !Array.isArray(eff)) {
    for (const [k, v] of Object.entries(eff as { [key: string]: unknown })) {
      out[String(k)] = v;
    }
  }
  return out;
}

/**
 * SHA-256 of a record's WHOLE canonical content: id, parents (as a
 * set, sorted by code point), kind (raw), effects (float64 domain),
 * reason (raw, null if absent). Mirrors the referee's _record_leaf.
 */
export function recordLeaf(rec: Rec): string {
  const r = rec as { id?: unknown; kind?: unknown; reason?: unknown };
  const normalized = {
    id: String(r.id ?? ""),
    parents: leafParentsOf(rec).slice().sort(cmpCodePoints),
    kind: r.kind ?? null,
    effects: leafEffectsOf(rec),
    reason: r.reason ?? null,
  };
  return sha256Hex(pyCanonical(normalized));
}

function indexById(records: Rec[]): Map<string, Rec> {
  const byId = new Map<string, Rec>();
  for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r);
  return byId;
}

/**
 * The checkpoint-v2 closure root at `at` over the records given:
 * SHA-256 over the "id:leaf" lines of `at`'s full ancestor closure,
 * ids sorted by code point. Null if `at` is absent or any ancestor is
 * missing (an incomplete closure has no root — the referee's rule).
 */
export function closureRoot(records: Rec[], at: string): string | null {
  const byId = indexById(records);
  if (!byId.has(at)) return null;
  const closure = new Set<string>();
  const stack = [at];
  while (stack.length) {
    const n = stack.pop()!;
    if (closure.has(n)) continue;
    closure.add(n);
    for (const p of leafParentsOf(byId.get(n)!)) {
      if (!byId.has(p)) return null;
      stack.push(p);
    }
  }
  const lines = [...closure]
    .sort(cmpCodePoints)
    .map((id) => `${id}:${recordLeaf(byId.get(id)!)}`);
  return sha256Hex(lines.join("\n"));
}

/**
 * The desk's set root: the v2 construction taken at the frontier.
 * The union of the frontier records' ancestor closures is the held
 * set, so this pins every record the desk holds — its id set and each
 * record's whole content — in one digest. (Closures here are taken
 * WITHIN the held set: a parent the desk does not hold is not the
 * desk's to pin. Records unreachable from any frontier — a parent
 * cycle, which the fold excludes from derivation — are still held, so
 * they are pinned too.) Null when the desk holds nothing.
 */
export function setRoot(records: Rec[]): string | null {
  if (!records.length) return null;
  const byId = indexById(records);
  const namedAsParent = new Set<string>();
  for (const r of byId.values()) for (const p of leafParentsOf(r)) namedAsParent.add(p);

  const covered = new Set<string>();
  const walk = (start: string) => {
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (covered.has(n) || !byId.has(n)) continue;
      covered.add(n);
      for (const p of leafParentsOf(byId.get(n)!)) if (byId.has(p)) stack.push(p);
    }
  };
  for (const id of byId.keys()) if (!namedAsParent.has(id)) walk(id);
  for (const id of byId.keys()) if (!covered.has(id)) covered.add(id);

  const lines = [...covered]
    .sort(cmpCodePoints)
    .map((id) => `${id}:${recordLeaf(byId.get(id)!)}`);
  return sha256Hex(lines.join("\n"));
}
