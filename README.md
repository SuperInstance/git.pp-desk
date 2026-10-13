# git.pp-desk — the captain's desk, as a projection

**Live:** https://gitpp-desk.casey-digennaro.workers.dev
**The record it watches:** https://gitpp.casey-digennaro.workers.dev (`poc-quilt-1` by default)

A spike, built 2026-10-13 to play-test one verdict from the git.pp
R&D programme: **adopt Cloudflare Agents as projection**
(`research/deep/cloudflare-agents-fit.md` in the private R&D repo).
The claim under test: an always-on, stateful desk is beautiful
exactly insofar as it is *disposable* — everything it holds must be
re-derivable from the record alone. This repo is that claim with a
URL on it.

## What it is

One Agent class, `Desk` (Cloudflare Agents SDK, a Durable Object),
one instance per git.pp project. The Desk:

- **`refresh()`** — fetches `/api/state` + `/api/records` for its
  project from the live git.pp Worker (both public, credential-free)
  and stores *only a projection*: the derived state, the conflicts,
  per-witness `recordsBehind`, the record set it was derived from, a
  sha256 digest over the canonical state JSON (spike-grade pin), and
  the captain's five digest lines (the Middleman Kit's `digest.py`,
  ported). Every `setState` broadcasts to connected WebSockets.
- **A 60-second schedule** re-derives the projection. The cadence is
  declared in [`desk.json`](desk.json), committed in this repo and
  registered by `onStart` on every wake. *Spike simplification, stated
  plainly:* the full design declares cadences **in the record** (a
  declaration record, like every other default in the scoped cascade)
  and re-registers them on wake; here the declaration lives in the
  repo we ship from. The shape is the same — the alarm is the desk's,
  the intent is written somewhere the desk does not own.
- **`why(key)`** — the chair's "read why" gesture: replays DESIGN §2
  (class precedence → exact maximality → cleanest chain → smallest
  id) over the records the desk holds and returns the winner, the
  preserved losers, and the ancestry counts that elected them.
- **`draftOverride(key, recordId, reason)`** — drafts the captain's
  ruling as a pp.py-ready override record (parents = the current
  frontier; effect = the key's standing value, under the captain's
  reason) and hands it back. **`recordId` names the new record.**
  THE DESK NEVER WRITES: there is no admin key in this repo or
  worker, no Artifacts binding, no push path. The desk drafts; the
  captain's own tooling decides and pushes.
- **`burn()` / `rebuild()`** — the deciding test from the fit note,
  as a push-button drill: burn wipes the stored projection entirely;
  rebuild re-derives it from the record alone. The desk is a
  projection iff the digest comes back identical.

The page at `/` is the chair, arranged as a story first and depth
below — a stranger should meet the claim, the mechanism, and the
proof before any table:

1. **The claim.** "State is what completed tasks leave behind." —
   two plain sentences of explanation, and the pointer at the proof.
2. **Watch the fold.** A replay steps the record in the fold's
   application order and re-derives the state *in the visitor's own
   browser* (a client-side port of the same DESIGN §2 rule),
   narrating each resolution as it happens — who holds each key and
   why, in fold terms. On `poc-quilt-1` the honest arc is sharper
   than the intuitive one: 30 lands; **60 never holds the key** (the
   rival chains tie on cleanliness, so the smallest id keeps 30);
   the captain's override takes it at 45 on class precedence, with
   its reason quoted; then 99 — the biggest value, the latest
   arrival, on a branch that never descended from the ruling —
   loses too. The prefix behaviour was checked step by step against
   the Python referee (`referee/fold.py`) during the build. At the
   end, the browser's own fold is digested and compared with the
   desk's live digest, on the page.
3. **The burn, centre stage.** The burn/rebuild drill, framed as
   the demonstration it is — visitor-safe (the record is untouched;
   the desk also heals on its cadence).
4. **Below the fold, the depth:** the five lines, conflicts with a
   *why?* button per key, the witness table, the record itself in
   application order, the draft form, and links (submission repo,
   conformance totals, demo video).

All of it live over the agent's WebSocket. A small HTTP proxy
(`/api/desk`) exposes the same callables for curl and for the
playtest below.

