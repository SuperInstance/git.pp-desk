/**
 * playtest.mjs — the Desk, played with honestly.
 *
 * Run: node test/playtest.mjs [project]
 *      DESTROY_DRILL=1 node test/playtest.mjs <scratch-project>
 *      (section 7: the real destroy() drill — never run it against
 *      poc-quilt-1; it destroys the project's Desk instance and then
 *      waits for the cadence to rebuild it, ~2 minutes)
 *
 * Independence note: the digest compared in check (1) is computed
 * HERE, by a second implementation of the canonical form, over bytes
 * fetched directly from the git.pp record — never through the Desk.
 * If the desk's digest and this one agree, two implementations over
 * the record agree; that is the only kind of agreement this system
 * has ever trusted. The closure root in check (1b) is held to the
 * same discipline: a from-the-doc port of checkpoint v2
 * (docs/CHECKPOINT-V2.md in the submission repo) lives below, and it
 * is itself anchored to the conformance-pinned literal root for
 * poc-quilt-1@task-c before the desk's root is believed.
 */
import { createHash } from "node:crypto";

const DESK = process.env.DESK_URL ?? "https://gitpp-desk.superinstance.dev";
const SOURCE = process.env.SOURCE_URL ?? "https://gitpp.superinstance.dev";
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

/* --- checkpoint v2, ported from docs/CHECKPOINT-V2.md ---------------
 * leaf(rec) = sha256 of the Python-canonical form of the record's
 * whole content {id, parents-as-set, kind, effects, reason}; numbers
 * in the float64 leaf encoding (integral |v|<1e21 → exact integer
 * digits; -0 → 0; else Python float repr). Root = sha256 of the
 * "id:leaf" lines, ids sorted by code point. */
const cmpCP = (a, b) => {
  const ai = Array.from(a), bi = Array.from(b);
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const ca = ai[i].codePointAt(0), cb = bi[i].codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return ai.length - bi.length;
};
const pyEsc = (s) => {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i), ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (code < 0x20 || code >= 0x7f) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
};
const pyNum = (n) => {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return "0";
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  const neg = n < 0, abs = Math.abs(n), exp = abs.toExponential();
  const eIdx = exp.indexOf("e"), mant = exp.slice(0, eIdx), E = parseInt(exp.slice(eIdx + 1), 10);
  const decpt = E + 1;
  const s = decpt <= -4 || decpt > 16
    ? mant + "e" + (E < 0 ? "-" : "+") + String(Math.abs(E)).padStart(2, "0")
    : String(abs);
  return neg ? "-" + s : s;
};
const pyCanonical = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return pyNum(v);
  if (typeof v === "string") return pyEsc(v);
  if (Array.isArray(v)) return "[" + v.map(pyCanonical).join(", ") + "]";
  const keys = Object.keys(v).sort(cmpCP);
  return "{" + keys.map((k) => pyEsc(k) + ": " + pyCanonical(v[k])).join(", ") + "}";
};
const recordLeaf = (rec) =>
  sha256(pyCanonical({
    id: String(rec.id ?? ""),
    parents: [...(rec.parents ?? [])].map(String).sort(cmpCP),
    kind: rec.kind ?? null,
    effects: rec.effects ?? {},
    reason: rec.reason ?? null,
  }));
const closureRootAt = (records, at) => {
  const byId = {};
  records.forEach((r) => { if (!(r.id in byId)) byId[r.id] = r; });
  if (!(at in byId)) return null;
  const closure = new Set(), stack = [at];
  while (stack.length) {
    const n = stack.pop();
    if (closure.has(n)) continue;
    closure.add(n);
    for (const p of byId[n].parents ?? []) {
      if (!(p in byId)) return null;
      stack.push(p);
    }
  }
  return sha256([...closure].sort(cmpCP).map((id) => `${id}:${recordLeaf(byId[id])}`).join("\n"));
};
/** The desk's set root: the v2 lines over the frontier records'
 * ancestor-closure union (== the held set), from the same doc. */
const setRootOf = (records) => {
  if (!records.length) return null;
  const byId = {};
  records.forEach((r) => { if (!(r.id in byId)) byId[r.id] = r; });
  const named = new Set(records.flatMap((r) => (r.parents ?? []).map(String)));
  const covered = new Set();
  const walk = (start) => {
    const stack = [start];
    while (stack.length) {
      const n = stack.pop();
      if (covered.has(n) || !(n in byId)) continue;
      covered.add(n);
      (byId[n].parents ?? []).forEach((p) => { if (p in byId) stack.push(p); });
    }
  };
  Object.keys(byId).forEach((id) => { if (!named.has(id)) walk(id); });
  Object.keys(byId).forEach((id) => { if (!covered.has(id)) covered.add(id); });
  return sha256([...covered].sort(cmpCP).map((id) => `${id}:${recordLeaf(byId[id])}`).join("\n"));
};

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
const recordsDoc = await (await fetch(`${SOURCE}/api/records?project=${PROJECT}`)).json();
const independentDigest = sha256(canonical(live.state));
const refreshed = await desk("refresh");
console.log(`independent digest (from the record, computed here): ${independentDigest}`);
console.log(`desk digest        (from the Desk's projection):     ${refreshed.digest}`);
check("1. desk digest == independent digest", refreshed.digest === independentDigest);

/* (1b) The closure root: the desk now pins the record SET, not only
   the state. This test's own v2 port must first reproduce the
   conformance-pinned literal (poc-quilt-1@task-c, over its 5-record
   closure) from the live record — that anchors the port to the
   referee, not to the desk. Then the desk's set root (frontier
   union == the whole held set) must equal the same port's set root
   over the same bytes. */
