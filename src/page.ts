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
  h1 { font-size: 20px; margin: 0 0 4px; }
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
  a { color: #58a6ff; }
</style>
</head>
<body>
<h1>The Captain's Desk</h1>
<p class="sub">A live projection of a git.pp record. The desk stores nothing that
matters — burn it, rebuild it, the record re-derives the same desk.
Truth lives at <a href="https://gitpp.casey-digennaro.workers.dev">the record</a>, not here.</p>

<div class="bar">
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

<h2>The five lines</h2>
<ol class="lines" id="lines"><li>—</li></ol>

<h2>Conflicts — read why, then rule</h2>
<div id="conflicts"><p>—</p></div>

<h2>Witnesses</h2>
<div id="witnesses"><p>—</p></div>

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

<h2>The burn test — the desk is a projection, prove it</h2>
<div class="card">
  <p>Digest of the derived state, as the desk now holds it:</p>
  <p class="digest" id="digest-now">—</p>
  <div class="bar">
    <button id="burn">🔥 burn the desk</button>
    <button id="rebuild">rebuild from the record alone</button>
    <span id="burn-verdict"></span>
  </div>
  <p>Digest before burn: <span class="digest" id="digest-before">—</span></p>
  <p>Digest after rebuild: <span class="digest" id="digest-after">—</span></p>
</div>

<footer>git.pp-desk — a spike of the "adopt as projection" verdict
(research/deep/cloudflare-agents-fit.md in the R&amp;D repo). Read-only:
this worker holds no admin key and cannot write to the record.</footer>

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

function render(st) {
  if (!st) return;
  lastState = st;
  document.getElementById("updated").textContent =
    st.updatedAt ? "projection as of " + st.updatedAt : "";
  document.getElementById("lines").innerHTML =
    (st.lines && st.lines.length ? st.lines : ["—"]).map((l) => "<li>" + esc(l) + "</li>").join("");
  document.getElementById("digest-now").textContent = st.digest || "— (desk is empty)";

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
document.getElementById("burn").onclick = async () => {
  const res = await call("burn");
  burnedDigest = res.burnedDigest;
  document.getElementById("digest-before").textContent = burnedDigest || "—";
  document.getElementById("digest-after").textContent = "—";
  document.getElementById("burn-verdict").textContent = "desk burned — it now holds nothing.";
};
document.getElementById("rebuild").onclick = async () => {
  const res = await call("rebuild");
  document.getElementById("digest-after").textContent = res.digest || "—";
  const v = document.getElementById("burn-verdict");
  if (burnedDigest && res.digest === burnedDigest) {
    v.innerHTML = '<span class="badge ok">IDENTICAL ✓</span> the desk is a projection.';
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
