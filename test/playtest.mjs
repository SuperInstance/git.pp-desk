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
