# CLAUDE.md — Microcosm Product & Technical Specification

> **Read this before writing any application code in this repo.**
> This document is the product spec, the technical spec, and the styling contract for the Microcosm app. The landing site (`index.html`, `demo.html`, `research.html`) is the design reference and the product's north star: the app must feel like the demo come to life.

---

## 1 · What we are building

**Microcosm is an AI agent-swarm simulation platform for the built world.** Users pose a hard real-estate question, upload their diligence documents, generate a configurable population of persona-grounded AI agents (experts, consumers, residents, stakeholders), watch those agents deliberate in real time, and receive a decision-grade interactive report.

The product exists to answer the hardest questions in the real estate vertical — go/no-go on a parcel, floor-plan and unit-mix selection, pricing, lease-up risk, entitlement and community consent, policy impact — by replacing the $15–50K, six-week feasibility study with a same-day simulation *run*.

**The demo (`demo.html`) is the product contract.** Its four stages — Brief → Seed → Run → Read — are the app's core loop. Everything in this spec elaborates that loop into a real, multi-tenant SaaS.

### Current repo state

- `index.html` / `demo.html` / `research.html` — static marketing site + scripted demo (design reference; do not break)
- `support.js` — generated design runtime for the static pages only (NOT used by the app)
- The app will be built as a separate Next.js application (see §9); the static site remains the marketing front door.

### Product principles

1. **Show the deliberation, not just the answer.** The live network graph and forum feed are the product's signature. Users must be able to watch, scrub, and interrogate the argument.
2. **Dissent is a feature.** Never average away disagreement; preserve and surface it (as the demo report does).
3. **Honest instrument.** Every output is labeled synthetic and directional. Confidence, convergence, and known failure modes are always displayed. Fair-housing red line: we simulate markets and decisions, never individual tenant/buyer screening.
4. **Configurable to the bone, useful with zero config.** Every stage auto-generates a strong default from the task + docs; every default is editable.
5. **The moat is calibration.** Design every schema so outcome data (what actually happened) can be attached to simulations later.

---

## 2 · The core loop (five stages)

The app's primary object is a **Simulation** inside a **Project**. Each simulation moves through five stages, mirroring `demo.html`:

### Stage 1 — Brief

The user states the research problem and what they want answered.

