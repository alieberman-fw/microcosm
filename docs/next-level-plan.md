# Next-Level Plan — Reliability, the Living Forum, Detached Scale, and Docs

> Implementation guide for the four-phase build that takes Microcosm from "the loop works"
> to "the loop is bulletproof, feels alive, runs detached at 100+ panelists, and teaches
> itself." Each phase merges independently, is gated by its acceptance criteria, and
> updates README + /docs in the same PR (CLAUDE.md §12 convention). **Order matters:**
> Phase 1 hardens the substrate every later phase builds on.

---

## Phase 1 — Bulletproof the core (test harness, round semantics, quick wins)

**Goal:** every mode terminates correctly under every stop condition, provably, forever —
plus the small cleanups that shouldn't wait.

### 1a · Offline engine test suite (the centerpiece)

`EngineContext` already receives its Anthropic client by injection — so the ENTIRE engine
(all seven choreographies, suspend/resume, polls, convergence) is testable with a
**FakeAnthropic** that returns canned responses instantly. Zero tokens, milliseconds per run.

- Add **vitest** (`npm t`); tests live in `tests/engine/*.test.ts`.
- `tests/helpers/fake-anthropic.ts`: a scriptable client — per-call responders keyed by
  system-prompt markers (turn / poll / router / stability judge), configurable stop_reason,
  malformed-JSON injection, latency injection, call counting.
- **The matrix** (every cell asserted):
  - 7 modes × {stability, fixed, budget} → exact post counts per round, exact
    `stopReason` (`stability | rounds | budget | choreography`), `converged` only when the
    stability rule fired.
  - **Suspend/resume** per mode: deadline forced mid-round, mid-poll, and at the
    round boundary → resume produces NO duplicate posts, NO skipped polls
    (regression: the Tribunal judge-skip bug), `polledRounds` only marks completed polls.
  - **Jury arithmetic**: tally math, movement counting, score-stability stop (pure functions —
    extract `scoreOf`/`scoresAt`/tally-line into exported helpers so they unit-test directly).
  - **Failure injection**: empty responses (adaptive-thinking drain), API errors mid-round,
    unparseable poll batches → the run either retries, degrades honestly, or fails LOUD —
    never silently truncates.
  - Pure-function units: `compilePersonaPrompt` (seat mandate, anti-formula rules — snapshot
    tests so prompt drift is a visible diff), `stripSelfPrefix`, question-label word-boundary
    fallback, casting seat-continuation merge (no dupes, one adversarial).
- **Live smoke script** `scripts/smoke-live.mjs` (on-demand, not CI): the proven cookie-auth
  E2E — creates an org, casts a small panel, runs ONE tiny economy round per mode, checks
  posts/polls/stop-reason/run_result, synthesizes one report, deletes everything, re-disables
  email. Budget target < $1 per full sweep. Run before every release-sized merge.
- **Convention change:** every engine/report PR must keep `npm t` green; new engine behavior
  lands with its matrix cell.

### 1b · Round semantics — defined once, documented everywhere

One canonical table (README + /docs "Interaction modes" + run-config help copy), because
"what is a round" genuinely differs per mode:

| Mode | One round = | Round ends when | Run ends when |
|---|---|---|---|
| Agora | An opening post + up to N replies routed by speaker rule | Reply budget for the round is spent | Rounds cap · positions stable 2× (≥ round 3) · post budget |
| Roundtable | Every lead speaks once, in order | Last lead has spoken | Same as Agora |
| Tribunal | 3 FOR args → 3 AGAINST rebuttals → judge's note | Judge rules the round | Rounds cap · post budget (always adversarial — no stability stop) |
| Jury | Every juror scores (blind in R1; sees tally after) + code-computed TALLY | Tally posts | Scores stop moving (nobody ±1) · rounds cap · post budget |
| Chamber | *Phases, not rounds*: takes → blind review → chair synthesis | Phase completes | Choreography completes (never "converged") |
| Desk | *Phases*: assign → section drafts → director's memo | Phase completes | Choreography completes |
| Expedition | *Phases*: questions → research → analysis → alternatives → verify | Phase completes | Choreography completes |

Crowd polls fire at every round boundary (Agora/Roundtable/Tribunal/Jury) and twice in
Chamber; Desk/Expedition are research choreographies and don't poll.

### 1c · Quick wins folded in

- **Remove SIM DAYS** — the engine never reads `duration_days`; it's a dead control that
  costs comprehension. Drop the UI row + estimator reference, keep the config key tolerated
  on read (old sims), update CLAUDE.md §4.1/§4.2.
