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
## Phase 3 — reports, trust, tools, threads, scale (amended 2026-07-29)

**What we're building, in plain terms** (the product view; technical detail under each):

### 3a · Reports anyone can read — audit first, then rebuild  ✅ SHIPPED (PR #54 + follow-ups: poll instrument, standalone SIMPLIFY page)

Every report opens with a **bottom line** (the answer / what would change it / what to do
next), every brief question gets a **direct answer up front** with reasoning below it, and
a **Plain English toggle** flips the whole report into a jargon-free version — same
answers, same numbers, translated. Preceded by an audit of real generated reports against
their briefs.

- **Audit findings (2026-07-29, all org reports):** post-completeness-gate reports are
  structurally complete; pre-gate reports show 0-receipts / 0-risks holes (historical —
  re-synthesize a new version to repair). Prose faults: findings lead with mechanism not
  answer; exec summaries are 190-word chained sentences; analyst labels replace the user's
  question; jargon (REA, MX-U, TI) never expanded.
- **Build:** `bottom_line{answer,changes_it,next_step}` + per-section `answer` +
  `numbers[{label,value}]` in schema/prompt/completeness-gate; CLARITY RULES in the synth
  system (answer-first, ≤25-word sentences, expand acronyms at first use, bottom line is
  jargon-free); PLAIN ENGLISH toggle = one cached translation pass over the frozen spec
  (`spec.plain`, REPORT_PLAIN_SCHEMA + `plainSpecIncomplete` gate + glossary; never a
  re-synthesis so views cannot disagree; reports_update RLS, migration 0016); sentiment-
  by-round strip renders from the existing `spec.sentiment`.

### 3b · Headlines that fit the question  ✅ SHIPPED (PR #56 — typed leads, INSIGHT bucket, synthesis heartbeat)

The report lead matches the ask: **decision** (go / conditional / no-go / split — today's
chip), **key finding** (the universal catch-all: any brief that isn't a decision/valuation/
hearing gets a committed most-important-conclusion headline — nothing falls outside the
system), **price range** (valuations, with walk-away marker), **approval odds** (hearings).
Commitment is mandatory in every kind. Technical: typed `lead{kind,…}` beside verdict
(back-compat default = verdict), synthesizer picks kind from the brief + the silent
`brief.template`, per-kind lead visuals in ReportView, Reports tab + Home outcomes gain an
insight bucket, gate checks kind-appropriate fields.

### 3c · Runs you can walk away from  ✅ SHIPPED (PR #57 — waitUntil worker, self-scheduling slices, observer run screen, graceful STOP)

Close the tab and the run keeps going server-side; any tab watches live. v1: decouple
engine cancellation from stream disconnect; slices schedule their own successors
(`waitUntil`) with `config.run_state` + heartbeat as truth; LiveRun becomes an observer
tailing Supabase Realtime (polling fallback); Home's IN-PROGRESS strip links into live
runs. End-state stays the Python/swarms worker (§6.3) when runs outgrow the slice chain.

### 3d · Agent tools v1 — web research, agent-decided, user-controlled  ⟵ NEXT

Agents decide **when** a tool is worth using (a lawyer answering from expertise doesn't
search; an economist citing current rates does) — tool use is never per-post mandatory.
**Default OFF**; a TOOLS section in run config shows each tool as a card with a plain
explanation — enable all or pick some. Built as a **rack**: one generic tool interface so
parcel data / historical web / economic series become new cards later, no re-architecture.
Searches render as clickable cards in the feed, logged to `tool_runs`, citable by the
report as "source: tool". Technical: Anthropic server-side web search tool on lead turns,
model-appropriate variant per tier, per-simulation result cache so the panel shares one
factbase, `config.tools` allowlist.

### 3e · The forum acts like a real forum (living threads)

Agents can return to earlier posts — even prior rounds — to reply, extend sub-threads, or
vote late (including flipping an earlier vote). Fresh discussion still dominates. UI: the
floating pill becomes **"↓ GO TO BOTTOM"** with an activity count; revival replies carry a
breadcrumb chip that jumps to the parent. Zero-errors approach: this changes only WHERE
replies aim — counts per round, budgets, resume dedupe, and termination are untouched by
construction. Technical: `pickReplyTarget` widens to all substantive posts with λ≈0.4
round-decay + necro cap (focused 0% — the existing matrix stays pinned — lively ~25%,
bustling ~35%, recomputed from persisted posts on resume); cross-round replies get an
"update, don't reopen" instruction; votes go per-run `(post, voter)` latest-wins (DB
already agrees); round-close vote sweep gains a retro slice for older posts that drew new
replies; full offline pinning before ship.

### 3f · Big panels — 100+ experts (design exploration + engineering)

Discipline pods deliberate in parallel, spokespeople carry positions to a main table.
Explicitly includes: the **constellation visualization** (pods with mini-rings, bright
spokesperson edges to the center, activity pulsing, zoom/hover into a pod — the "city in
silico" money shot) and the **written value proposition** (coverage: every discipline
genuinely represented; robustness: pods reach positions independently before meeting —
less groupthink; scale: a 150-agent deliberation you can actually read). Technical:
sub-panel choreography per §3 (auto-organize above ~32 leads), roll-up posts, per-pod
transcripts, canvas layout mode.

---

## Phase 4 — Docs that teach

Guided walkthrough built on our own `examples/` demos — likely **Southgate Mall** (threads,
votes, dissent, conditional verdict end-to-end) instead of the scripted Site 47-A: why the
director cast these ten, what to watch in round 2, how to read the report. Site 47-A stays
the marketing demo; the teaching path uses the real product on synthetic materials.
Plus richer animated explainers and "what am I looking at" affordances on the run screen.

---

## Parked — deliberately (needs its own planning session; do not rush)

**Scenario / stress-test simulations**: world-state timelines ("rates +1.5% by month 6,
+3% by month 12"), rounds as time steps, market poll instruments (buy / wait / priced out /
forced to sell), trajectory charts, projection-lead reports. Design sketch exists (third
axis: brief × mode × scenario — the mode is how agents talk, the scenario is what world
they're in); revisit with Adam when ready. Natural partner: **what-if forks + report
diffs** (backlog) — the stress-grid mechanism (+1%/+2%/+3% forks, diff the verdicts).

## Backlog

What-if forks + side-by-side report diffs · DOCX/XLSX uploads + per-doc viewer with
citation deep-links · census-grounded crowds (ACS PUMS, Arizona first) · saved panels &
per-seat swap · more agent tools (parcel/lot data, historical web, FRED/Census series —
new cards in the 3d rack) · teams/sharing/billing → marketplace → calibration.

## Sequencing

**3a → 3b → 3c → 3d → 3e → 3f**, reports first (every demo ends on the report; it's what
a non-technical reader judges), then trust, then tools+threads, scale last. Each item =
its own PR off `origin/main`; README checklist + /docs updated per PR; CLAUDE.md updated
where the spec changes. The zero-errors bar from Phase 1 applies to every item: offline
pinning + live smoke before merge.
