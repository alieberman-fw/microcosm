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

**The substrate (offline, once per vintage):** bulk-load PUMS person + household CSVs
into Postgres — `pums_households` / `pums_persons` with PUMS weights (WGTP/PWGTP) and
PUMA — via an idempotent `scripts/load-pums.mjs` (census FTP / AWS Open Data mirror),
plus a `geo_crosswalk` table (ZIP↔PUMA↔county, geocorr). **Arizona first** (matches the
demo), **California second** (Beverly Hills-class questions). Annual vintage refresh is a
re-run. Weighted sampling is a millisecond SQL query — no LLM in the sampling path.

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

---

## Parked — deliberately (needs its own planning session; do not rush)

**Scenario / stress-test simulations**: world-state timelines ("rates +1.5% by month 6,
+3% by month 12"), rounds as time steps, market poll instruments (buy / wait / priced out /
forced to sell), trajectory charts, projection-lead reports. Design sketch exists (third
axis: brief × mode × scenario — the mode is how agents talk, the scenario is what world
they're in); revisit with Adam when ready. Natural partner: **what-if forks + report
diffs** (backlog) — the stress-grid mechanism (+1%/+2%/+3% forks, diff the verdicts).

## Backlog

DOCX/XLSX uploads + per-doc viewer with citation deep-links · saved panels & per-seat
swap · weighted poll tallies (PUMS weights in the dist) · a "choice" report lead kind
(winner + share split for preference briefs) · historical-web tool · per-seat tool
assignment (`knowledge.tools`) · teams/sharing/billing → marketplace → backtest report.
(Promoted to Phase 5: census-grounded crowds → 5a · what-if forks + diffs → 5d · data
tools → 5c · calibration start → 5e.)

## Sequencing (updated 2026-08-04)

**3e → 5a → 5b → 5c → 5d (5e + 5f ride alongside as small PRs) → 3f → Phase 4 docs.**

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