const independentRoot = setRootOf(recordsDoc.records);
console.log(`independent set root (frontier union, computed here): ${independentRoot}`);
console.log(`desk set root        (from the Desk's projection):     ${refreshed.root}`);
if (PROJECT === "poc-quilt-1") {
  const atTaskC = closureRootAt(recordsDoc.records, "task-c");
  check(
    "1b-i. this port reproduces the pinned root at task-c",
    atTaskC === "60effe23970d8a5cc837636c44685502361288c1f00577e9addfa10cbd4fc91d",
    `task-c closure root=${atTaskC}`,
  );
}
check("1b. desk set root == independent set root", refreshed.root === independentRoot);

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

/* (2) THE BEAUTY TEST: burn → empty → rebuild → identical digest
   AND identical closure root. The root is the stronger half: the
   state could in principle be re-derived from a different record
   set and still match; the root cannot. */
const burned = await desk("burn");
const emptyStatus = await desk("status");
console.log(
  `\nburn: burnedDigest=${burned.burnedDigest}, burnedRoot=${burned.burnedRoot}; desk now holds digest=${emptyStatus.digest}, root=${emptyStatus.root}, records=${emptyStatus.records.length}, ready=${emptyStatus.ready}`,
);
check(
  "2a. burn leaves the desk empty",
  emptyStatus.digest === null &&
    emptyStatus.root === null &&
    emptyStatus.records.length === 0 &&
    emptyStatus.ready === false,
);
const rebuilt = await desk("rebuild");
console.log(`rebuild digest: ${rebuilt.digest}`);
console.log(`rebuild root:   ${rebuilt.root}`);
check(
  "2b. rebuild digest == pre-burn digest",
  rebuilt.digest === burned.burnedDigest && rebuilt.digest === independentDigest,
  rebuilt.digest === burned.burnedDigest ? "IDENTICAL" : "DIFFERENT",
);
check(
  "2c. rebuild root == pre-burn root",
  rebuilt.root === burned.burnedRoot && rebuilt.root === independentRoot,
  rebuilt.root === burned.burnedRoot ? "IDENTICAL" : "DIFFERENT",
);

/* (6) THE CHEAP TICK: with the record unmoved, a refresh must prove
   it from the manifest alone — one API call, no re-read — and the
   digest+root it stands on must equal a forced full re-read's. */
const skip = await desk("refresh");
console.log(
  `\nmanifest tick: skipped=${skip.skipped}, apiCalls=${skip.apiCalls}, changedRepos=${JSON.stringify(skip.changedRepos)}`,
);
check(
  "6a. unchanged manifest → tick skipped on the manifest alone",
  skip.skipped === true && skip.apiCalls === 1,
  `apiCalls=${skip.apiCalls}`,
);
const forced = await desk("rebuild");
check(
  "6b. digest+root after a skipped tick == after a forced full re-read",
  skip.digest === forced.digest &&
    skip.root === forced.root &&
    forced.skipped === false &&
    forced.apiCalls === 3,
  `skip(${skip.digest}, ${skip.root}) vs forced(${forced.digest}, ${forced.root})`,
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

/* (5e) The burn centrepiece carries BOTH pins: the state digest and
   the closure root displays the page's burn flow drives. */
check(
  "5e. burn frame shows state digest + closure root, before/after",
  pageHtml.includes('id="root-now"') &&
    pageHtml.includes('id="root-before"') &&
    pageHtml.includes('id="root-after"') &&
    pageHtml.includes("Closure root of the record set"),
);

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

/* (7) THE DESTROY DRILL — opt-in (DESTROY_DRILL=1), scratch projects
   only. The fit note's deciding test with the real this.destroy():
   the whole Durable Object drops — projection, manifest, schedules.
   What must happen next, unprompted: a fresh instance answers under
   the same name, empty; onStart re-registers the cadence; the
   cadence rebuilds the projection from the record alone, landing on
   the pre-destroy digest AND root. If any of that strands, the
   failure is the finding — this section reports, it does not fix. */
if (process.env.DESTROY_DRILL === "1") {
  console.log("\n--- destroy drill (DESTROY_DRILL=1) ---");
  if (PROJECT === "poc-quilt-1") {
    check("7. destroy drill refuses poc-quilt-1", false, "pass a scratch project instead");
  } else {
    const beforeDestroy = await desk("rebuild");
    console.log(
      `pre-destroy: digest=${beforeDestroy.digest}, root=${beforeDestroy.root}`,
    );
    const dres = await desk("destroy");
    check(
      "7a. destroy accepted (deferred to the alarm)",
      dres.destroying === PROJECT,
      JSON.stringify(dres),
    );
    let fresh = null;
    for (let i = 0; i < 40 && !fresh; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await desk("status").catch(() => null);
      if (s && s.ready === false && s.digest === null && s.root === null && (s.records?.length ?? 0) === 0)
        fresh = s;
    }
    check("7b. after destroy, a fresh empty instance answers", !!fresh);
    let healed = null;
    for (let i = 0; i < 40 && !healed; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await desk("status").catch(() => null);
      if (s && s.ready && s.digest === beforeDestroy.digest && s.root === beforeDestroy.root)
        healed = s;
    }
    check(
      "7c. the cadence rebuilds the destroyed desk — digest+root identical",
      !!healed,
      healed ? "IDENTICAL" : "not healed within ~200 s of polling",
    );
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