- **Problem statement** — free text, one clear question ("Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus?")
- **Questions to resolve** — chips (the demo's "POWER TIMELINE / WATER STRATEGY / …"). Auto-suggested by an LLM pass over the problem statement; user can add/remove/edit. Each question becomes a required section of the final report.
- **Decision templates** (accelerators, optional): Site go/no-go · Product & floor-plan mix · Pricing & absorption · Lease-up & amenity test · Entitlement rehearsal · Policy impact · Investment memo · Custom. A template pre-fills suggested questions, persona mix, interaction mode, and report skeleton.
- **Success criteria** — what a "decision-grade" answer looks like to this user (feeds the report synthesizer).

### Stage 2 — Corpus (documents & data)

- Upload: PDF, DOCX, XLSX, CSV, GeoJSON, HTML, images (surveys, OMs, zoning codes, ESAs, rent rolls, site plans).
- Every doc is parsed, chunked, embedded, and indexed per-simulation (RAG). Agents cite documents by name + location; the report's "constraint checks against docs" counter (see demo report) is real: each numeric claim an agent makes is checked against the corpus by a verifier pass.
- Connected data (Phase 2+): agents may also query external tools (§7). The user toggles which tools this simulation may use.

### Stage 3 — Population (the differentiator — see §3 for the full seeding spec)

- The system proposes a population automatically from the brief + corpus: expert seats, consumer/resident cohorts, stakeholder seats, and at least one adversarial seed.
- The user can: accept as-is · edit any persona · add from their Agent Library · add from the Marketplace (Phase 3) · change counts · re-generate with guidance ("more first-time buyers; add a school-board voice").
- Population size: experts 4–64, consumers/residents 0–1,000 (POC ceiling; architecture supports more later).

### Stage 4 — Simulation (run)

- User picks an **interaction mode** (§5 maps each to a swarms architecture) and run parameters, then launches.
- Live view = the demo's run screen, made real:
  - **Left: agent network canvas** — nodes are agents (leads labeled), pulses are messages, clusters are disciplines, residents form the outer ring. Clicking a node opens the persona card + that agent's posts.
  - **Right: forum feed** — threaded posts with author, role, tag (POST n / REPLY / CHANGED POSITION), burst rollups ("+34 POSTS · COMPS + OPTION STRUCTURES"). Filterable by thread, discipline, or agent. Pause/resume, speed control, "skip to end."
- Everything streams over a realtime channel (§9); the transcript is persisted post-by-post as it happens.

### Stage 5 — Report (read)

- A synthesis pipeline (§8) turns the transcript + corpus + brief into the interactive report — the exact structure the demo report proved: verdict chip, executive summary, stat tiles, dimension scores, recommended structure, findings cited to transcript posts, critical path, risk register, deliberation analytics, preserved dissents, transcript quotes, tripwires, methodology & limitations.
- Every citation is a link: clicking "POSTS 2, 3" scrolls the transcript viewer to those posts. Every stat tile traces to its source (doc, tool call, or post).
- Exports: shareable link (org-scoped), PDF, and markdown.

---

## 3 · Population seeding system (the heart of the product)

### 3.1 Persona schema

Every agent — expert, consumer, resident, stakeholder — is one JSON document. This schema is the atom of the whole product (Library, Marketplace, simulation, report attribution all consume it):

```jsonc
{
  "id": "uuid",
  "kind": "expert | consumer | resident | stakeholder | adversarial",
  "name": "Rosa M.",                    // display name (synthetic)
  "initials": "RM",
  "role": "Grid interconnection planner",
  "tagline": "22 yrs SRP transmission · skeptical of broker timelines",
  "discipline": "POWER",                // drives graph clustering + colors
  "backstory": "…free text narrative…", // the persona's life/career story
  "traits": { "risk_tolerance": 0.3, "agreeableness": 0.4, "verbosity": 0.6 },
  "stances": ["Distrusts vendor timelines", "Prioritizes grid reliability"],
  "demographics": {                     // present for consumer/resident kinds
    "source": "acs_pums",               // acs_pums | manual | generated
    "puma": "0400112", "zips": ["85212"],
    "age": 41, "household": "married, 2 children", "tenure": "owner",
    "income_band": "$95–120K", "occupation": "K-12 teacher",
    "commute": "drives 28 min", "weight": 1.0   // sampling weight from PUMS
  },
  "knowledge": { "docs": true, "tools": ["census_acs", "web_research"] },
  "model": { "name": "claude-haiku-4-5", "temperature": 0.7 },  // tier by kind, §6.4
  "provenance": "auto | library | marketplace | manual",
  "version": 3, "author_org": "uuid|null", "public": false
}
```

### 3.2 Three seeding modes (all three can mix in one population)

**A. Auto (task-derived) — the default.**
An LLM "casting director" pass reads the brief + corpus and proposes the panel: which expert seats the question demands, which consumer/resident cohorts are affected, which stakeholders gate the outcome, and one or more adversarial seeds. Output = list of persona JSONs, shown as editable cards (the demo's Seed screen). Casting rules:
- Every question-to-resolve must have ≥1 expert seat that owns it.
- Every decision with a community surface gets resident cohorts + an organized-opposition seed.
- Every panel gets at least one skeptic ("we hire our own critics").

**B. Demographic (data-grounded cohorts).**
For consumer/resident populations that must look like a real place:
- **Primary source: Census ACS PUMS** — free public microdata (available on the [AWS Open Data Registry](https://registry.opendata.aws/census-dataworld-pums/)), giving joint distributions of age, household composition, income, tenure, occupation, commute at PUMA level. The user picks a geography (ZIPs / county / metro); we map to PUMAs, sample N household records proportionally (respecting PUMS weights), and an LLM pass turns each sampled record into a persona narrative (name, backstory, concerns) that *preserves the record's attributes*.
- **Upgrade path:** UrbanPop-class national synthetic populations (ORNL, published in Nature Scientific Data 2025) downscale PUMS to block-group level via iterative proportional fitting — same pipeline, finer geography. HUD, BLS, and FRED series can condition cohort context (rents, employment mix, rates).
- The demo's "ACS PUMS, ZIPS 85212 + 85142" line is exactly this mode.

**C. Narrative (authored personas).**
Manual creation and editing: the user writes (or dictates) role, backstory, stances; or pastes a bio; or asks the LLM to draft one from a one-liner ("a land-use attorney who's fought three data-center CUPs"). Saved to the Agent Library for reuse.

### 3.3 Real-estate persona taxonomy (starter library, ships with the product)

- **Capital:** LP allocator · credit officer · appraiser · powered-land investor · construction lender · insurance underwriter
- **Development:** land acquisition lead · division president (homebuilder) · multifamily developer · GC/estimator · architect
- **Market experts:** submarket broker (by asset class) · feasibility consultant · grid/utility planner · water resources engineer · fiber/telecom architect · geotech engineer · environmental (Phase I) consultant
- **Civic:** city planner · council member archetypes · planning commissioner · land-use counsel · school-district rep · transit agency rep
- **Community:** homeowner cohorts (by ACS profile) · renter cohorts · HOA president · organized-opposition advocate (adversarial) · local business owner
- **Demand-side consumers:** first-time buyer · move-up buyer · downsizer · relocating tech worker · Section 8 voucher holder · retiree on fixed income · investor-buyer

### 3.4 Agent Library & reuse

- Every persona (and every **Persona Set** — a saved panel composition like "Phoenix data-center diligence panel") is versioned and org-scoped.
- Users can favorite, fork, and re-run personas across simulations. Reuse is the retention loop.

### 3.5 Marketplace (Phase 3)

- Firms publish persona sets ("CBRE Entitlement Panel — Sun Belt", "JBRC Buyer Cohorts 2027") — free or paid; revenue share.
- Precedent: swarms.world already operates a marketplace for prompts/agents — validate demand there before building our own storefront. Marketplace listings use the same persona JSON with `public: true` + pricing metadata. Review/verification gate before listing (quality + fair-housing screen).

---

## 4 · Simulation parameters (user-configurable surface)

| Parameter | Range / options | Default |
|---|---|---|
| Interaction mode | Forum · Panel · Debate · Council · Hierarchy · Deep Research (see §5) | template-driven |
| Expert count | 4–64 | from casting pass |
| Consumer/resident count | 0–1,000 | from casting pass |
| Max discussion rounds (`max_loops`) | 1–10 | 3 |
| Max posts (budget cap) | 50–5,000 | 600 |
| Simulated duration | 1–30 "days" (pacing metaphor for the UI) | 14 |
| Speaker selection (Forum mode) | round-robin · random · priority · mention-driven | priority |
| Convergence rule | stop on stability of positions · fixed rounds · budget exhausted | stability |
| Dissent preservation | always on (not configurable) | on |
| Temperature bands | conservative ·  balanced · exploratory (maps to per-kind temps) | balanced |
| Tools enabled | per-tool toggles (§7) | docs-only |
| Adversarial seeds | 0–5 | 1 |
| Model tier | economy · standard · frontier (§6.4) | standard |
| Verifier pass | on/off (claim-vs-corpus checking) | on |
| Report template | per decision template, editable section list | template-driven |

Cost estimate is computed and shown **before** launch (posts × mean tokens × model rates), like the demo's "compressed to ~2 minutes" line — no surprise bills.

---

## 5 · Interaction modes → swarms architectures

We build on **[swarms](https://github.com/kyegomez/swarms)** (Apache-2.0, `pip install swarms`; also available as a hosted API at `POST /v1/swarm/completions` with a `swarm_type` config). Each product mode maps to a documented architecture:

| Product mode (user-facing) | swarms architecture | Use when | Reference |
|---|---|---|---|
| **Forum** (default — the demo) | `GroupChat` (+ InteractiveGroupChat @mentions) | Open deliberation; full shared history; threads and replies | [group-chat](https://docs.swarms.ai/docs/examples/examples/group-chat) |
| **Structured rounds** | `RoundRobin` | Every voice heard each round; brainstorm/consensus | [round-robin](https://docs.swarms.ai/docs/examples/examples/round-robin) |
| **Debate** | `DebateWithJudge` | Two-sided contested question; judge rules + refinement rounds | [debate-with-judge](https://docs.swarms.ai/docs/examples/examples/debate-with-judge) |
| **Council** | `LLMCouncil` | Independent takes → anonymized peer review → chairman synthesis; kills groupthink | [llm-council](https://docs.swarms.ai/docs/examples/examples/llm-council) |
| **Expert screen** | `MixtureOfAgents` | Parallel scored expert reads (fast, cheap first pass) | [mixture-of-agents](https://docs.swarms.ai/docs/examples/examples/mixture-of-agents) |
| **Memo desk** | `HierarchicalSwarm` (director + workers) | Investment-memo output; the swarms real-estate example is our template (~$0.20, ~60s per memo) | [real-estate-investment-memo](https://docs.swarms.ai/docs/examples/examples/real-estate-investment-memo) |
| **Deep research** | `HeavySwarm` (auto 5-phase: questions → research → analysis → alternatives → verification → synthesis) | Pre-simulation background packs; standalone research tasks | [heavy-swarm](https://docs.swarms.ai/docs/examples/examples/heavy-swarm) |

**Composition pattern for a full run (the demo's shape):**
1. `HeavySwarm` (optional) builds the background research pack from corpus + tools.
2. `MixtureOfAgents` cheap first-pass: every expert scores the question independently → seeds the agenda and the dimension scores.
3. `GroupChat` main deliberation (experts + sampled resident interjections), threaded by discipline; convergence detector watches position stability.
4. `DebateWithJudge` spot-runs on the 1–3 most contested subquestions surfaced in (3).
5. `HierarchicalSwarm` report desk: director (report synthesizer) + section workers write the final report from transcript + corpus (§8).

**Streaming:** swarms ≥8.2.0 provides real-time streaming callbacks for concurrent workflows, and `GroupChat` returns full attributed `conversation_history` (`agent_name`, `content` per message). The orchestrator (§9) relays each message as an event to the UI the moment it's produced; if a given architecture lacks granular callbacks, we wrap agent `run` calls to emit per-post events ourselves.

**Resident scale note:** we do NOT run 1,000 residents as 1,000 live chat participants. Pattern: residents are sampled into the GroupChat as rotating interjectors (the demo's "+37 POSTS · 214 RESIDENT AGENTS ACTIVE"), while cohort-level sentiment is computed by batched `ConcurrentWorkflow` polls of the full population between rounds. This keeps cost linear and the graph honest.

---

## 6 · Simulation engine design

### 6.1 Orchestrator service

A Python service (FastAPI) owns everything swarms-related:

- `POST /simulations/{id}/run` — builds Agent objects from persona JSONs (persona → `agent_name`, `system_prompt` compiled from backstory+stances+traits, `model_name`, `temperature`, tools), instantiates the composed swarm plan (§5), streams events.
- Persona → system prompt compilation is a pure function (`compile_persona_prompt(persona) -> str`), unit-tested, versioned — prompt regressions are product regressions.
- Every post/event is written to Postgres AND published to the realtime channel; the run is resumable from the transcript if the process dies.
- Verifier pass: an async checker agent validates numeric claims against the corpus index; contradictions get flagged into the transcript (the demo's "9 broker claims contradicted").

### 6.2 Event schema (the contract between engine and UI)

```jsonc
{ "type": "post",        "sim": "uuid", "seq": 214, "agent_id": "uuid",
  "thread": "POWER", "reply_to": 198, "tag": "POST|REPLY|FLIP|BURST",
  "content": "…", "cites": [{"kind":"doc","ref":"ALTA_SURVEY.PDF#p4"}], "ts": "…" }
{ "type": "stage",       "value": "seeding|running|converged|synthesizing|done" }
{ "type": "presence",    "agent_id": "uuid", "state": "thinking|speaking|idle" }
{ "type": "sentiment",   "cohort": "85212_renters", "dist": {"support":0.22,"conditional":0.41,"oppose":0.24,"disengaged":0.13} }
{ "type": "convergence", "aligned": 45, "total": 48, "dissents": 3 }
```

### 6.3 Open-source lib vs hosted swarms API

- **POC:** hosted Swarms API (`swarm_type` JSON configs) — zero infra, matches the doc examples verbatim.
- **v1:** self-host the open-source library inside our orchestrator for control over streaming granularity, model routing, retries, and cost; keep the API as a fallback runner. Decision gate: if per-post streaming through the hosted API is insufficient for the live graph, move earlier.

### 6.4 Model tiers

Default to current Claude models (swarms is provider-agnostic; keep `model.name` per-persona):

- **Residents/consumers (high count):** `claude-haiku-4-5` — cheap, fast, fine for reactive posts
- **Experts / debaters / judges:** `claude-sonnet-5`
- **Casting director, verifier, report synthesizer:** `claude-opus-4-8` (or `claude-sonnet-5` in economy tier)

---

## 7 · Agent tools (connected data)

Tools are per-simulation toggles; every tool call is logged and citable in the report ("source: tool"). Ship in this order:

**Phase 1 (POC):**
1. **Corpus RAG** — search the uploaded documents (always on).
2. **Web research** — search + fetch for public facts; results cached per simulation so agents share one factbase.

**Phase 2:**
3. **Census/ACS + PUMS** — demographics on demand (also powers seeding, §3.2B).
4. **FRED / BLS** — rates, employment, CPI series.
5. **HUD** — fair market rents, income limits, vacancy.
6. **Parcel & zoning** — Regrid parcels; municipal zoning codes (scraped/uploaded per project).
7. **FEMA flood (NFHL)** + **First Street-class climate risk**.
8. **OpenStreetMap / GTFS** — proximity, transit, drive-time isochrones.

**Phase 3 (commercial data, per-org API keys):** ATTOM / CoreLogic-class property data · Zillow research series · permits (Shovels-class) · Placer-class foot traffic · school ratings.

Tool = one interface: `{ name, description, json_schema, runner, citer }` — swarms `tools` accept callables, so each tool is a plain Python function with a docstring schema.

---

## 8 · Report engine

Pipeline (runs as the §5 "report desk"):

1. **Outline** from brief (questions-to-resolve = required sections) + decision template skeleton.
2. **Section workers** (parallel) each draft one section from: transcript (filtered to relevant threads) + corpus citations + tool results.
3. **Director** merges, dedupes, enforces voice, and — critically — compiles: verdict + conditions, dimension scores (panel-weighted, from the MixtureOfAgents pass + final positions), risk register w/ mitigations + watch signals, preserved dissents (verbatim, attributed), tripwires ("what would change the answer"), methodology & limitations (auto-generated from run config: seeds, counts, models, checks run).
4. **Fact gate:** every number in the draft must carry a citation (post, doc, or tool call) or it gets flagged/stripped.

The report is stored as structured JSON (sections, stats, citations) and rendered as an interactive document with the demo report's exact visual grammar (§10). Never a wall of markdown.

---

## 9 · Application architecture

### Stack

- **Frontend:** Next.js (App Router) + TypeScript on **Vercel**. Tailwind with tokens mapped 1:1 to §10 (no ad-hoc colors). Canvas (2D) for the network graph — port the demo's `canvasRef` renderer, which is already the visual spec.
- **Backend-for-frontend:** Next.js route handlers for CRUD; **Supabase** for Postgres + Auth + Storage (docs) + Realtime (event fan-out).
- **Simulation service:** Python FastAPI + swarms, deployed on Railway/Fly/Modal (worker + queue; runs are long-lived jobs). Publishes events to Supabase Realtime (or Redis→SSE bridge if latency demands).
- **Embeddings/RAG:** pgvector in Supabase.

### POC scope (build this first — no auth, single tenant)

1. One project, hardcoded user. Brief → upload docs → auto-cast population (editable cards) → Forum run with live graph + feed → report.
2. Hosted Swarms API as runner; corpus RAG + web research tools only; ACS PUMS seeding for one metro (Phoenix — matches the demo).
3. Success bar: reproduce the Site 47-A demo end-to-end **live** — same UX, real agents, real docs, unscripted output.

### v1 SaaS (after POC)

Supabase Auth (orgs, roles), simulation history, Agent Library UI, persona sets, shareable report links, billing (run-based credits + subscription tiers matching the research page's pricing model), self-hosted swarms runner.

### Data model (Postgres)

```
orgs(id, name, plan) · users(id, org_id, role)
projects(id, org_id, name)
simulations(id, project_id, status, brief jsonb, config jsonb, cost_actual, created_by)
documents(id, project_id, sim_id?, name, storage_path, parse_status)
doc_chunks(id, document_id, content, embedding vector)
personas(id, org_id?, kind, spec jsonb, version, public, source, author_org)
persona_sets(id, org_id, name, persona_ids uuid[])
sim_agents(sim_id, persona_id, spec_frozen jsonb)      -- frozen copy at run time
posts(id, sim_id, seq, agent_id, thread, reply_to, tag, content, cites jsonb, ts)
events(sim_id, seq, type, payload jsonb)               -- non-post events
tool_runs(id, sim_id, agent_id, tool, input jsonb, output jsonb, ts)
reports(id, sim_id, spec jsonb, version)
outcomes(id, sim_id, kind, observed jsonb, recorded_at) -- calibration hooks, day one
marketplace_listings(id, persona_set_id, price, status) -- phase 3
```

---

## 10 · Design system — the styling contract

**The app must be pixel-consistent with the landing site.** Extract, don't reinvent. All tokens below are copied from the HTML pages and are the single source of truth.

### Tokens (CSS custom properties)

```css
/* dark (default) */
--acc:#37d98a; --acc-dim:rgba(55,217,138,.13); --acc-c:#0a0b0c;
--warn:#d9a03f; --warn-dim:rgba(217,160,63,.13);
--bg:#0a0b0c; --sf:#0d0e10; --sf2:#101215;
--t0:#ffffff; --t1:#ececec; --t2:#c7cbcf; --t3:#b9bdc1; --t4:#adb2b7;
--t5:#9aa0a6; --t6:#8b9096; --t7:#6d7378;
--ln1:rgba(255,255,255,.07) … --ln8:rgba(255,255,255,.25);  /* 8-step line ramp */
--navbg:rgba(10,11,12,.72);

/* light theme: html[data-theme="light"] */
--acc:#0d9d63; --bg:#f6f6f4; --sf:#ffffff; --sf2:#f0f0ee; --t0:#0a0b0c; /* …see research.html:16 for full set */
```

Theme: `html[data-theme]`, persisted in `localStorage("mc-theme")`, sun/moon toggle in the nav — identical behavior to the site.

### Typography

- **Space Grotesk** (400/500/600/700) — all UI text and headings. Headings: weight 600, tight tracking (−.02 to −.035em), `clamp()` sizes (h1 `clamp(38px,5vw,68px)`, h2 `clamp(28px,3.2vw,44px)`).
- **JetBrains Mono** (400/500) — kickers, labels, chips, numbers, metadata. Kicker pattern: 11–12px, uppercase, letter-spacing .1–.14em, `--acc` or `--t6`.
- Body: 13.5–15.5px, line-height 1.6–1.7, `--t4`/`--t5` for secondary.

### Component inventory (copy patterns from the files cited)

| Component | Reference | Pattern |
|---|---|---|
| Fixed nav | any page `<nav>` | 64px, `--navbg` + `backdrop-filter: blur(14px)`, 1px `--ln1` bottom border, logo + mono pill badge |
| Kicker + h2 section header | `research.html` sections | mono kicker → h2 → muted intro paragraph, `max-width:1240px; padding:110px 40px` |
| Card | everywhere | `border:1px solid var(--ln3); border-radius:14–16px; background:var(--sf)`; hover → `border-color:var(--acc)` (or `--ln7` for quiet cards) |
| Pill chip | nav badge, team cards | mono 9.5–12px, `border-radius:100px`, 1px border, 3–8px × 9–16px padding |
| Primary button | CTAs | `background:var(--acc); color:var(--acc-c); border-radius:100px; font-weight:600`; hover `filter:brightness(1.12)` |
| Secondary button | CTAs | transparent, `1px solid var(--ln7/--ln8)`; hover border/text `--acc` |
| Stat tile | demo report `rstats` | mono micro-label → 18–34px number → mono sub |
| Slider | `research.html .mrange` | 4px track `--ln5`, 15px round thumb `--acc` |
| Score/progress bar | demo `scores` | 6–8px rounded track `--sf2`, fill `--acc`/`--warn`, `grow` animation |
| Timeline | research lineage / demo critical path | mono date column · dot+line spine · content column |
| Table | `.mtable` research.html | mono uppercase th, `--ln2` row borders, first column bold |
| Forum post card | demo feed | avatar circle + name/role/tag header + body; replies indent 36px with quiet border; FLIP tag = `--warn` |
| Burst divider | demo feed | center mono label between 1px `--ln2` rules |
| Verdict chip | demo report header | mono, 1px `--warn` border + `--warn-dim` bg (or `--acc` for GO) |
| Network graph | demo `canvasRef` renderer | port as-is: leads 3.4px nodes + labels, members 2px, residents 1.1px outer ring, pulse lines `--acc`, speaking = accent + ring |

### Motion

`fadeUp` (.4–.7s ease, staggered 0.08s), `grow` (scaleX bars), `pulseDot` (live indicators), `blink` (typing cursor), `shim` (skeleton loading — see demo Seed pending cards). Use sparingly; never decorative-only.

### Rules

- No new colors, radii, or fonts. If a needed token doesn't exist, propose it in a PR description first.
- Dark is the default; every component must pass in both themes.
- Numbers and labels are always JetBrains Mono. Prose is always Space Grotesk.
- Empty/loading states use the shimmer-card pattern from the demo Seed stage.

---

## 11 · Build phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spec** (this doc) | Product/tech/design contract | Merged to main |
| **1 · POC** | §9 POC scope; Next.js app in `/app` (or separate dir), FastAPI service in `/engine` | Site 47-A reproduced live, unscripted, <15 min wall-clock, <$25/run |
| **2 · Seeding depth** | ACS PUMS pipeline multi-metro, persona editor, Agent Library, persona sets, sentiment polling, verifier pass | A non-team user runs a novel question end-to-end unassisted |
| **3 · SaaS** | Auth/orgs, history, sharing, billing, self-hosted swarms runner, tool phase 2 | First 5 design-partner orgs active |
| **4 · Marketplace + calibration** | Persona marketplace, outcomes tables in anger, published backtests | First backtest report public; first paid marketplace listing |

---

## 12 · Working conventions for Claude Code in this repo

- The three `.html` pages + `support.js` are the marketing site — self-contained, no build step. Don't refactor them while building the app; they are the design reference.
- App code lives in `app/` (Next.js) and `engine/` (Python/FastAPI/swarms) — keep the split hard; the only contract between them is the event schema (§6.2) and REST endpoints.
- Never hardcode model names in business logic — model tier config only (§6.4).
- Every persona-prompt or report-prompt change needs a before/after example in the PR description.
- Test the live-stream path with a scripted fake run (replay the demo's 46 events) before touching real LLM runs — the demo's `events` array in `demo.html` is the golden fixture.
- Verify UI work in the browser against both themes; screenshot the run screen and report for every PR that touches them.
- Fair-housing gate: any feature that could rank or filter *individual* tenants/buyers is out of scope, full stop.

## 13 · Open questions (decide before Phase 2)

1. Resident scale economics: sampled-interjector pattern vs. full-population batched polls — what's the accuracy/cost frontier at 1K vs 10K agents?
2. Convergence detection: position-embedding stability vs. explicit "restate your position" polls each round?
3. Hosted Swarms API streaming granularity — sufficient for per-post live UI, or move to self-hosted at POC already?
4. PUMS licensing/attribution requirements for derived personas in a commercial product (likely fine — public domain — confirm).
5. Marketplace trust: who reviews published persona sets for quality and fair-housing compliance, and what's the rubric?
6. Report versioning when a user re-runs a simulation with tweaked parameters — diff view between runs?

---

*References: [swarms GitHub](https://github.com/kyegomez/swarms) · swarms docs examples: [group-chat](https://docs.swarms.ai/docs/examples/examples/group-chat), [llm-council](https://docs.swarms.ai/docs/examples/examples/llm-council), [real-estate-investment-memo](https://docs.swarms.ai/docs/examples/examples/real-estate-investment-memo), [round-robin](https://docs.swarms.ai/docs/examples/examples/round-robin), [debate-with-judge](https://docs.swarms.ai/docs/examples/examples/debate-with-judge), [mixture-of-agents](https://docs.swarms.ai/docs/examples/examples/mixture-of-agents), [heavy-swarm](https://docs.swarms.ai/docs/examples/examples/heavy-swarm) · [ACS PUMS on AWS Open Data](https://registry.opendata.aws/census-dataworld-pums/) · UrbanPop national synthetic population ([Nature Scientific Data, 2025](https://www.nature.com/articles/s41597-025-04380-7))*
