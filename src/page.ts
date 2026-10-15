/**
 * page.ts — the captain's desk, rendered.
 *
 * One page, no build step, no framework. It speaks to the Desk agent
 * over the Agents SDK's own wire protocol: state arrives as
 * `cf_agent_state` broadcasts whenever the projection changes, and
 * gestures go back as `rpc` calls (why / draftOverride / burn /
 * rebuild). Everything the page shows is the projection — if this
 * page and the live record ever disagree, the record wins and the
 * desk rebuilds (the burn panel below is exactly that drill).
 *
 * LAYOUT — a story first, depth below (the zero-shot standard):
 *   1. The claim, in one sentence, with two plain sentences for a
 *      stranger and a pointer at the proof.
 *   2. "Watch the fold": a replay that steps the record in the fold's
 *      application order and re-derives state in the visitor's own
 *      browser, narrating each resolution in DESIGN §2's terms. The
 *      fold port below mirrors referee/fold.py exactly (class →
 *      exact maximality → cleanest chain → smallest id); its prefix
 *      behaviour on poc-quilt-1 was checked against the Python
 *      referee during the build — 30 lands, 60 never holds the key
 *      (cleanliness tie, smallest id), the captain's override takes
 *      it at 45, and 99 loses on class. The narration is computed
 *      from the records, never scripted per project.
 *   3. The burn, centre stage: the desk's disposability, push-button.
 *   3b. Shuffle & re-fold, beside the burn: the same records in a
 *      scrambled arrival order, folded by this same port over the
 *      shuffled prefixes, landing on the desk's digest. Intermediate
 *      states may differ from the canonical walk; the end state may
 *      not — that contrast is the second proof.
 *   4. Below the fold, the depth: the five lines, conflicts with
 *      why(), witnesses, the record itself, draft-an-override, and
 *      honest links (repo, conformance totals, demo video).
 */

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Captain's Desk — git.pp</title>
<style>
  :root { color-scheme: dark; }
  body { font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #e6edf3; margin: 0 auto; max-width: 880px; padding: 24px 16px 64px; }
  h1 { font-size: 17px; margin: 0; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #8b949e; margin: 28px 0 8px; }
  .sub { color: #8b949e; margin: 0 0 16px; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  select, input, button { background: #161b22; color: #e6edf3; border: 1px solid #30363d;
         border-radius: 6px; padding: 6px 10px; font: inherit; }
  button { cursor: pointer; } button:hover { border-color: #58a6ff; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #f85149; display: inline-block; }
  .dot.on { background: #3fb950; }
  ol.lines { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px 12px 36px; }
  ol.lines li { margin: 4px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; margin: 8px 0; }
  .win { color: #3fb950; } .lose { color: #f85149; }
  pre { background: #010409; border: 1px solid #30363d; border-radius: 6px; padding: 10px;
        overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  .digest { word-break: break-all; font-size: 12.5px; }
  .badge { font-weight: 700; padding: 2px 8px; border-radius: 10px; }
  .badge.ok { background: #238636; color: #fff; } .badge.bad { background: #da3633; color: #fff; }
  table { border-collapse: collapse; } td, th { border: 1px solid #30363d; padding: 4px 10px; text-align: left; }
  footer { color: #8b949e; margin-top: 40px; font-size: 13px; }
  footer li { margin: 4px 0; }
  a { color: #58a6ff; }
  /* --- the story (first screen) --- */
  .brand { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .brand .tag { color: #8b949e; font-size: 13px; }
  .hero { margin: 18px 0 4px; }
  .claim { font-size: 27px; font-weight: 700; line-height: 1.3; margin: 0 0 10px; }
  .hero p { margin: 6px 0; max-width: 47rem; }
  .prove { border-left: 3px solid #9e6a03; padding-left: 10px; }
  /* --- the replay --- */
  .stage { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  @media (max-width: 720px) { .stage { grid-template-columns: 1fr; } }
  .rec-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; min-height: 148px; }
  .rec-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .rid { font-weight: 700; font-size: 16px; }
  .kind { font-size: 11px; padding: 1px 7px; border-radius: 9px; border: 1px solid #30363d;
          text-transform: uppercase; letter-spacing: .06em; color: #58a6ff; }
  .kind.override { color: #d29922; border-color: #d29922; }
  .kind.witness { color: #8b949e; }
  .stepct { color: #8b949e; font-size: 12.5px; margin-left: auto; }
  .rec-parents, .rec-effects, .rec-reason { margin: 4px 0; font-size: 13.5px; }
  .rec-reason { color: #d29922; }
  .sgrid { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 12px; min-height: 148px; }
  .sgrid table { width: 100%; } .sgrid td, .sgrid th { border: none; border-bottom: 1px solid #21262d; padding: 3px 6px; }
  .sgrid .holder { color: #3fb950; font-size: 12.5px; }
  .sgrid .claims { color: #8b949e; font-size: 12px; }
  @keyframes flash { from { background: rgba(31,111,235,.45); } to { background: transparent; } }
  .flash { animation: flash 1.1s ease-out; }
  .narration { background: #010409; border: 1px solid #30363d; border-radius: 8px;
               padding: 10px 14px; margin-top: 12px; min-height: 88px; font-size: 14px; }
  .rcontrols { margin: 10px 0 12px; }
  .rcontrols .stepct { margin-left: 4px; }
  /* --- the burn, framed --- */
  .burn-frame { border: 1px solid #9e6a03; border-radius: 8px; padding: 2px 16px 16px; margin-top: 30px; }
  .burn-frame h2 { color: #d29922; }
  /* --- the shuffle, same family as the burn --- */
  .shuffle-frame { border: 1px solid #238636; border-radius: 8px; padding: 2px 16px 16px; margin-top: 16px; }
  .shuffle-frame h2 { color: #3fb950; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
  .chip { border: 1px solid #30363d; border-radius: 10px; padding: 1px 8px; font-size: 12.5px; color: #8b949e; }
  .chip.done { color: #e6edf3; border-color: #238636; }
  .chip.now { background: #238636; color: #fff; border-color: #238636; font-weight: 700; }
</style>
</head>
<body>

<div class="brand">
  <h1>The Captain's Desk</h1>
  <span class="tag">git.pp — a live projection of the record</span>
</div>
<div class="bar" style="margin-top:10px">
  <label>Project
    <select id="project">
      <option>poc-quilt-1</option>
      <option>poc-scale-1</option>
      <option>demo-race-1</option>
    </select>
  </label>
  <span><span class="dot" id="dot"></span> <span id="conn">connecting…</span></span>
  <button id="refresh">↻ refresh from the record</button>
  <span id="updated"></span>
</div>

<section class="hero">
  <p class="claim">State is what completed tasks leave behind.</p>
  <p>Many agents work one project at the same time. Nobody merges, and nothing is
  lost — because state is never stored. It is derived, by a deterministic fold,
  from an append-only record of completed tasks, and the losing versions stay
  in the record, cloneable, with the reasons they lost.</p>
  <p class="prove">This page is a projection of that record — a view, not the
  truth. It can prove it: <a href="#burn">burn this desk's memory</a> and it
  rebuilds itself, identically, from the record alone.</p>
</section>

<h2>Watch the fold — the record, replayed</h2>
<div class="bar rcontrols">
  <button id="r-restart" title="back to the start">⏮ restart</button>
  <button id="r-prev" title="one record back">◀ step back</button>
  <button id="r-play" title="play or pause the replay">▶ play</button>
  <button id="r-next" title="one record forward">step ▶</button>
  <button id="r-end" title="jump to the folded state">⏭ skip to the end</button>
  <span class="stepct" id="r-progress">waiting for the record…</span>
</div>
<div class="stage">
  <div class="rec-card" id="rec-card">
    <div class="rec-top"><span class="rid">—</span></div>
    <p class="rec-effects">The record will appear here, one completion at a time,
    in the fold's application order.</p>
  </div>
  <div class="sgrid" id="state-grid"><p style="margin:6px 0">No state yet — nothing has completed.</p></div>
</div>
<div class="narration" id="narration">The fold is a pure function: feed it the same
records, in any arrival order, and it leaves the same state behind. Watch it happen.</div>
<p class="sub" id="replay-digest" style="margin-top:8px"></p>

<section class="burn-frame" id="burn">
  <h2>🔥 The burn — this desk's memory is a projection. Burn it.</h2>
  <p>Everything the desk holds — the state above, the conflicts, this page's
  picture of the project — is derived from the record and kept only as a cache.
  Burn the cache and the desk holds <i>nothing</i>. Rebuild, and if both pins
  come back identical, the desk never was a second source of truth. It is safe
  to try: the record is untouched, and the desk also heals itself on its
  60-second cadence.</p>
  <p>Digest of the derived state, as the desk now holds it:</p>
  <p class="digest" id="digest-now">—</p>
  <p>Closure root of the record set it was derived from — a checkpoint-v2
  digest over every record's whole content, so even a change the fold ignores
  (a re-worded reason, a swapped loser) moves it:</p>
  <p class="digest" id="root-now">—</p>
  <div class="bar">
    <button id="burn-btn">🔥 burn the desk</button>
    <button id="rebuild">rebuild from the record alone</button>
    <span id="burn-verdict"></span>
  </div>
  <p>Digest before burn: <span class="digest" id="digest-before">—</span></p>
  <p>Digest after rebuild: <span class="digest" id="digest-after">—</span></p>
  <p>Root before burn: <span class="digest" id="root-before">—</span></p>
  <p>Root after rebuild: <span class="digest" id="root-after">—</span></p>
</section>

<section class="shuffle-frame" id="shuffle">
  <h2>🔀 Shuffle &amp; re-fold — the same record, any arrival order</h2>
  <p>The replay above walks the record in the fold's application order. But
  agents don't arrive in order — they finish when they finish. So take the
  same records, scramble the order they arrive in, and fold again, here in
  your browser, with the very same code. Step through it: the halfway
  houses may differ from the canonical walk. The destination may not. The
  fold doesn't care what order work arrived in — the same completions land
  on the same state.</p>
  <div class="bar rcontrols">
    <button id="s-shuffle" title="scramble the arrival order and fold again">🔀 shuffle &amp; re-fold</button>
    <button id="s-prev" title="one arrival back">◀ step back</button>
    <button id="s-play" title="play or pause the shuffled fold">▶ play</button>
    <button id="s-next" title="one arrival forward">step ▶</button>
    <button id="s-end" title="fold the whole shuffled record at once">⏭ fast-forward</button>
    <span class="stepct" id="s-progress">press shuffle to scramble the arrival order</span>
  </div>
  <div class="chips" id="s-order"></div>
  <div class="sgrid" id="s-state"><p style="margin:6px 0">No shuffled fold yet.</p></div>
  <div class="narration" id="s-narration">Every press deals the same records in a
  new arrival order. Watch the end state: it is not allowed to move.</div>
  <p style="margin-top:10px">Canonical-order digest (the desk's live digest):
    <span class="digest" id="s-digest-canon">—</span></p>
  <p>Shuffled-fold digest (your browser, this arrival order):
    <span class="digest" id="s-digest-shuf">—</span> <span id="s-verdict"></span></p>
</section>

<h2>The five lines</h2>
<ol class="lines" id="lines"><li>—</li></ol>

<h2>Conflicts — read why, then rule</h2>
<div id="conflicts"><p>—</p></div>

<h2>Witnesses</h2>
<div id="witnesses"><p>—</p></div>

<h2>The record — every completion, in the fold's application order</h2>
<div id="records"><p>—</p></div>

<h2>Draft an override (the desk drafts; only the captain's tools push)</h2>
<div class="card">
  <div class="bar">
    <input id="d-key" placeholder="key, e.g. config.timeout" size="22">
    <input id="d-id" placeholder="new record id, e.g. override-2" size="24">
    <input id="d-reason" placeholder="reason, in the captain's words" size="34">
    <button id="draft">draft override</button>
  </div>
  <pre id="draft-out">The drafted record appears here — parents set to the current frontier.</pre>
</div>

<footer>
  <p>git.pp-desk — a spike of the "adopt as projection" verdict. Read-only:
  this worker holds no admin key and cannot write to the record.</p>
  <ul>
    <li>The record itself, live: <a id="record-link" href="https://gitpp.casey-digennaro.workers.dev/?project=poc-quilt-1">the git.pp projection</a>
        (raw: <a href="https://gitpp.casey-digennaro.workers.dev/api/state?project=poc-quilt-1">/api/state</a>,
        <a href="https://gitpp.casey-digennaro.workers.dev/api/records?project=poc-quilt-1">/api/records</a>)</li>
    <li>The submission: <a href="https://github.com/SuperInstance/git.pp-ng">github.com/SuperInstance/git.pp-ng</a></li>
    <li>Verify the fold yourself: 855/855 conformance cases identical between the
        TypeScript fold and the Python referee — derive + 1,014 checkpoint probes +
        3,224 witness-freshness checks + 2,812 brute-force maximality-oracle checks,
        zero divergences (<code>conformance/harness.py</code> in the submission repo).</li>
    <li>The demo video (7:19): <a href="https://github.com/user-attachments/assets/4a31f8ff-a491-43d1-bfb8-18241d52d072">watch it in the submission README</a>.</li>
  </ul>
</footer>

<script>
const params = new URLSearchParams(location.search);
const project = params.get("project") || "poc-quilt-1";
document.getElementById("project").value = project;
document.getElementById("project").onchange = (e) => {
  location.search = "?project=" + encodeURIComponent(e.target.value);
};

const proto = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(proto + "//" + location.host + "/agents/desk/" + encodeURIComponent(project));
let seq = 0;
const pending = new Map();
let lastState = null;
let burnedDigest = null;
let burnedRoot = null;

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = "c" + ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ type: "rpc", id, method, args }));
  });
}

ws.onopen = () => {
  document.getElementById("dot").classList.add("on");
  document.getElementById("conn").textContent = "live";
  if (!lastState || !lastState.digest) call("refresh").catch(() => {});
};
ws.onclose = () => {
  document.getElementById("dot").classList.remove("on");
  document.getElementById("conn").textContent = "disconnected";
};
ws.onmessage = (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === "cf_agent_state") render(msg.state);
  else if (msg.type === "rpc" && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.success === false || msg.error) p.reject(new Error(String(msg.error || "rpc failed")));
    else p.resolve(msg.result);
  }
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ================================================================== */
/* The fold, ported — DESIGN §2 exactly as referee/fold.py runs it.   */
/* Pure functions over a prefix of the record, in application order.  */
/* ================================================================== */

const CLASS_RANK = { override: 3, task: 2, witness: 1 };
const rankOf = (kind) => CLASS_RANK[kind] || 0;

function canon(v) {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}

function buildGraph(recs) {
  const byId = {};
  recs.forEach((r) => { byId[r.id] = r; });
  const cache = {};
  function anc(id) {
    if (cache[id]) return cache[id];
    const seen = {};
    const stack = ((byId[id] && byId[id].parents) || []).slice();
    while (stack.length) {
      const x = stack.pop();
      if (seen[x] || !byId[x]) continue;
      seen[x] = true;
      ((byId[x].parents) || []).forEach((p) => stack.push(p));
    }
    cache[id] = seen;
    return seen;
  }
  function clean(id) {
    let intent = 0, wit = 0;
    Object.keys(anc(id)).forEach((x) => {
      const k = byId[x] && byId[x].kind;
      if (k === "task" || k === "override") intent++;
      else if (k === "witness") wit++;
    });
    return { intent: intent, witness: wit };
  }
  return { byId: byId, anc: anc, clean: clean };
}

/* Resolve one key over an applied prefix. Mirrors derive(): best class
   pool, exact maximality inside it, cleanest chain, smallest id. */
function resolveKeyAt(g, applied, key) {
  const cands = applied.filter((r) =>
    !r.orphan && r.effects && Object.prototype.hasOwnProperty.call(r.effects, key));
  if (!cands.length) return null;
  const top = Math.max.apply(null, cands.map((c) => rankOf(c.kind)));
  const pool = cands.filter((c) => rankOf(c.kind) === top);
  const weaker = cands.filter((c) => rankOf(c.kind) !== top);
  const maximal = pool.filter((c) =>
    !pool.some((o) => o !== c && g.anc(o.id)[c.id]));
  const sorted = maximal.slice().sort((a, b) => {
    const ca = g.clean(a.id), cb = g.clean(b.id);
    if (cb.intent !== ca.intent) return cb.intent - ca.intent;
    if (ca.witness !== cb.witness) return ca.witness - cb.witness;
    return a.id < b.id ? -1 : 1;
  });
  const winner = sorted[0];
  const distinct = {};
  cands.forEach((c) => { distinct[canon(c.effects[key])] = true; });
  const contested = Object.keys(distinct).length >= 2;
  let decidedBy = null;
  if (contested) {
    if (weaker.length) decidedBy = "class";
    else if (maximal.length === 1) decidedBy = "maximality";
    else {
      const w = g.clean(winner.id);
      const tied = sorted.some((o) => {
        if (o === winner) return false;
        const co = g.clean(o.id);
        return co.intent === w.intent && co.witness === w.witness;
      });
      decidedBy = tied ? "smallest-id" : "cleanest-chain";
    }
  }
  return {
    key: key, value: winner.effects[key], holder: winner.id, holderKind: winner.kind,
    holderReason: winner.reason || null, contested: contested, decidedBy: decidedBy,
    winClean: g.clean(winner.id),
    losers: cands.filter((c) => c !== winner).map((c) => ({ id: c.id, value: c.effects[key], kind: c.kind })),
  };
}

function stateAt(g, applied) {
  const keys = {};
  applied.forEach((r) => {
    if (!r.orphan && r.effects) Object.keys(r.effects).forEach((k) => { keys[k] = true; });
  });
  const out = {};
  Object.keys(keys).sort().forEach((k) => { out[k] = resolveKeyAt(g, applied, k); });
  return out;
}

const fmtVal = (v) => { const s = JSON.stringify(v); return s === undefined ? "null" : s; };
const art = (kind) => (kind === "override" ? "an" : "a");

function whyText(res) {
  switch (res.decidedBy) {
    case "class":
      return "class precedence — " + art(res.holderKind) + " " + res.holderKind + " outranks every lower-class rival outright (override > task > witness)";
    case "maximality":
      return "descent — every rival in its class is its own ancestor, so the chain itself decided";
    case "cleanest-chain":
      return "the cleanest chain — " + res.winClean.intent + " intent ancestor(s), " +
             res.winClean.witness + " witness ancestor(s): the strongest provenance standing";
    case "smallest-id":
      return "the rival chains tied on cleanliness, so the smallest id — the one arbitrary step in the rule — decided";
  }
  return "";
}

/* ================================================================== */
/* The replay                                                          */
/* ================================================================== */

const replay = {
  recs: [], orderKey: "", g: null, digestAtInit: null,
  step: 0, playing: false, timer: null, interacted: false, autoplayDone: false,
};

function stopPlay() {
  replay.playing = false;
  if (replay.timer) { clearInterval(replay.timer); replay.timer = null; }
  document.getElementById("r-play").textContent = "▶ play";
}

function startPlay() {
  if (replay.step >= replay.recs.length) showStep(0);
  replay.playing = true;
  document.getElementById("r-play").textContent = "⏸ pause";
  replay.timer = setInterval(() => {
    if (replay.step >= replay.recs.length) { stopPlay(); return; }
    showStep(replay.step + 1);
    if (replay.step >= replay.recs.length) stopPlay();
  }, 650);
}

function narrationFor(i) {
  if (i === 0) {
    return "Nothing yet — no task has completed. " + replay.recs.length +
      " records stand in the record, in the fold's application order. " +
      "Press play, or step through them, and watch the state they leave behind.";
  }
  const r = replay.recs[i - 1];
  const prev = stateAt(replay.g, replay.recs.slice(0, i - 1));
  const next = stateAt(replay.g, replay.recs.slice(0, i));
  const parts = [];
  let head = "<b>" + esc(r.id) + "</b> — " + art(r.kind) + " " + esc(r.kind) + " record — lands.";
  if (r.parents && r.parents.length) head += " It descends from " + r.parents.map(esc).join(", ") + ".";
  else head += " It has no parents: it opens the record.";
  if (r.reason) head += " Its stated reason: <i>&quot;" + esc(r.reason) + "&quot;</i>.";
  parts.push(head);

  const effKeys = r.effects ? Object.keys(r.effects).sort() : [];
  effKeys.forEach((k) => {
    const p = prev[k], n = next[k];
    if (!n) return;
    if (!p) {
      parts.push(esc(k) + " appears: <b>" + esc(fmtVal(n.value)) + "</b>, set by " + esc(r.id) + ".");
      return;
    }
    if (canon(r.effects[k]) === canon(n.value) && n.holder !== r.id) {
      parts.push(esc(r.id) + " agrees with the standing value of " + esc(k) +
        " (<b>" + esc(fmtVal(n.value)) + "</b>, held by " + esc(n.holder) + ") — nothing to decide.");
      return;
    }
    if (n.holder === r.id) {
      if (canon(p.value) !== canon(n.value)) {
        let line = esc(k) + " changes hands: " + esc(fmtVal(p.value)) + " (" + esc(p.holder) +
          ") → <b>" + esc(fmtVal(n.value)) + "</b> (" + esc(r.id) + ")";
        line += n.contested ? " — " + whyText(n) + "." : ".";
        parts.push(line);
      } else {
        parts.push(esc(k) + " stays <b>" + esc(fmtVal(n.value)) + "</b> — " + esc(r.id) + " now also stands behind it.");
      }
      return;
    }
    /* The incoming record set the key and did not take it. */
    let line = esc(r.id) + "'s " + esc(fmtVal(r.effects[k])) + " for " + esc(k) +
      " is in the record — and does not take the key. " + esc(n.holder) + "'s <b>" +
      esc(fmtVal(n.value)) + "</b> stands";
    line += n.contested ? ": " + whyText(n) + "." : ".";
    if (typeof r.effects[k] === "number" && typeof n.value === "number" && r.effects[k] > n.value) {
      line += " " + esc(fmtVal(r.effects[k])) + " is the bigger value, and the later arrival — " +
        "and neither counts. Provenance beats recency and size.";
    }
    if (n.holderReason) line += " The standing reason: <i>&quot;" + esc(n.holderReason) + "&quot;</i>.";
    parts.push(line);
  });

  if (i === replay.recs.length) {
    parts.push("That is the whole record — " + replay.recs.length +
      " records. The state above is not stored anywhere; it is what these completed tasks leave behind.");
  }
  return parts.join("<br>");
}

function showStep(i) {
  const n = replay.recs.length;
  replay.step = Math.max(0, Math.min(i, n));
  const applied = replay.recs.slice(0, replay.step);
  const prevState = replay.step > 0 ? stateAt(replay.g, replay.recs.slice(0, replay.step - 1)) : {};
  const st = stateAt(replay.g, applied);

  document.getElementById("r-progress").textContent =
    n ? "record " + replay.step + " of " + n : "no records";

  /* the incoming record card */
  const card = document.getElementById("rec-card");
  if (replay.step === 0) {
    card.innerHTML = '<div class="rec-top"><span class="rid">the record, before anything completes</span></div>' +
      '<p class="rec-effects">No state yet. Press play — each record below the line is a task an agent ' +
      'completed, a witness observation, or a captain\'s override, with the ancestry it descends from.</p>';
  } else {
    const r = replay.recs[replay.step - 1];
    let html = '<div class="rec-top"><span class="rid">' + esc(r.id) + '</span>' +
      '<span class="kind ' + esc(r.kind) + '">' + esc(r.kind) + '</span>' +
      '<span class="stepct">record ' + replay.step + ' of ' + n + '</span></div>';
    html += '<p class="rec-parents">' +
      (r.parents && r.parents.length ? "descends from: " + r.parents.map(esc).join(", ") : "descends from: nothing — genesis") +
      "</p>";
    const effKeys = r.effects ? Object.keys(r.effects).sort() : [];
    html += '<p class="rec-effects">' + effKeys.map((k) =>
      esc(k) + " → <b>" + esc(fmtVal(r.effects[k])) + "</b>").join("<br>") + "</p>";
    if (r.reason) html += '<p class="rec-reason">reason: &quot;' + esc(r.reason) + '&quot;</p>';
    card.innerHTML = html;
  }

  /* the state grid */
  const grid = document.getElementById("state-grid");
  const keys = Object.keys(st);
  if (!keys.length) {
    grid.innerHTML = '<p style="margin:6px 0">No state yet — nothing has completed.</p>';
  } else {
    grid.innerHTML = "<table><tr><th>key</th><th>standing value</th><th>held by</th></tr>" +
      keys.map((k) => {
        const res = st[k];
        const changed = !prevState[k] || prevState[k].holder !== res.holder ||
          canon(prevState[k].value) !== canon(res.value);
        let claims = "";
        if (res.contested && res.losers.length) {
          claims = '<div class="claims">⚔ contested — also claimed: ' +
            res.losers.map((l) => esc(l.id) + " (" + esc(fmtVal(l.value)) + ")").join(" · ") +
            " — preserved, not deleted</div>";
        }
        return '<tr' + (changed ? ' class="flash"' : "") + '><td>' + esc(k) + "</td><td><b>" +
          esc(fmtVal(res.value)) + '</b></td><td class="holder">' + esc(res.holder) + claims + "</td></tr>";
      }).join("") + "</table>";
  }

  document.getElementById("narration").innerHTML = narrationFor(replay.step);

  /* at the end, prove the visitor's own fold lands on the desk's digest */
  const dg = document.getElementById("replay-digest");
  if (replay.step === n && n > 0) {
    const stateObj = {};
    keys.forEach((k) => { stateObj[k] = st[k].value; });
    const bytes = new TextEncoder().encode(canon(stateObj));
    crypto.subtle.digest("SHA-256", bytes).then((h) => {
      const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (replay.digestAtInit && hex === replay.digestAtInit) {
        dg.innerHTML = "Your browser just folded this record itself. Digest of the state it derived: " +
          '<span class="digest">' + hex + '</span> — <span class="win">identical to the desk\'s live digest ✓</span>';
      } else {
        dg.textContent = "Digest of the state your browser derived: " + hex +
          " (the desk's record moved while you watched — restart the replay to fold the current one).";
      }
    }).catch(() => { dg.textContent = ""; });
  } else {
    dg.textContent = "";
  }
}

function initReplay(st) {
  stopPlay();
  const byId = {};
  (st.records || []).forEach((r) => { byId[r.id] = r; });
  const ordered = (st.order || []).filter((id) => byId[id]).map((id) => byId[id]);
  (st.records || []).forEach((r) => { if (ordered.indexOf(r) < 0) ordered.push(r); });
  replay.recs = ordered;
  replay.g = buildGraph(ordered);
  replay.digestAtInit = st.digest || null;
  replay.orderKey = (st.order || []).join(",");
  resetShuffle();
  showStep(0);
}

function replayEmpty(msg) {
  stopPlay();
  replay.recs = []; replay.orderKey = ""; replay.g = null;
  document.getElementById("r-progress").textContent = "the desk is empty";
  document.getElementById("rec-card").innerHTML =
    '<div class="rec-top"><span class="rid">nothing held</span></div>' +
    '<p class="rec-effects">' + esc(msg) + "</p>";
  document.getElementById("state-grid").innerHTML = '<p style="margin:6px 0">No state — the desk holds nothing.</p>';
  document.getElementById("narration").textContent =
    "An empty desk is the honest starting point: no state exists until the record is folded. Rebuild below and the fold replays again.";
  document.getElementById("replay-digest").textContent = "";
  resetShuffle();
}

["r-restart", "r-prev", "r-play", "r-next", "r-end"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => {
    if (id !== "r-play") { replay.interacted = true; replay.autoplayDone = true; stopPlay(); }
  });
});
document.getElementById("r-restart").onclick = () => showStep(0);
document.getElementById("r-prev").onclick = () => showStep(replay.step - 1);
document.getElementById("r-next").onclick = () => showStep(replay.step + 1);
document.getElementById("r-end").onclick = () => showStep(replay.recs.length);
document.getElementById("r-play").onclick = () => {
  replay.interacted = true;
  if (replay.playing) stopPlay(); else startPlay();
};

/* ================================================================== */
/* Shuffle & re-fold — the second proof. The SAME fold port above,    */
/* run over prefixes of a scrambled arrival order. Nothing here is    */
/* special-cased: stateAt/resolveKeyAt cannot tell a shuffled prefix  */
/* from a canonical one, and that is precisely the point. The         */
/* canonical digest it must land on is the desk's live digest for     */
/* this record snapshot (replay.digestAtInit).                        */
/* ================================================================== */

const shuf = {
  order: [], step: 0, playing: false, timer: null,
  canonPrefix: [], diverged: false, finished: false,
};

function stopShufPlay() {
  shuf.playing = false;
  if (shuf.timer) { clearInterval(shuf.timer); shuf.timer = null; }
  document.getElementById("s-play").textContent = "▶ play";
}

function startShufPlay() {
  if (!shuf.order.length) return;
  if (shuf.step >= shuf.order.length) showShufStep(0);
  shuf.playing = true;
  document.getElementById("s-play").textContent = "⏸ pause";
  const delay = shuf.order.length > 20 ? 90 : 650;
  shuf.timer = setInterval(() => {
    if (shuf.step >= shuf.order.length) { stopShufPlay(); return; }
    showShufStep(shuf.step + 1);
    if (shuf.step >= shuf.order.length) stopShufPlay();
  }, delay);
}

/* The state a prefix folds to, as a plain {key: value} object — the
   same shape the replay digests at its end. */
function plainState(st) {
  const out = {};
  Object.keys(st).forEach((k) => { out[k] = st[k].value; });
  return out;
}

function dealShuffle() {
  stopShufPlay();
  const n = replay.recs.length;
  if (!replay.g || n === 0) {
    document.getElementById("s-narration").textContent =
      "The desk holds no record to shuffle. Rebuild it from the record (the burn, above), then shuffle.";
    return;
  }
  /* A fresh permutation each press (Fisher–Yates); re-deal a few
     times rather than present the canonical order as a "shuffle". */
  let order = replay.recs.slice();
  if (n > 1) {
    for (let attempt = 0; attempt < 10; attempt++) {
      order = replay.recs.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      if (order.some((r, i) => r !== replay.recs[i])) break;
    }
  }
  shuf.order = order;
  /* The canonical walk's halfway houses, so each shuffled step can
     be honestly compared with the canonical step of the same size. */
  shuf.canonPrefix = [];
  for (let k = 0; k <= n; k++) {
    shuf.canonPrefix.push(canon(plainState(stateAt(replay.g, replay.recs.slice(0, k)))));
  }
  shuf.diverged = false;
  shuf.finished = false;
  document.getElementById("s-digest-canon").textContent = replay.digestAtInit || "—";
  document.getElementById("s-digest-shuf").textContent = "—";
  document.getElementById("s-verdict").textContent = "";
  showShufStep(0);
}

function showShufStep(i) {
  const n = shuf.order.length;
  if (!n) return;
  shuf.step = Math.max(0, Math.min(i, n));
  const prevSt = shuf.step > 0 ? stateAt(replay.g, shuf.order.slice(0, shuf.step - 1)) : {};
  const st = stateAt(replay.g, shuf.order.slice(0, shuf.step));
  const stateObj = plainState(st);
  const differsNow = canon(stateObj) !== shuf.canonPrefix[shuf.step];
  if (shuf.step > 0 && shuf.step < n && differsNow) shuf.diverged = true;

  document.getElementById("s-progress").textContent =
    "arrival " + shuf.step + " of " + n + " (shuffled)";

  document.getElementById("s-order").innerHTML = shuf.order.map((r, idx) =>
    '<span class="chip' + (idx < shuf.step ? " done" : "") + (idx === shuf.step - 1 ? " now" : "") + '">' +
    (idx + 1) + ". " + esc(r.id) + "</span>").join("");

  const grid = document.getElementById("s-state");
  const keys = Object.keys(st);
  if (!keys.length) {
    grid.innerHTML = '<p style="margin:6px 0">No state yet — nothing has arrived.</p>';
  } else {
    grid.innerHTML = "<table><tr><th>key</th><th>standing value</th><th>held by</th></tr>" +
      keys.map((k) => {
        const res = st[k];
        const changed = !prevSt[k] || prevSt[k].holder !== res.holder ||
          canon(prevSt[k].value) !== canon(res.value);
        return '<tr' + (changed ? ' class="flash"' : "") + '><td>' + esc(k) + "</td><td><b>" +
          esc(fmtVal(res.value)) + '</b></td><td class="holder">' + esc(res.holder) + "</td></tr>";
      }).join("") + "</table>";
  }

  const narr = document.getElementById("s-narration");
  if (shuf.step === 0) {
    narr.innerHTML = "A fresh arrival order for the same " + n + " records — the chips above " +
      "are the sequence this fold will consume. Step through it, or fast-forward: " +
      "only the end state is allowed to agree with the canonical walk. The steps are not.";
  } else if (shuf.step < n) {
    const r = shuf.order[shuf.step - 1];
    narr.innerHTML = "<b>" + esc(r.id) + "</b> arrives (" + shuf.step + " of " + n + "). " +
      (differsNow
        ? "The state so far <b>differs</b> from the canonical walk at this step — a different halfway house, from different arrivals. Keep going: watch whether it matters."
        : "The state so far happens to match the canonical walk at this step. It is not obliged to.");
  } else {
    finishShuffle(stateObj);
  }
}

function finishShuffle(stateObj) {
  shuf.finished = true;
  const bytes = new TextEncoder().encode(canon(stateObj));
  crypto.subtle.digest("SHA-256", bytes).then((h) => {
    const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
    document.getElementById("s-digest-shuf").textContent = hex;
    const same = replay.digestAtInit && hex === replay.digestAtInit;
    document.getElementById("s-verdict").innerHTML = same
      ? '<span class="badge ok">IDENTICAL ✓</span>'
      : '<span class="badge bad">DIFFERENT ✗</span>';
    document.getElementById("s-narration").innerHTML =
      (shuf.diverged
        ? "The paths differed — step for step, this walk's halfway houses were not the canonical walk's. The destination didn't. "
        : "This shuffle happened to walk the canonical halfway houses too — deal another; the paths are free to part. Either way, the destination is the point. ") +
      "The fold doesn't care what order work arrived in — the same completions land on the same state. " +
      (same
        ? "Your browser just folded " + shuf.order.length + " records in scrambled arrival order and landed on the desk's digest."
        : "Your browser folded " + shuf.order.length + " records in scrambled arrival order and did NOT land on the desk's digest — the desk's record moved while you shuffled; restart to fold the current one.");
  }).catch(() => {});
}

function resetShuffle() {
  stopShufPlay();
  shuf.order = []; shuf.step = 0; shuf.diverged = false; shuf.finished = false;
  document.getElementById("s-progress").textContent = "press shuffle to scramble the arrival order";
  document.getElementById("s-order").innerHTML = "";
  document.getElementById("s-state").innerHTML = '<p style="margin:6px 0">No shuffled fold yet.</p>';
  document.getElementById("s-narration").textContent =
    "Every press deals the same records in a new arrival order. Watch the end state: it is not allowed to move.";
  document.getElementById("s-digest-canon").textContent = "—";
  document.getElementById("s-digest-shuf").textContent = "—";
  document.getElementById("s-verdict").textContent = "";
}

document.getElementById("s-shuffle").onclick = () => dealShuffle();
document.getElementById("s-prev").onclick = () => { stopShufPlay(); showShufStep(shuf.step - 1); };
document.getElementById("s-next").onclick = () => { stopShufPlay(); showShufStep(shuf.step + 1); };
document.getElementById("s-play").onclick = () => { if (shuf.playing) stopShufPlay(); else startShufPlay(); };
document.getElementById("s-end").onclick = () => { stopShufPlay(); showShufStep(shuf.order.length); };

/* ================================================================== */
/* Rendering the desk's projection (the depth, below the story)       */
/* ================================================================== */

function render(st) {
  if (!st) return;
  lastState = st;
  document.getElementById("record-link").href =
    "https://gitpp.superinstance.dev/?project=" + encodeURIComponent(st.project || project);
  document.getElementById("updated").textContent =
    st.updatedAt ? "projection as of " + st.updatedAt : "";
  document.getElementById("lines").innerHTML =
    (st.lines && st.lines.length ? st.lines : ["—"]).map((l) => "<li>" + esc(l) + "</li>").join("");
  document.getElementById("digest-now").textContent = st.digest || "— (desk is empty)";
  document.getElementById("root-now").textContent = st.root || "— (desk is empty)";

  const conf = document.getElementById("conflicts");
  if (!st.conflicts || !st.conflicts.length) {
    conf.innerHTML = "<p>No contested keys — nothing needs deciding.</p>";
  } else {
    conf.innerHTML = st.conflicts.map((c) =>
      '<div class="card"><b>' + esc(c.key) + '</b> — won by <span class="win">' + esc(c.winner) +
      '</span>; losers preserved: <span class="lose">' + c.losers.map(esc).join(", ") + '</span> ' +
      '<button data-why="' + esc(c.key) + '">why?</button>' +
      '<pre id="why-' + esc(c.key) + '" style="display:none"></pre></div>'
    ).join("");
    conf.querySelectorAll("[data-why]").forEach((b) => {
      b.onclick = async () => {
        const key = b.getAttribute("data-why");
        document.getElementById("d-key").value = key;
        const pre = document.getElementById("why-" + key);
        pre.style.display = "block";
        pre.textContent = "asking the record…";
        try {
          const res = await call("why", key);
          pre.textContent = res.explanation + "\\n\\n" + JSON.stringify(res, null, 2);
        } catch (e) { pre.textContent = "why failed: " + e.message; }
      };
    });
  }

  const wit = document.getElementById("witnesses");
  if (!st.witnesses || !st.witnesses.length) {
    wit.innerHTML = "<p>No witnesses in this project.</p>";
  } else {
    const max = Math.max(...st.witnesses.map((w) => w.recordsBehind ?? -1));
    wit.innerHTML = "<table><tr><th>witness</th><th>records behind</th></tr>" +
      st.witnesses.map((w) =>
        "<tr><td>" + esc(w.id) + (w.recordsBehind === max && max >= 0 ? " ← stalest" : "") +
        "</td><td>" + (w.recordsBehind ?? "—") + "</td></tr>").join("") + "</table>";
  }

  const recsEl = document.getElementById("records");
  if (!st.records || !st.records.length) {
    recsEl.innerHTML = "<p>The desk holds no records.</p>";
  } else {
    const byId = {};
    st.records.forEach((r) => { byId[r.id] = r; });
    const ordered = (st.order || []).filter((id) => byId[id]).map((id) => byId[id]);
    st.records.forEach((r) => { if (ordered.indexOf(r) < 0) ordered.push(r); });
    recsEl.innerHTML = "<table><tr><th>#</th><th>id</th><th>kind</th><th>parents</th><th>effects</th><th>reason</th></tr>" +
      ordered.map((r, idx) =>
        "<tr><td>" + (idx + 1) + "</td><td>" + esc(r.id) + "</td><td>" + esc(r.kind) + "</td><td>" +
        ((r.parents && r.parents.length) ? r.parents.map(esc).join(", ") : "—") + "</td><td>" +
        (r.effects ? Object.keys(r.effects).sort().map((k) => esc(k) + "=" + esc(fmtVal(r.effects[k]))).join("<br>") : "") +
        "</td><td>" + (r.reason ? esc(r.reason) : "—") + "</td></tr>").join("") + "</table>";
  }

  /* replay bookkeeping: fresh snapshot when the record changes under
     a visitor who has not taken the controls; an empty desk empties
     the stage (that is the burn, made visible). */
  if (!st.ready || !st.records || !st.records.length) {
    replayEmpty("The desk's memory was burned — or has not been built yet. Rebuild it from the record alone, below, and watch the fold replay.");
  } else if ((st.order || []).join(",") !== replay.orderKey) {
    const wasInteracted = replay.interacted;
    initReplay(st);
    if (!wasInteracted && !replay.autoplayDone && replay.recs.length >= 1 && replay.recs.length <= 12) {
      replay.autoplayDone = true;
      setTimeout(() => { if (!replay.interacted) startPlay(); }, 500);
    }
  }
}

document.getElementById("refresh").onclick = () => call("refresh").catch(() => {});
document.getElementById("draft").onclick = async () => {
  const key = document.getElementById("d-key").value.trim();
  const id = document.getElementById("d-id").value.trim();
  const reason = document.getElementById("d-reason").value.trim();
  const out = document.getElementById("draft-out");
  if (!key || !id) { out.textContent = "Give the draft a key and a new record id first."; return; }
  try {
    const res = await call("draftOverride", key, id, reason);
    out.textContent = JSON.stringify(res, null, 2);
  } catch (e) { out.textContent = "draft failed: " + e.message; }
};
document.getElementById("burn-btn").onclick = async () => {
  stopPlay();
  const res = await call("burn");
  burnedDigest = res.burnedDigest;
  burnedRoot = res.burnedRoot;
  document.getElementById("digest-before").textContent = burnedDigest || "—";
  document.getElementById("digest-after").textContent = "—";
  document.getElementById("root-before").textContent = burnedRoot || "—";
  document.getElementById("root-after").textContent = "—";
  document.getElementById("burn-verdict").textContent = "desk burned — it now holds nothing.";
};
document.getElementById("rebuild").onclick = async () => {
  const res = await call("rebuild");
  document.getElementById("digest-after").textContent = res.digest || "—";
  document.getElementById("root-after").textContent = res.root || "—";
  const v = document.getElementById("burn-verdict");
  if (burnedDigest && burnedRoot && res.digest === burnedDigest && res.root === burnedRoot) {
    v.innerHTML = '<span class="badge ok">IDENTICAL ✓</span> state and closure root — the desk is a projection.';
  } else if (burnedDigest) {
    v.innerHTML = '<span class="badge bad">DIFFERENT ✗</span> the record changed, or the desk lied.';
  } else {
    v.textContent = "rebuilt (burn first to run the full drill).";
  }
};
</script>
</body>
</html>
`;
