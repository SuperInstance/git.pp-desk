/**
 * playtest.mjs — the Desk, played with honestly.
 *
 * Run: node test/playtest.mjs [project]
 *
 * Independence note: the digest compared in check (1) is computed
 * HERE, by a second implementation of the canonical form, over bytes
 * fetched directly from the git.pp record — never through the Desk.
 * If the desk's digest and this one agree, two implementations over
 * the record agree; that is the only kind of agreement this system
 * has ever trusted.
 */
import { createHash } from "node:crypto";

const DESK = process.env.DESK_URL ?? "https://gitpp-desk.casey-digennaro.workers.dev";
const SOURCE = "https://gitpp.casey-digennaro.workers.dev";
const PROJECT = process.argv[2] ?? "poc-quilt-1";

const canonical = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v) ?? "null"
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const desk = async (action, extra = {}) => {
  const q = new URLSearchParams({ project: PROJECT, action, ...extra });
  const res = await fetch(`${DESK}/api/desk?${q}`);
  return res.json();
};

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

/* (1) Projection loads and matches the live record. */
const live = await (await fetch(`${SOURCE}/api/state?project=${PROJECT}`)).json();
const independentDigest = sha256(canonical(live.state));
const refreshed = await desk("refresh");
console.log(`independent digest (from the record, computed here): ${independentDigest}`);
console.log(`desk digest        (from the Desk's projection):     ${refreshed.digest}`);
check("1. desk digest == independent digest", refreshed.digest === independentDigest);

const status = await desk("status");
console.log("\nThe five lines, as the desk serves them:");
for (const line of status.lines) console.log("  " + line);
console.log(
  `witnesses: ${status.witnesses.map((w) => `${w.id} (${w.recordsBehind} behind)`).join(", ")}`,
);

/* (3) why() on the contested key. */
const conflictKey = live.conflicts[0]?.key ?? "config.timeout";
const why = await desk("why", { key: conflictKey });
console.log(`\nwhy(${conflictKey}):\n  ${why.explanation ?? why.note}`);
check(
  "3. why() explains the standing winner",
  why.contested === true && why.winner?.id === live.conflicts[0]?.winner,
  `winner=${why.winner?.id}, decidedBy=${why.decidedBy}`,
);

/* (4) draftOverride() names the true frontier as parents. */
const recordsDoc = await (await fetch(`${SOURCE}/api/records?project=${PROJECT}`)).json();
const isParent = new Set(recordsDoc.records.flatMap((r) => r.parents ?? []));
const trueFrontier = live.order.filter((id) => !isParent.has(id));
const draft = await desk("draft", {
  key: conflictKey,
  id: "override-desk-test",
  reason: "playtest: captain confirms the standing value",
});
console.log(`\ndrafted override:\n  ${JSON.stringify(draft.record)}`);
check(
  "4. draft parents == frontier",
  JSON.stringify(draft.record?.parents) === JSON.stringify(trueFrontier),
  `frontier=${JSON.stringify(trueFrontier)}`,
);

/* (2) THE BEAUTY TEST: burn → empty → rebuild → identical digest. */
const burned = await desk("burn");
const emptyStatus = await desk("status");
console.log(
  `\nburn: burnedDigest=${burned.burnedDigest}; desk now holds digest=${emptyStatus.digest}, records=${emptyStatus.records.length}, ready=${emptyStatus.ready}`,
);
check(
  "2a. burn leaves the desk empty",
  emptyStatus.digest === null && emptyStatus.records.length === 0 && emptyStatus.ready === false,
);
const rebuilt = await desk("rebuild");
console.log(`rebuild digest: ${rebuilt.digest}`);
check(
  "2b. rebuild digest == pre-burn digest",
  rebuilt.digest === burned.burnedDigest && rebuilt.digest === independentDigest,
  rebuilt.digest === burned.burnedDigest ? "IDENTICAL" : "DIFFERENT",
);

/* (5) The page answers, and the socket speaks. */
const page = await fetch(`${DESK}/?project=${PROJECT}`);
const pageHtml = await page.text();
check("5a. page serves", page.status === 200 && pageHtml.includes("Captain's Desk"));

/* (5c) The first screen carries the story, in order: the claim, the
   fold replay, the burn — all before the depth sections. A stranger
   should meet the sentence, the mechanism, and the proof without
   scrolling; this checks the served HTML's structure, cold. */
{
  const claimAt = pageHtml.indexOf("State is what completed tasks leave behind.");
  const foldAt = pageHtml.indexOf("Watch the fold");
  const burnAt = pageHtml.indexOf('id="burn"');
  const depthAt = pageHtml.indexOf("The five lines");
  check(
    "5c. first screen: claim → fold → burn, before the depth",
    claimAt >= 0 && foldAt > claimAt && burnAt > foldAt && depthAt > burnAt,
    `claim@${claimAt} fold@${foldAt} burn@${burnAt} depth@${depthAt}`,
  );
}