## The boundary (why the desk can't become a second truth)

May live in the desk: fold output, the records it folded from, the
digest, the alarm. May never live here: decisions, rulings, drafts
that matter, learned defaults — anything another agent must see or
the captain has decided. Those belong in the record, as records. On
any disagreement between this page and the record, the record wins
and the desk rebuilds. That is the whole design; the code in
[`src/index.ts`](src/index.ts) is mostly this paragraph, enforced.

## Playtest (2026-10-13, against live `poc-quilt-1`)

Run it yourself: `node test/playtest.mjs`. The digest compared in
check 1 is computed *in the test script*, by a second implementation
of the canonical form, over bytes fetched directly from the git.pp
Worker — never through the desk.

```
independent digest (from the record, computed here): 010e942c049515c29650c7901b8bd34fdf25d16a076e2ba781d1535a3cb95823
desk digest        (from the Desk's projection):     010e942c049515c29650c7901b8bd34fdf25d16a076e2ba781d1535a3cb95823
PASS  1. desk digest == independent digest

The five lines, as the desk serves them:
  poc-quilt-1: 8 records — 5 tasks completed, 2 witnesses, 1 override.
  Headline state: config.timeout=45 · env.oracle_disk_pct=93 · env.oracle_load1_x100=17 · feature.cache=on
  Conflicts: 1 decided by the record alone — most contested config.timeout won by override-1; 3 losers preserved.
  Staleness: witness-1 is the stalest witness, 6 records behind the frontier.
  Open question: witness-1 is 6 records behind — is its view of the world still current?
witnesses: witness-1 (6 behind), witness-2 (3 behind)

why(config.timeout):
  override-1 wins config.timeout=45 on class precedence: a override record outranks
  every rival outright (override > task > witness), so ancestry never had to speak.
  Its stated reason: "captain: 45 is the safe value".
PASS  3. why() explains the standing winner — winner=override-1, decidedBy=class

drafted override:
  {"id":"override-desk-test","kind":"override","parents":["task-c","task-d","witness-1","witness-2"],
   "effects":{"config.timeout":45},"reason":"playtest: captain confirms the standing value"}
PASS  4. draft parents == frontier — frontier=["task-c","task-d","witness-1","witness-2"]

burn: burnedDigest=010e942c049515c29650c7901b8bd34fdf25d16a076e2ba781d1535a3cb95823;
      desk now holds digest=null, records=0, ready=false
PASS  2a. burn leaves the desk empty
rebuild digest: 010e942c049515c29650c7901b8bd34fdf25d16a076e2ba781d1535a3cb95823
PASS  2b. rebuild digest == pre-burn digest — IDENTICAL
PASS  5a. page serves
PASS  5b. websocket broadcasts the projection

All checks passed.
```

**Front-page rebuild (2026-10-13, later):** the page was re-staged
story-first (claim → replay → burn, depth below the fold; see
"What it is"). The playtest was re-run against the redeployed desk:
**all checks pass**, including a new check 5c asserting the served
HTML carries the claim, the fold, and the burn in that order before
the depth sections (claim@4795, fold@5373, burn@6506, depth@7461 in
the served bytes). Checks 1–4 are unchanged and still green —
independent digest `010e942c…95823` before and after.

**The cadence is real, not decorative.** A first `status` call woke
the `poc-scale-1` desk cold (`ready:false, digest:null`). No further
request was made. ~80 s later the same call returned
`ready:true, digest:f1e78b16770770783a9ed5adf9bd25e50fe00cb209a5331b91f190daaac4380d`,
populated by the desk's own scheduled tick — the digest became the
middleman's habit, not fleet plumbing, exactly as the fit note
promised.

## Run your own

```
npm install
npm run dev      # local
npm run deploy   # wrangler deploy (needs a Cloudflare account with
                 # Workers + Durable Objects; DESK binding and the
                 # SQLite migration are declared in wrangler.toml)
```

Point `desk.json`'s `source` at any git.pp-compatible record worker;
the desk reads only its two public endpoints.

## License

MIT © 2026 SuperInstance.
