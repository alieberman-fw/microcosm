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

### 3d · Agent tools v1 — web research, agent-decided, user-controlled  ✅ SHIPPED (PR #58 — tool rack, run-config cards, Conversations per-participant tools, feed/report/chat visibility)

The contract: agents get a RACK of tools they may reach for; the user controls which
tools a simulation (or chat participant) is ALLOWED to use — all off by default,
multi-select, or all on; agents decide when using an allowed tool is actually worth it
(never per-post mandatory — the lawyer answers from expertise, the economist checks
today's rates); every tool call is visible, logged, and citable.

- **The rack** (`lib/tools.ts`, single source of truth): each tool = one descriptor
  (key · name · tagline · plain description · concrete example · cost note · status ·
  wiring). v1 ships **Web research** (Anthropic server-side web search, variant per
  model tier from the registry, max 2 searches/turn) as `available`, plus greyed-out
  COMING SOON cards (parcel & lot data · economic series · census · historical web ·
  flood/climate) — the accessible tools list from day one; future tools are new
  entries, never re-architecture (function-tool slots: schema/runner/citer).
- **Simulations**: `config.tools` allowlist (empty = OFF, the default) · AGENT TOOLS
  card section in run config (click to multi-select, ENABLE ALL / DISABLE ALL, enabled
  = accent border, coming-soon dimmed + pill) · usage-based cost-estimator line ·
  enabled set frozen into the report's run_config. LEADS ONLY — crowd polls/
  interjections/votes never carry tools. Prompt addendum only when enabled ("search
  only when it would change your answer; cite what you find"). **Shared factbase**:
  every search persists (`tool_runs` + events) and later turns receive a "facts the
  panel already pulled" digest so the panel argues from one set of pulled facts.
  Failures soft — a failed search never fails a turn.
- **Visibility**: new §6.2 `tool` event (streamed + persisted, observer-tailed) ·
  feed renders each search as an expandable 🔎 card (query + clickable results) under
  the agent's post · Monitoring counts searches in spend.
- **Report**: TOOL FINDINGS block in synthesis input · TOOL CALLS stat tile ·
  tools in methodology · WEB SOURCES appendix (deduped clickable URLs the panel used).
  Verifier stays docs-only in v1.
- **Conversations too** (approved 2026-08-03): per-participant tool access, selected
  in the SAME menu as the model tier (the MODELS strip chip / roster card) with a
  clean toggle UI; persisted like model_overrides. Replies that searched show it
  beautifully — a "searched: …" line and clickable source chips under the bubble.
- **Not in v1**: function-tool runners (coming-soon cards only) · full-page fetch ·
  per-seat assignment in sims (persona `knowledge.tools` is the future hook) ·
  web-checking verifier.
- **Bar**: offline pins (tools only when enabled; crowd never; failure-soft; registry
  invariants), smoke proof of default-OFF (zero tool events) + a tools-on run with
  ≥1 search reaching feed + report, browser screenshots both themes, docs/README/§7.

### Field-report batch  ✅ SHIPPED (PRs #59–#61, 2026-08-03/04)

Adam's six-item field report after 3d, fixed before 3e: **#59 Files you can point at**
(anonymous-image-block root cause → labeled corpus blocks; report KEY MATERIALS media;
workspace thumbnails + lightbox + @file typeahead) · **#60 Polls that fit the question**
(choice instruments — choose-between briefs poll the brief's ACTUAL alternatives; classic
stances stay the default — plus the synthesis ticker: "✓ SUMMARY · WRITING FINDINGS 3/6")
· **#61 Corpus Q&A answers any upload** (images-only refusal killed — `corpusQaSystem`:
every upload is evidence, filename reference IS an image's citation; @file tokens hold
their typed form). Items 5 + 6 (parallel posting, selective voting) were absorbed into 3e.

### Field-report batch 2 (reported 2026-08-04) — PR C polish + PR D detached reports

Adam's second testing pass (poll card, feed rendering, report UX). Two PRs:

**PR C — poll truth & report reading experience** (UI + one small event change):
- **C1 · Percentages that sum to 100.** 40/30/29/2 = 101 today because each option is
  rounded independently — switch to largest-remainder rounding everywhere a dist renders
  (LiveRun card, ReportView slider/table, PlainBody). Readout redesigned: legend rows
  (color swatch · option label · % · raw count) replacing the cramped 8.5px one-liner;
  the stacked bar stays.
- **C2 · Every vote, visible.** Today every crowd member IS polled every polled round
  (batched 20 at a time; a deadline-cut poll ships its partial tally honestly) — but
  individual answers are tallied then discarded except 6 quotes. Persist the full
  per-member response on the sentiment event (compact `votes: [{name, choice}]` — ~300
  rows ≈ 15KB, fine for events + realtime) and give the poll card a **SEE EVERY VOTE ▾**
  expander: scrollable roster grouped by option, filter chips, quotes inline where they
  exist. Report gains the same expander under the percentages table.
- **C3 · Markdown in the forum feed.** Posts render `**bold**` literally — route post
  bodies (and report transcript quotes) through `components/app/Markdown.tsx` (already
  dependency-free + mention-aware from Conversations).
- **C4 · SIMPLIFY gets a real loading state.** The "weird blue spinner" is `cursor:
  wait` — the OS busy cursor. Replace with an in-button pulsing dot + a §10 shimmer
  skeleton over the body while the translation pass runs.
- **C5 · Plain mode names files.** The plain-translation prompt gains a rule: refer to
  uploaded files by their exact filename ("1.jpg"), never a paraphrase ("the finished
  house"). (The linked report's missing photos were age, not a bug — its spec predates
  report media; C6 makes files visible in every report regardless.)
- **C6 · The file rail — which file is IMAGE 1.** Users say "image 2"; files are named
  1.jpg/3.webp/2.jpg; agents see corpus-order labels. One truth: the ordinal
  `buildCorpusBlocks` already assigns ("UPLOADED IMAGE n") surfaces everywhere — a
  right rail on the report (**FILES · WHAT THE PANEL SAW**: every upload in corpus
  order — clickable thumbnail → lightbox, filename, IMAGE-n chip, kind) rendered for
  ALL reports (independent of synthesizer media picks), and the workspace doc rows get
  the same IMAGE-n chip.
- **C7 · Media grid that looks composed.** KEY MATERIALS becomes a uniform grid
  (auto-fill columns, 3-up at desktop), fixed image-area height with cover-fit,
  captions clamped to two lines (click to expand) — no more ragged card heights.

**PR D — reports you can walk away from** (3c's medicine applied to synthesis):
synthesis today runs inside the response stream — leave the page and there is no
re-attach, no status anywhere. Move it under `waitUntil` with
`config.report_state {stage, note, heartbeat_at, version}` as truth; the report page
re-attaches on return (live ticker note included); Home's IN-PROGRESS strip shows
SYNTHESIZING reports beside running sims; stale heartbeat surfaces a RETRY. Same
worker/heartbeat pattern 3c proved.

**Order:** PR C lands before/alongside 3e (pure polish + one event field); PR D right
after 3e (half-day, reuses the 3c pattern).

### 3e · The forum acts like a real forum (living threads + parallel waves + honest votes)  ⟵ NEXT

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

**Absorbed from the field report (approved 2026-08-03):**
- **Parallel reply waves** (item 5 — realism + speed): replies land in batches of 2–3
  that share a transcript snapshot, so voices genuinely overlap instead of a strict
  relay; Jury round 1 goes fully parallel (blind scores are independent by definition).
  Budgets, dedupe, and ordering guarantees unchanged — the wave is a scheduling detail.
- **Selective voting** (item 6 — votes on almost every post reads fake): abstain by
  default with per-voter budgets (endorse ≤2, reject ≤1 per round) so a vote means
  something; vote totals stay citable report signals.

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

## Phase 5 — Grounded crowds & the data layer (approved 2026-08-04)

**Why this phase:** the architecture audit against the three canonical question styles
(research: "rates rise → Beverly Hills?" · preference: "which photo gets the click?" ·
decision: "$32M land — fair range?") found the chain from question → casting →
instrument → report SOUND, and the gaps all data-grounding: crowds should look like the
actual market, agents should pull the actual series, and "what if" should be a button.
This is also the competitive answer to Simile-class "anchored in real people" pitches —
ours is **synthetic-but-representative** (census-grounded, no real individual ever
simulated — the CLAUDE.md privacy line) plus vertical depth they can't match: checkable
constraints, document citations, tools, and outcome calibration.

### 5a · ACS PUMS demographic seeding — census-grounded crowds (CLAUDE.md §3.2B)

**The substrate (offline, once per vintage) — NATIONAL from day one (Adam, 2026-08-04:
the entire US, not AZ→CA, and latency-optimized):** bulk-load the **ACS 5-year PUMS**
(the deepest sample at PUMA level — 1-year files are too thin for small PUMAs) for all
50 states + DC + PR into Postgres — `pums_households` / `pums_persons` with PUMS weights
(WGTP/PWGTP) and (ST, PUMA) — via an idempotent, per-state-resumable
`scripts/load-pums.mjs` (census FTP / AWS Open Data mirror; a re-run picks up where it
stopped, annual vintage refresh is the same command). **Slim columns only** (~20 of the
500+ PUMS variables: age, sex, household type/size, tenure, household income, occupation
SOCP, employment, commute JWMNP, education, gross rent, property value, weights) — the
national tables land in the low tens of millions of rows / a few GB, not hundreds.
Latency architecture, in order of the levers that matter:
- **Sampling is millisecond SQL, never an LLM.** Composite index on (st, puma); a PUMA
  subset is 5–50K rows, so a weighted sample over the index is single-digit ms.
- **`pums_strata` rollup** (PUMA × age band × income band × tenure × household type,
  weights pre-summed) is precomputed at load time — the population stage's honesty
  panel and the geography preview read the rollup INSTANTLY, never scanning rows.
- **`geo_crosswalk`** (ZIP↔PUMA↔county↔place, geocorr — the vintage's 2020-PUMA
  boundaries, one consistent crosswalk) is loaded alongside, so brief geography →
  PUMAs is a lookup, not a computation.
- **The wall clock is the narrative pass, not the data.** Turning sampled records into
  personas stays the existing crowd path (Haiku, 3-concurrent batches) — PUMS adds ~ms
  of SQL in front of it. Records stream into the narrative batches as they sample; no
  barrier between sampling and generation.
- Fallback if Supabase row-count/egress economics ever bite: same loader targets
  Parquet + DuckDB (the CLAUDE.md §3.2B alternative) behind the same sampler interface.

**When it runs (per simulation, not per library):** the brief pass extracts the
geography (ZIPs / city / county / metro) from the brief + corpus. When a
consumer/resident cohort has a real geography, **crowd materialization switches from
narrative invention to weighted sampling**: geography → PUMAs → sample N household
records honoring weights → a compact Haiku pass turns each record into a persona that
**preserves the record's attributes verbatim** (age, household, income band, tenure,
occupation, commute) — narrative is invented, demographics are not. Rows land in
`sim_agents` with `demographics.source: "acs_pums"` + the record's weight. Consumer/
resident LEAD seats use the same sampler (one record + a richer narrative). No
geography in the brief → today's narrative path, unchanged.

**Relationship to the ~1,900-persona library: augmentation, not replacement.** The
global library stays the reusable, org-agnostic layer — experts, stakeholders, and the
§28–30 generic demand cohorts (which become the explicit no-geography fallback). PUMS
personas are per-simulation materializations of a place + vintage: generated fresh and
cheap each run, and NOT written back to the global library (place-specific rows would
pollute it). Orgs can still save any sampled persona they like to their custom library.

**Surfaces:** population stage shows the grounding line for real ("ACS PUMS 2023 ·
ZIPS 85212 + 85142 · 400 households"), an editable geography picker, and an honesty
panel — sampled-crowd distributions vs the census marginals (income / tenure / age
bars), so the user can SEE the crowd looks like the place. Report methodology names
vintage, PUMAs, and weights. v1 polls tally unweighted with weights recorded
(weighted display is a fast follow).

**Bar:** loader idempotent + resumable; sampler unit-tested (weights honored,
attribute preservation pinned, crosswalk edge cases); E2E: a Phoenix brief materializes
a crowd whose attributes match its sampled records; docs + README + §3.2B status.

### 5b · Describe-to-create personas — PUMS-backed autofill

Everywhere a persona is created or edited (library custom create, Conversations picker,
remix editor): alongside the manual form (which stays), a **DESCRIBE THEM** box — one or
two sentences ("a 34-year-old nurse in Mesa, renting, two kids, first-time buyer") →
the full §3.1 persona JSON drafted: identity, tagline, backstory, stances, traits,
demographics — every field editable before save. **The PUMS twist:** the description is
parsed into demographic constraints; a matching real record is constrained-sampled; the
UNSTATED fields inherit from the record — so the invented person is census-consistent,
not vibes. No matching record → nearest match with a visible "closest census match"
note. Provenance `manual` + `demographics.source: "acs_pums"`. The same sampler later
upgrades the Casting Director's gap-generation path.

### 5c · Data tools phase 2 — the rack's coming-soon cards go live (§7)

The 3d rack was built for exactly this: a new tool = a new descriptor + a runner, never
re-architecture. Light up, in order of value-per-effort: **FRED** (rates/series — the
research-question workhorse) · **Census ACS** (demographics on demand) · **HUD** (FMR /
income limits) · **FEMA NFHL** (flood zone by location) · **parcel/Regrid** (parcel +
zoning attributes; paid key — env-gated, card lights up when a key is present). These
are function tools (the engine executes the runner, unlike server-side web search):
per-sim cached into the shared factbase, logged to `tool_runs` + `tool` events, citable
("source: tool"), already flowing to the report's TOOL FINDINGS + appendix.

**Agent skills (the AI-tool side):** first entry is a **finance-calc tool** —
deterministic underwriting arithmetic (cap rate, DSCR, residual land value, absorption
math) the model calls instead of doing mental math; results cite as "source: calc" and
kill arithmetic hallucination in valuations. Chart generation lands in Conversations
per the v2 roadmap. Per-seat tool assignment (persona `knowledge.tools`) remains the
future hook.

### 5d · Scenario forks + report diffs (promoted from backlog — the rehearsal loop)

Fork any completed simulation: change a parameter, a document, an assumption, or a
persona → re-run → **diff view** between parent and fork (verdict change, dimension-
score deltas, which agents flipped, findings appeared/disappeared, cost per run).
`simulations.parent_id` lineage per §2 Stage 5. This turns research conditionals
("if rates rise…") into buttons, and is the mechanism the parked stress-grid
(world-state timelines) will drive later.

### 5e · Calibration v0 — the outcomes flywheel starts (§1 principle 5)

The `outcomes` table has existed since migration one; nothing writes to it. Add a
**RECORD WHAT HAPPENED** affordance on every report (the parcel traded at $X · the
hearing passed · lease-up took N months) → an `outcomes` row typed to the report's lead
kind; Reports/Home show predicted-vs-actual chips where an outcome exists. Cheap now,
priceless later — the backtest report (Phase 4 of CLAUDE.md §11) needs years of these.

### 5f · Valuation scaffold — triangulation made structural

For price-range briefs: the Casting Director pins one owning seat per appraisal
approach (sales comparison · residual land value · income capitalization), and the
report's PRICE RANGE lead must cite the three triangulated numbers it reconciled
(completeness-gate enforced). Small change; makes the flagship §2 valuation case read
like an appraisal instead of a vibe.

### 5g · Cast-a-room — premise-cast Conversations with PUMS-grounded people (approved 2026-08-04)

**The ask (Adam):** "I'm deciding between a listing description and some images for a
$3.2M Beverly Hills listing — give me 14 prospective buyers who could afford this home
to chat with." Start a group chat from a PREMISE and get the right room, instantly —
the instant rehearsal surface: a grounded focus group in two minutes, no run required.

**Entry point:** `/conversations/new` (and the quick picker) gains **CAST FROM A
PREMISE** alongside smart search and manual picking — a text box for who you want in
the room and why. Manual creation and 5b describe-to-create remain side doors into the
same room.

**The casting pass (reuses the sim machinery, chat-scoped):** one Casting-Director call
(Sonnet minimum, same rule — casting quality bounds the room) reads the premise and
drafts seats: the count (≤20, the existing room cap), the mix (buyers here; "3 land-use
attorneys to stress-test my CUP strategy" works the same way), and a one-line WHY THIS
PERSON per seat. Resolution ladder identical to simulations: org custom personas →
global library → generate true gaps (saved back to the org's custom library — the
catalog self-heals from chat too).

**PUMS grounding (the 5a/5b payoff):** when the premise implies a demographic cohort +
place, the caster derives constraints — geography → PUMAs, affordability → a
**transparent income heuristic** (e.g. $3.2M at 4–5× income → household income ≥
~$650K, tenure/age spread free) — and constrained-samples N real household records, so
the 14 buyers carry the JOINT distribution that actually exists at that affordability
tier in that place: the real mix of ages, households, occupations — not 14 clones.
Sparse strata widen the geography ring with a visible note. Every card carries the
provenance chip ("ACS PUMS 2023 · LA COUNTY") and the roster shows the honesty line
("filtered to income ≥ $650K — the $3.2M affordability band at 4–5×").

**Then it's just a conversation** — everything already shipped composes: attach the
two listing variants (images + PDFs already work), @mention or address the room, the
router picks respondents, per-participant model tiers and tools apply. **POLL THE
ROOM** (one-click): every participant answers a choice instrument in character —
"listing A or listing B?" — rendered as the PR-B option bars in-thread. Same honesty
framing as everywhere: synthetic and directional, a well-argued panel, not a survey.

**Bar:** casting-ladder reuse unit-tested (no sim tables touched — rooms are
`conversations`, not `simulations`); PUMS constraint parser pinned (income heuristic,
geography widening); E2E: the Beverly Hills premise casts 14 PUMS-tagged buyers, a
two-image attachment poll returns per-option bars; docs (Conversations page) + README.

**Sequencing note:** 5g lands immediately after 5b (it composes 5a's sampler, 5b's
describe pipeline, and the existing chat surface) — before the data tools.

---

## Phase 6 — The Brief Contract: any question in, a report that answers it (DESIGNED 2026-08-04, ships before 5a)

**The diagnosis (Adam's field reports, distilled):** the deliberation machine is sound —
population, casting, modes, the graph, the living forum. What's missing is an explicit,
machine-readable representation of USER INTENT. Today the brief survives downstream as
one long string, so casting, the rounds, the poll, and the report each re-guess what the
user wanted — and each guesses differently. A multi-part research prompt gets a
support/oppose poll bolted on; "conclude with a ranked list" never becomes a ranked
list; rounds orbit the loudest sub-question while quieter ones go unanswered. The fix is
one new spine — the **Brief Contract** — that every stage consumes instead of re-guessing.

### The Brief Contract (the spine everything else hangs on)

Derived once per brief by a frontier-tier **Understanding pass** (same rule as casting:
this call's quality bounds everything downstream), persisted at `brief.contract`,
editable in the UI, versioned, re-derived only on explicit request:

```jsonc
brief.contract = {
  intent: "decide | evaluate_options | explore | diagnose | forecast | validate",
  audience: "executive | technical | community",
  sub_asks: [            // EVERY answerable ask, even buried mid-paragraph
    { id, ask, kind: "question | determination | enumeration",
      evidence: "opinion-ok | cited | quantified | named-sources" }
  ],
  output_contracts: [    // the SHAPE the answer must take — drives report STRUCTURE
    { type: "ranked_list | matrix | comparison | verdict | range | odds | timeline",
      spec: { items_from: "entities", criteria: [...] } }
  ],
  entities: ["the nouns the brief is ABOUT — asset categories, options, places"],
  population_hints: {   // "homebuyers aged 35-45 in Beverly Hills" IN the prompt → casting input
    described: true,    // false = user left it out; the director decides everything
    cohorts: [{ desc: "homebuyers aged 35-45", geography: "Beverly Hills, CA" }],
    composition: "residents"  // inferred lean, still overridable
  },
  constraints: ["follow the evaluation framework in query.md", ...],
  success_criteria: [...]
}
```

Handles every brief style by construction: a single sharp question = one sub-ask + a
verdict contract; an open-ended exploration = intent "explore", narrative contract, no
poll; Adam's edge-industrial prompt = 4 sub-asks + entities (the asset categories) +
matrix and ranked-list contracts + a named-sources evidence standard.

### 6a · Prompt-first composer + the Understanding Mirror (UI/UX — designed with Adam 2026-08-05)

`/sim/new` becomes ONE hero composer: a large prompt box ("Ask the hardest question you
have") with file drop directly on it. Submit runs the Understanding pass and lands on
the workspace with the **UNDERSTANDING MIRROR** — not a form, a smart colleague's
restatement. Design goals, in priority order: (1) the 80% case never NEEDS to read it —
launch is one click with good defaults; (2) when the user does read it, it reads human;
(3) any piece is correctable in seconds; (4) nothing the user asked for can silently
fall out.

**The card, top to bottom:**
- **Intent + audience pills** ("EVALUATE OPTIONS · EXECUTIVE READ") — one glance.
- **The mirror**: a 3–6 sentence second-person restatement — "You're deciding which of
  the asset categories in your briefings deserve pursuit… For each category you want to
  know whether the real estate exists to buy today, who every player is (named, with
  sources)… You expect a ranked list." Every load-bearing phrase is subtly underlined;
  clicking one opens its structured chip for inline edit. Prose that edits like data.
- **YOUR FILES, with roles** (new — and the gap Adam's edge-industrial run exposed):
  each document classified as **evidence** (argue from it) · **framework/instructions**
  ("follow the evaluation standards in query.md" — feeds agent instructions and the
  report outline, not just the citable corpus) · **question-source** (the brief lives in
  the doc) · **reference**. Roles editable per file; mis-roled docs are today's silent
  failure mode.
- **THE REPORT YOU'LL GET**: a mini wireframe of the future report — lead artifact
  (ranked list), blocks (category × criteria matrix), one section per sub-ask, register.
  Seeing the answer's SHAPE before spending a run is the trust moment; editing the
  wireframe edits the output contracts.
- **POLL PLAN**: the angles and their instruments — or "NO CROWD POLL — expert research
  brief" stated plainly, so a missing poll reads as a decision, not a bug.
- **Clarifying questions, 0–2, one-tap, never blocking**: only when the pass emits a
  low-confidence flag ("Should the report recommend NON-real-estate expressions when no
  play pencils? [Include them / Real estate only]"). Ignored = sensible default,
  recorded in the contract.
- **Collapsed by default below the mirror**: THE BREAKDOWN — numbered sub-asks (each
  tagged with its evidence standard + "owner seat"), entities, constraints, success
  criteria; add/edit/delete chips; RE-DERIVE re-runs the pass after brief edits.

The current structured form survives under COMPOSE MANUALLY; suggest-with-AI retires as
a button because it becomes the default behavior. Zero-config stays useful, config
stays bone-deep (§1 p4).


**The three layers (designed with Adam 2026-08-05, after studying Simile's composer):**
Simile's radical simplicity and our depth are not in conflict — they belong to
DIFFERENT MOMENTS. Simplicity is for the moment of asking; depth is for the object you
end up with. The interface is three layers of progressive commitment:

- **Layer 1 — THE ASK.** The hero composer: prompt + file drop + AT MOST THREE inline
  chips that read as modifiers of the question, never as settings —
  `PANEL: AUTO ▾` (auto / experts / residents / mixed — the §4.2 composition override),
  `MODE: AUTO ▾` (the seven ModeDiagram cards in the dropdown; director recommends),
  and `DEPTH: STANDARD ▾` — ONE intent-level dial (quick read · standard · deep dive)
  that presets rounds + density + tier + report length and shows the live cost/time
  estimate right in the chip ("~$4 · ~6 MIN"). Five numeric knobs collapse into one
  dial; the knobs survive underneath. Nothing else on this screen.
- **Layer 2 — THE PREFLIGHT (one screen, one Launch).** Submit → the Understanding
  Mirror at top, then the CAST as it materializes (the casting theater we already
  have), the poll plan, the report wireframe, and the depth/cost line — each section a
  one-line summary of what was decided AND WHY ("MIXED — community surface detected"),
  each a door. Glance, correct anything inline, LAUNCH. The current sequential stage
  machine becomes sections of one screen.
- **Layer 3 — THE STUDIO.** Everything that exists today — full population editor,
  crowd browser, per-seat edits, every §4.1 parameter, the tools rack — reached by
  drilling into any preflight section. Power users live here; first-time users may
  never see it. Nothing is removed; it is re-choreographed from "path" to "drill-down".

Returning users get RECENT BRIEFS + one-click "run again with changes" (the 5d fork
mechanism) on the composer, and later, saved panels as PANEL-chip presets (persona
sets). Implementation note: this is choreography, not a rebuild — BriefComposer,
CastingTheater, PopulationStage, RunConfigStage all exist; 6a composes them into
Ask → Preflight → Studio and adds the DEPTH preset mapping in lib/run.ts.


**DECISION (Adam, 2026-08-05 — after reviewing the Flow Lab prototypes):** the current
staged flow STAYS THE CORE. No re-choreography of the workspace. 6a narrows to two
concrete moves plus one new alternate view:

1. **The brief step captures more, better.** File/document upload moves ONTO the brief
   composer (prompt + docs are one gesture — same corpus pipeline underneath), and the
   prompt box grows into a true free-form ask: users write EVERYTHING they want the
   simulation to cover/answer/research in their own words, multi-part and messy
   welcome. Submitting runs the Understanding pass; the WHAT I UNDERSTOOD card renders
   in the workspace exactly as designed (intent + audience up top, sub-asks as editable
   chips, output contracts, entities, criteria — each labeled with what it drives).
   The rest of the flow — population review, run config, launch — is untouched.
   COMPOSE MANUALLY survives.

2. **QUICK RUN — the one-box alternate view (from Flow Lab's Flow A/D).** A small view
   toggle on /sim/new switches to the one-box composer. Behavior: the empty state is
   just the box + file drop; once the user starts typing, the config surfaces
   progressively BELOW the box — the animated mode cards first (the interactive
   ModeDiagram icons); CLICKING a mode reveals that mode's config params directly
   beneath it as selection pills — one progressive reveal, not a settings page. The
   prompt itself may DESCRIBE the population ("simulate how homebuyers aged 35-45 would
   react to a 2% increase in interest rates in the Beverly Hills area") — the
   Understanding pass extracts it into `population_hints` and casting honors it;
   omitted, the director decides everything, as today. In this view there is NO
   population stage: hitting RUN
   derives the contract, casts leads + generates the crowd behind the casting-theater
   animation as the loading state, and drops straight into the live run screen. The
   cost estimate still shows on the RUN button before commit (no-surprise-bills rule),
   and a one-line "understood" strip (intent · N sub-asks · poll plan) renders between
   typing and run — compressed trust, no full card. View preference persists per user.
   Quick Run trades population review for speed; the classic flow remains the default.

Revised PR slicing: **6-PR1** = Understanding pass + contract + files-on-brief + the
WHAT I UNDERSTOOD card in the current flow · **6-PR2** = Quick Run view · **6-PR3** =
agendas + resolution tracker + COVERAGE strip + adaptive poll plan · **6-PR4** = report
blocks + semantic judge + audience register. The three-layers material above stays as
design rationale; the Preflight-replaces-stages idea is parked, not adopted.

### 6b · The Understanding pass (technical)

One CASTING_MODEL-tier call over prompt + doc names + first-N-token excerpts → contract
JSON (structured outputs; completeness-gated + salvaged like the casting plan; logged as
`brief.understand`) — now including **per-document roles** and **confidence flags**
(each flag becomes a one-tap clarifier on the card; unanswered flags resolve to stated
defaults). The **mirror prose** is generated in the same call and stored beside the
contract; chip edits mutate the CONTRACT (the truth) and mark the mirror stale until
regenerated (one cheap call). Consumers: **casting** (sub-asks → owner seats; evidence
standards enter seat prompts; entities seed disciplines), **engine** (round agendas, 6c;
framework-docs quoted in instructions), **instrument derivation** (poll plan, 6d),
**report outline** (sections from sub_asks, blocks from output_contracts, framework-docs
shaping the skeleton, 6e), **gate** (semantic completeness, 6e). Back-compat: no
contract → today's behavior, unchanged.

**The honest chain of guarantees** (what "ensures" actually means here): the
Understanding pass is probabilistic — the card exists so the user can catch a bad parse
in seconds, and the confidence flags surface the pass's OWN doubt. The rounds are
steered (agendas), not scripted. The HARD guarantee sits at the end: the semantic
completeness judge refuses any report that doesn't answer every contract line, with
targeted re-synthesis until it does. Perfect understanding is not assumed anywhere;
checked completeness is enforced exactly once, where it matters.
### 6c · Rounds that walk the brief (agendas + the coverage strip)

Rounds stop being undirected passes. The engine keeps a **resolution tracker** — after
each round a Haiku pass scores every sub-ask 0–100 "how settled, what's missing" — and
each round opens with an **agenda**: round 1 broad, middle rounds target the
least-resolved sub-asks by name ("Round 2 focus: 'does the real estate exist to buy
today?' — unresolved for micro-fulfillment and edge-compute"), the final round forces
synthesis/ranking. Mode choreographies are untouched — the agenda rides in the opener
instruction. **UI:** round dividers carry the agenda label, and the run screen gets a
**COVERAGE strip** — one chip per sub-ask filling toward resolved — so convergence is
visible and MEANS something (Adam's convergence-audit concern, made structural).
Benefit: transcripts that systematically cover the brief are the raw material reports
need; today's orbit-the-loudest-thread failure mode disappears.

### 6d · Adaptive polling — a poll PLAN, not one frozen instrument (Adam's ask)

The Understanding pass emits a **poll plan**: which angles of this brief have a genuine
preference/sentiment surface, each with its own instrument — proposition, choice over
entities, or **none**. Per round, the poll asks the angle matched to the round's agenda:
early = the broad gut-read, middle = per-category choice ("which category most deserves
pursuit?"), late = the decision-shaped closer ("back the ranked list's #1?"). Expert
research briefs with no sentiment surface poll NOT AT ALL (crowd still interjects and
votes — the poll card simply doesn't exist; support/oppose on "rank these categories
with sources" was noise). Guardrails: ≤3 distinct angles per run, an angle persists ≥2
rounds before trends render, and every sentiment event already carries its own
question+options (PR-B) so round-varying polls need NO schema change — the report's
trend slider groups by angle. §4.2's auto-decide table gains the row.


**The instrument palette (added 2026-08-05 after studying Aaru):** Aaru's agents answer
survey instruments — single choice, multi-select, RANKING, MATRIX, free response — but
never deliberate; our crowd deliberates-adjacent but polls with two instruments. Steal
the palette, keep the argument. The poll plan picks from: **proposition**
(support/conditional/oppose/disengaged — today) · **choice** (pick one entity — PR-B) ·
**ranking** (the crowd orders the entities — and for "conclude with a ranked list"
briefs the crowd's ranking lands NEXT TO the panel's ranked-list block, comparable
side by side) · **matrix** (entities × the brief's qualities, rated — feeding the same
matrix block the panel argues) · **free probe** (one open question per run; answers
theme-clustered into a citable "in their own words" report card) · **none**. The
alignment is the point: each instrument maps onto the 6e block it feeds, so crowd data
and panel argument converge on the SAME artifact instead of living in different rooms.
Users can also AUTHOR instruments directly in the preflight poll plan — derived by
default, authorable always.

### 6d-2 · Crowd cohorts — named segments, split results (from Aaru's Audiences)

Aaru names its audiences ("Experience seekers", "Value optimizers") and reports per
audience. Our crowd is one pool split only experts/residents. The Understanding pass
(or the user, in the Studio) defines **named cohorts** with hard parameters in plain
language ("renters within 3 miles" · "move-up buyers, HH income $95–150K" · "owners on
adjacent blocks"); crowd members are generated tagged to a cohort, and every
instrument reports **per-cohort splits** — the poll card gains a BY COHORT toggle, the
report's sentiment blocks break out cohorts ("Value optimizers oppose 62% · Experience
seekers support 55%"), and dissent BETWEEN cohorts becomes a first-class finding.
This is the bridge to 5a: Phase 6 ships narrative cohorts; PUMS later grounds the same
cohort objects in census joint distributions (geography + income filters become real
sampling constraints). Migration-light: a `cohort` field on crowd spec_frozen +
ballots already carry names.

### 6e · Reports that take the answer's shape (+ the semantic gate)

The report schema gains contract-driven **blocks** alongside sections (kept FLAT — the
3b schema-budget lesson): **RANKED LIST** (ordered items, per-item verdict + rationale +
cites), **MATRIX** (entities × the brief's criteria, verdict per cell), **COMPARISON**
(side-by-side). The 3b typed lead stays the headline; blocks are the body artifacts —
Adam's example renders a category×criteria matrix with the ranked list as the lead
artifact. Then the **answer-completeness judge**: the draft is checked against the
contract — every sub-ask ANSWERED (not mentioned), the ranked list ranks ALL entities,
sources named where the evidence standard demands — and failures trigger TARGETED
re-synthesis ("sub-ask 3 and the ranked list are missing — fix only those"), never a
blind retry. This is the direct guarantee behind "answer all of the user's points."

### 6f · Audience register — digestible by default, technical by choice

Deliberation stays technical: personas arguing at full professional depth IS the
product. The REPORT leads with the register the contract derived: **executive** (the
answer in plain language first, technical depth folded beneath each finding) or
**technical** (today's expert view). SIMPLIFY remains the full translation; the register
just decides which voice leads. Forum language is untouched.

### PR slicing, cost, and the bar

- **6-PR1** — contract + Understanding pass + WHAT I UNDERSTOOD card (the spine + its
  review UI; downstream consumers read contract when present, else today's path)
  ✅ SHIPPED (PR #75; PR #76 folded the understanding-first workspace choreography)
- **6-PR2** — prompt-first hero composer (entry UX; smallest risk, big feel)
- **6-PR3** — round agendas + resolution tracker + COVERAGE strip + adaptive poll plan
  (engine work; full offline matrix additions before ship) ✅ SHIPPED (2026-08-05:
  agendas in opener instructions for Agora/Roundtable, tracker as engine.tracker
  Haiku pass per round close, coverage/agenda §6.2 events, COVERAGE strip + divider
  labels, poll_plan on the contract with pollAngleForRound scheduling, per-angle
  report sliders; instruments beyond proposition/choice — ranking/matrix/free-probe
  from the Aaru palette — ride with 6-PR4's blocks so instrument and artifact land
  together)
- **6-PR4** — report blocks + semantic completeness judge + audience register

**RE-ORDERED (Adam's field report, 2026-08-05, edge-industrial run 0a367882):** the
report ranked 6 of the brief's 11 enumerated categories (the rest narrated in prose) and
the ranking rode in a section's `numbers` chips — clipped mid-word by assembly caps.
Hotfixed same day (caps widened 6×60→16×160, ranking rule in the synth prompt, row
rendering for list entries, dense budget 24K→32K so truncation stops doubling synthesis
time) — but the STRUCTURAL guarantee Adam is asking for ("the simulation must address
the questions properly; convo aligned to brief and questions, as is polling") IS
6-PR3 + 6-PR4. New order: **6-PR3 → 6-PR4 → 6-PR2** — report/deliberation correctness
before the Quick Run view. 6-PR4 also carries the §8 Desk-parallel section synthesis
(outline → parallel section workers → director merge) as the structural answer to
4-minute single-call syntheses: one 22K-token call has a ~250s floor at Sonnet speeds;
parallel sections cut wall-clock to the slowest section + merge.
- Cost: +1 frontier call per brief (understand), +1 Haiku per round (tracker), +1–2
  judge calls per synthesis — noise against run cost; estimator lines updated anyway.
- Bar per PR: offline pins (contract parse salvage, agenda selection math, poll-plan
  shapes, block gates), live smoke additions (a multi-part brief must produce a ranked
  list + matrix and a round-2 agenda), browser passes in both themes, docs + README.
- Success test (the phase's exit): Adam's edge-industrial prompt, pasted verbatim into
  the hero composer with its two documents, produces — unassisted — a report whose lead
  is a ranked list over the categories, a matrix answering each sub-ask per category,
  named sources where demanded, polls that read sensibly per round, and an executive
  register a non-technical reader can absorb.

## Parked — deliberately (needs its own planning session; do not rush)

**Scenario / stress-test simulations**: world-state timelines ("rates +1.5% by month 6,
+3% by month 12"), rounds as time steps, market poll instruments (buy / wait / priced out /
forced to sell), trajectory charts, projection-lead reports. Design sketch exists (third
axis: brief × mode × scenario — the mode is how agents talk, the scenario is what world
they're in); revisit with Adam when ready. Natural partner: **what-if forks + report
diffs** (backlog) — the stress-grid mechanism (+1%/+2%/+3% forks, diff the verdicts).

## Backlog

**Convergence-quality audit (Adam, 2026-08-04):** a live study across brief styles
verifying that round-over-round movement reads TRUE — polls trend as arguments land,
juries hold/switch for named reasons, hard questions keep honest splits while easy
ones converge. The mechanisms exist (digest-aware polls, tally-aware re-verdicts,
stability rules, choice instruments); the audit grades their OUTPUT quality across
~10 varied briefs and tunes prompts where movement looks like noise. Natural
companion to 5e calibration.

DOCX/XLSX uploads + per-doc viewer with citation deep-links · saved panels & per-seat
swap · weighted poll tallies (PUMS weights in the dist) · a "choice" report lead kind
(winner + share split for preference briefs) · historical-web tool · per-seat tool
assignment (`knowledge.tools`) · teams/sharing/billing → marketplace → backtest report.
(Promoted to Phase 5: census-grounded crowds → 5a · what-if forks + diffs → 5d · data
tools → 5c · calibration start → 5e.)

## Sequencing (updated 2026-08-04)

**3e → 5a → 5b → 5g → 5c → 5d (5e + 5f ride alongside as small PRs) → 3f → Phase 4 docs.**
(5g jumps its letter: cast-a-room composes 5a's sampler + 5b's describe pipeline
directly and is a pure-upside retention surface — it ships before the data tools.)

Rationale: 3e closes the approved field-report batch (one day). Then grounding beats
polish — 5a upgrades every demand/preference/consent question at once and 5b depends on
its sampler; 5c makes research questions pull real series (each tool compounds across
all personas); 5d turns "what would change the answer" into a button and pairs with the
parked scenario-timeline session when Adam is ready. 5e and 5f are deliberately thin —
each is a day-scale PR that can interleave. Big panels (3f) and the teaching docs
(Phase 4) follow once crowds and tools are grounded — both showcase better with real
grounding underneath. Each item = its own PR off `origin/main`; README checklist +
/docs updated per PR; CLAUDE.md updated where the spec changes. The zero-errors bar
from Phase 1 applies to every item: offline pinning + live smoke before merge.