/* (5d) Shuffle & re-fold: the served page carries the control, and the
   fold itself is arrival-order invariant. The fold port below mirrors
   the page's client port function for function (same graph over all
   records, same prefix-filtered candidates, same resolution); the
   permutations are seeded (mulberry32) so the run is reproducible.
   The digest each shuffled fold must land on is the independent one
   from check (1) — computed from the record, not from any fold here.
   Intermediate states are compared prefix-by-prefix with the
   canonical walk, and the divergence count is reported as measured. */
{
  check("5d. served page contains the shuffle control", pageHtml.includes('id="s-shuffle"'));

  const CLASS_RANK = { override: 3, task: 2, witness: 1 };
  const byId = {};
  recordsDoc.records.forEach((r) => { byId[r.id] = r; });
  const ancCache = {};
  const ancOf = (id) => {
    if (ancCache[id]) return ancCache[id];
    const seen = {};
    const stack = [...(byId[id]?.parents ?? [])];
    while (stack.length) {
      const x = stack.pop();
      if (seen[x] || !byId[x]) continue;
      seen[x] = true;
      (byId[x].parents ?? []).forEach((p) => stack.push(p));
    }
    return (ancCache[id] = seen);
  };
  const cleanOf = (id) => {
    let intent = 0, witness = 0;
    for (const x of Object.keys(ancOf(id))) {
      const k = byId[x]?.kind;
      if (k === "task" || k === "override") intent++;
      else if (k === "witness") witness++;
    }
    return { intent, witness };
  };
  const resolveKeyAt = (applied, key) => {
    const cands = applied.filter(
      (r) => !r.orphan && r.effects && Object.prototype.hasOwnProperty.call(r.effects, key),
    );
    if (!cands.length) return null;
    const top = Math.max(...cands.map((c) => CLASS_RANK[c.kind] || 0));
    const pool = cands.filter((c) => (CLASS_RANK[c.kind] || 0) === top);
    const maximal = pool.filter((c) => !pool.some((o) => o !== c && ancOf(o.id)[c.id]));
    const sorted = maximal.slice().sort((a, b) => {
      const ca = cleanOf(a.id), cb = cleanOf(b.id);
      if (cb.intent !== ca.intent) return cb.intent - ca.intent;
      if (ca.witness !== cb.witness) return ca.witness - cb.witness;
      return a.id < b.id ? -1 : 1;
    });
    return sorted[0].effects[key];
  };
  const foldState = (applied) => {
    const keys = {};
    applied.forEach((r) => {
      if (!r.orphan && r.effects) Object.keys(r.effects).forEach((k) => { keys[k] = true; });
    });
    const out = {};
    Object.keys(keys).sort().forEach((k) => { out[k] = resolveKeyAt(applied, k); });
    return out;
  };

  const canonSeq = live.order.filter((id) => byId[id]).map((id) => byId[id]);
  recordsDoc.records.forEach((r) => { if (!canonSeq.includes(r)) canonSeq.push(r); });
  const canonPrefix = canonSeq.map((_, k) => canonical(foldState(canonSeq.slice(0, k + 1))));

  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const perms = [];
  const seenSigs = new Set([canonSeq.map((r) => r.id).join(",")]);
  for (let seed = 1; perms.length < 5 && seed < 200; seed++) {
    const rnd = mulberry32(seed);
    const p = canonSeq.slice();
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    const sig = p.map((r) => r.id).join(",");
    if (seenSigs.has(sig)) continue;
    seenSigs.add(sig);
    perms.push(p);
  }

  let allLanded = perms.length === 5;
  let divergedCount = 0;
  perms.forEach((p, idx) => {
    let diverged = false;
    let endDigest = null;
    for (let k = 1; k <= p.length; k++) {
      const st = foldState(p.slice(0, k));
      if (k < p.length && canonical(st) !== canonPrefix[k - 1]) diverged = true;
      if (k === p.length) endDigest = sha256(canonical(st));
    }
    if (endDigest !== independentDigest) allLanded = false;
    if (diverged) divergedCount++;
    console.log(
      `  shuffle ${idx + 1} [${p.map((r) => r.id).join(", ")}]: end digest ${endDigest} — mid-fold diverged: ${diverged}`,
    );
  });
  console.log(`  intermediate states diverged on ${divergedCount} of ${perms.length} permutations`);
  check(
    "5d. five seeded shuffles re-fold to the canonical digest",
    allLanded,
    `permutations=${perms.length}, mid-fold divergence on ${divergedCount}/${perms.length}`,
  );
}
try {
  const wsState = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${new URL(DESK).host}/agents/desk/${PROJECT}`);
    const timer = setTimeout(() => reject(new Error("ws timeout")), 15000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "cf_agent_state" && msg.state?.digest) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.state);
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
  check("5b. websocket broadcasts the projection", wsState.digest === independentDigest);
} catch (err) {
  check("5b. websocket broadcasts the projection", false, err.message);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