- Canvas labels → **first name + last initial** (matches the feed byline exactly). *(Pulled
  forward from Phase 2 because it's an hour of work.)*

**Acceptance:** full matrix green offline in < 30s; smoke sweep passes live across all
seven modes; docs/README carry the table; SIM DAYS gone.

---

## Phase 2 — The living forum (density, threads, votes, roster)

**Goal:** the feed reads like a real community arguing — deep reply chains, visible
endorsement, and a knowable cast — because "20 posts then a report" undersells what an
agent simulation is.

### 2a · Threaded sub-replies + interaction density

- **Data:** already supported — `posts.reply_to` forms arbitrary-depth chains. No migration.
  Depth is computed client-side by walking `reply_to`.
- **Engine:**
  - The reply router targets **any prior post this round** (weighted toward recent + most
    contested), not just the last post → real chains (John → Sarah → Bob → Jim).
  - **Density scales with the panel and the mode**: replies-per-round becomes
    `~1.5–2× leads` in Agora (was ≤6), Tribunal rebuttals gain counter-rebuttal slots,
    Roundtable gains an optional "crossfire" half-round after the circuit. A new run-config
    control **INTERACTION DENSITY (focused · lively · bustling)** scales these multipliers
    and is priced by the estimator up front.
  - **Crowd interjection bursts** (the demo's "+34 POSTS" grammar, spec §5): between rounds,
    sample 3–6 crowd members to post short in-character reactions threaded under the posts
    they're reacting to — Haiku-batched, one call per burst, cheap.
- **Feed UI:** reddit-style nesting — indent per depth (capped visual depth ~5), collapse /
  expand per subtree ("— hide 7 replies"), chain lines in `--ln3`, auto-collapse resolved
  chains as the run scrolls. Burst rollups expand in place (already persisted, already real).
- **Take the Floor lands here** (already the backlog's NEXT): the user posts into the same
  threaded feed and @mentions agents — it is literally a reply node in the chain, so the
  threading work and the participation feature are one surface.

### 2b · Votes

- **Migration `0014_post_votes.sql`:** `post_votes(sim_id, seq, voter_key, voter_name, vote
  smallint, ts)` + unique `(sim_id, seq, voter_key)` + org RLS. A table (not jsonb) so
  hover-tooltips, counts, and report queries stay cheap.
- **Engine:** after each round, ONE batched Haiku pass per ~20 voters: each lead + a crowd
  sample votes ▲/▼ on that round's posts *in character* ("would you endorse this argument?").
  Streamed as a new `{type:"votes"}` §6.2 event; persisted.
- **UI:** ▲ n / ▼ n chips on every post/reply; hover lists voter names + roles (from the
  table); highest-endorsed post of each round gets a subtle accent ring.
- **Report:** the synthesizer receives vote totals — "most-endorsed argument" becomes a
  citable signal, and dissents that drew heavy ▼ get flagged as contested.

### 2c · Run-screen roster rail

- Collapsible right rail ("N ON THE PANEL →") listing every lead as a card: avatar, seat
  role, discipline, adversarial tag, stances, two-line backstory; click → full
  PersonaProfile. Clicking a canvas node opens the same card. (Same rail grammar as the
  hand-pick roster and the Conversations roster — one pattern everywhere.)

**Acceptance:** an Agora run at `lively` produces visibly threaded chains ≥3 deep with
in-feed collapse; votes render with hover attribution; roster rail ships on the run screen;
Phase 1 matrix extended to density/threading invariants (every reply_to resolves, no cycles)
and stays green.

---

## Phase 3 — Detached runs, web search, 100+ panelists

**Goal:** runs are server-owned things you *observe*, not browser tabs you babysit — then
scale panel size on top of that foundation.

### 3a · Runs survive navigation (do this FIRST in the phase)

Today the browser drives continuation slices; closing the tab cancels via stream-abort.
Inversion, in two steps:

1. **v1 — self-driving slices on Vercel:** decouple engine cancellation from stream
   disconnect (a closed stream stops *sending*, never stops *writing to Postgres*). At each
   slice boundary the launch route schedules its own successor server-side
   (`waitUntil(fetch(next slice))`) with `config.run_state` as the single source of truth +
   a heartbeat timestamp so a dead chain is detectable and any viewer can restart it.
   A `runs are yours to leave` banner replaces the reconnect logic.
2. **The observer client:** LiveRun stops being the driver — on mount it loads the
   transcript and **tails new posts/events via Supabase Realtime** (spec §9 finally earns
   its keep) with polling fallback. Any number of tabs can watch one run; Home's
   IN-PROGRESS strip links straight into live runs.
3. **End-state (unchanged from spec §6.3):** the Python/FastAPI + swarms worker on
   Railway/Fly for truly unbroken long processes. The event contract is identical; it
   replaces the slice chain without touching the UI. Trigger for building it: sustained
   100+ panelist runs (3c) or slice-chain flakiness in prod.

### 3b · Web search as an agent tool (§7 Phase 1 tool #2)

- Anthropic **server-side web search tool** — no scraping infra: pass
  `tools: [{type: "web_search_20260209", name: "web_search", max_uses: 2}]` on lead turns
  (Sonnet/Opus tiers; Haiku uses the basic `web_search_20250305` variant — select per model,
  never hardcode).
- **Per-sim toggle** in run config (`TOOLS: DOCS ONLY · DOCS + WEB SEARCH`), default off;
  estimator prices it ($10/1K searches + tokens).
- Engine extracts `server_tool_use` / `web_search_tool_result` blocks → post meta gains
  `searches: [{query, results: [{title, url}]}]` → logged to `tool_runs` (schema already
  has the table).
- **Feed:** posts that searched carry a "🔍 SEARCHED THE WEB" card — click to expand the
  query + sources with links. **Report:** web citations render alongside doc citations
  ("source: tool", per §7).

### 3c · 100+ panelists — sub-panels (§3's answer, backlog #43)

Not "raise MAX_SEATS and pray" — a hierarchy, exactly what the spec prescribes:

- **Casting:** >20 seats auto-organize into **discipline sub-panels** of 6–10 (the seat
  continuation loop from the truncation fix already builds arbitrarily long seat lists in
  batches; generation already runs in parallel chunks). MAX_SEATS → 120.
- **Choreography:** each round = sub-panels deliberate **in parallel** (independent Agora/
  Roundtable cells) → each sub-panel's chair posts a roll-up → chairs hold a short
  **plenary** exchange → next round's agendas flow back down. Feed groups by sub-panel with
  the plenary as the spine; canvas renders cluster orbits (the demo's discipline-cluster
  grammar at full size).
- **Prereqs, honestly:** 3a is required (a 100-lead round is inherently long-running);
  2a's density controls cap the post explosion; the estimator must show the real price
  before launch (a 100-lead × 5-round bustling run is a triple-digit-dollar decision —
  that's the §4.1 "no surprise bills" contract, not a limitation).
- Phase 1 matrix grows sub-panel cells (roll-up integrity: every sub-panel reports each
  round; plenary cites roll-ups; resume across sub-panel boundaries).

**Acceptance:** close the tab mid-run, return in 10 minutes → the run advanced and the
screen reattaches live; web-search posts show clickable source cards and tool_runs rows; a
60-lead, 2-sub-panel-per-discipline pilot completes end-to-end with a report; costs shown
up front within ±40% of actual.

---

## Phase 4 — The docs that teach the platform

**Goal:** /docs stops describing the product and starts *demonstrating* it — every core
surface has a live, animated, token-styled miniature.

- **Live mini-run replay**: the Site 47-A golden fixture (`lib/replay-fixture.ts`) embedded
  in /docs as a playable miniature of the run screen — canvas + threaded feed + polls at 8×
  speed with pause/scrub. One component, reused by the landing page.
- **Round-lifecycle animations per mode**: extend `ModeDiagram` with a stepper that walks
  ONE round of each mode with the 1b table as captions (Agora post→replies→poll;
  Tribunal args→rebuttals→judge; Jury blind→tally→re-score...).
- **New/updated pages:** "Anatomy of a run" (rounds, stop rules, suspend/resume, honest stop
  reasons); "The forum" (threads, votes, bursts, Take the Floor — with a live threaded
  vignette); "Tools & grounding" (docs vs web search, how citations flow to the report);
  "Reading a report" (annotated miniature report with criteria receipt + verdict grammar);
  expanded "Casting at scale" (sub-panels).
- **Interaction:** every vignette is real HTML/CSS/JS in the design tokens — no videos, no
  screenshots — reusing the actual product components in miniature (the established
  vignette pattern: CrowdBand, ModeDiagram, chat vignette).
- Keep the §12 convention: after Phase 4, every feature PR updates its demo vignette too.

**Acceptance:** a new user can go from zero to understanding rounds, modes, threading,
votes, tools, and reports without leaving /docs; every animation runs in both themes.

---

## Sequencing & spec updates

**1 → 2 → 3 → 4.** Phase 1 is the substrate (Adam's explicit first priority); Phase 2
changes the transcript shape that Phase 3's observer/report and Phase 4's vignettes
consume; Phase 3's detached runner unlocks Phase 3's own scale work; Phase 4 documents the
final behavior. Take the Floor ships inside Phase 2. Each phase = one or more PRs off
`origin/main`, README checklist + /docs updated per PR, CLAUDE.md updated where the spec
changes (SIM DAYS removal, density parameter, votes event, sub-panel choreography, tools).
