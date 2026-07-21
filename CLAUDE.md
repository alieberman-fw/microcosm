# CLAUDE.md — Microcosm Product & Technical Specification

> **Read this before writing any application code in this repo.**
> This document is the product spec, the technical spec, and the styling contract for the Microcosm app. The landing site (`index.html`, `demo.html`, `research.html`) is the design reference and the product's north star: the app must feel like the demo come to life.

---

## 1 · What we are building

**Microcosm is an AI agent-swarm simulation platform for the built world.** Users pose a hard real-estate question, upload their diligence documents, generate a configurable population of persona-grounded AI agents (experts, consumers, residents, stakeholders), watch those agents deliberate in real time, and receive a decision-grade interactive report.

The product exists to answer the hardest questions in the real estate vertical — go/no-go on a parcel, floor-plan and unit-mix selection, pricing, lease-up risk, entitlement and community consent, policy impact — by replacing the $15–50K, six-week feasibility study with a same-day simulation *run*.

**The demo (`demo.html`) is the product contract.** Its four stages — Brief → Seed → Run → Read — are the app's core loop. Everything in this spec elaborates that loop into a real, multi-tenant SaaS.

### Current repo state

- **Next.js app at the repo root** (`app/` routes, `components/`, deployed on Vercel) — the marketing landing page is now `app/page.tsx`; `/login` is the auth entry stub. This same Next.js app grows into the product (§9).
- `public/demo.html` + `public/support.js` — the scripted interactive demo, served statically at `/demo.html`. **The demo is the design reference and golden fixture; do not break it.** Its `events` array is the replay fixture for the live-stream path (§12).
- `public/media/hero-bg.mp4` — the landing hero background video (served from the repo via Vercel's CDN; compress before swapping in any larger file).
- `legacy/` — the original static `index.html` and `research.html`, archived for reference; not served.
- `docs/persona-taxonomy.md` — the master built-world persona library (~1,100 base personas + modifier axes); canonical input to the persona pre-generation pipeline (§3.3)
- `docs/demo-speaker-script.md` — presenter script for the site + demo
- The Python simulation engine will live in `engine/` (§9).

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

- **Composition selector (first choice on the screen):** `Experts only` · `Consumers/residents only` · `Mixed panel` — with independent count controls for each group. The casting pass recommends one of the three based on the brief (see the guidance table in §4.2), and the UI explains the tradeoff inline: experts answer *"will it work / is it feasible / how would professionals underwrite this,"* consumers and residents answer *"will people want it / pay for it / allow it."*
- The system proposes a population automatically from the brief + corpus: expert seats, consumer/resident cohorts, stakeholder seats, and at least one adversarial seed.
- The user can: accept as-is · edit any persona · add from their Agent Library · add from the Marketplace (Phase 3) · change counts · re-generate with guidance ("more first-time buyers; add a school-board voice").
- Population size: experts 4–500+ (large expert panels auto-organize into discipline sub-panels that roll up), consumers/residents 0–1,000 (POC ceiling; architecture supports 10K+ later via cohort batching).

### Stage 4 — Simulation (run)

- User picks an **interaction mode** (§5 maps each to a swarms architecture) and run parameters, then launches.
- Live view = the demo's run screen, made real:
  - **Left: agent network canvas** — nodes are agents (leads labeled), pulses are messages, clusters are disciplines, residents form the outer ring. Clicking a node opens the persona card + that agent's posts.
  - **Right: forum feed** — threaded posts with author, role, tag (POST n / REPLY / CHANGED POSITION), burst rollups ("+34 POSTS · COMPS + OPTION STRUCTURES"). Filterable by thread, discipline, or agent. Pause/resume, speed control, "skip to end."
- Everything streams over a realtime channel (§9); the transcript is persisted post-by-post as it happens.
- **Take the Floor (user participation).** The user is a first-class participant, not just a spectator. At any pause, at convergence, or after the report ships, the user can post directly into the forum and @mention any agent; mentioned agents reply with full context of the transcript, corpus, and their persona (implemented on InteractiveGroupChat's mention-driven speaker selection — the same machinery agents use on each other). User posts are transcript events with `author: "user"`, rendered distinctly in the feed (accent-bordered, "YOU · TAKING THE FLOOR"), and citable by the report like any other post. Typical uses: challenge a claim before synthesis ("@Rosa — what if the queue clears early?"), inject information the panel lacks, or steer attention to an under-argued question.

### Stage 5 — Report (read)

- A synthesis pipeline (§8) turns the transcript + corpus + brief into the interactive report — the exact structure the demo report proved: verdict chip, executive summary, stat tiles, dimension scores, recommended structure, findings cited to transcript posts, critical path, risk register, deliberation analytics, preserved dissents, transcript quotes, tripwires, methodology & limitations.
- Every citation is a link: clicking "POSTS 2, 3" scrolls the transcript viewer to those posts. Every stat tile traces to its source (doc, tool call, or post).
- Exports: shareable link (org-scoped), PDF, and markdown.
- **Ask a follow-up (the room stays open).** Every report ships with the panel still warm: an "Ask the panel" box reopens the forum scoped to a follow-up thread — the user posts, @mentions agents, and gets answers grounded in the full run. Material follow-up threads can be appended to the report as a dated addendum. This is Take the Floor (Stage 4) applied post-synthesis; same event semantics.
- **Scenario forks & report diffs.** Any completed simulation can be forked: change a parameter, a document, a persona, or a stated assumption, and re-run. Lineage is tracked (`simulations.parent_id`), and the report viewer renders a **diff view** between parent and fork — verdict change, dimension-score deltas, which agents flipped positions, which findings appeared/disappeared, cost of each run. This is how "what would change the answer" stops being a report section and becomes a button. (Resolves open question #6.)

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
The **Casting Director** is a frontier-tier LLM pass (always the strongest model tier regardless of the run's economy setting — casting quality bounds simulation quality) that reads the brief + corpus and makes THREE decisions, in order:

1. **Composition** — experts only, consumers/residents only, or mixed, and how many of each (rules in §4.2's guidance table).
2. **Seeding method per cohort** — it chooses the right mode for each group it casts: demographic seeding (mode B) whenever the cohort must represent a real place or market ("renters within 3 miles", "move-up buyers in Maricopa County"); narrative seeding (mode C) for experts, stakeholders, and adversarial seeds — and it *writes those narratives itself* (role, backstory, stances, traits), so a user who types one paragraph gets a fully-authored panel with zero manual work.
3. **Library match** — before generating any persona from scratch, it vector-matches each needed seat against the pre-generated persona library (§3.3): exact-fit personas are reused as-is, near-fits are instantiated with modifier axes (geography, disposition, sophistication), and only true gaps are generated new — then written back to the library so the catalog self-heals.

Output = list of persona JSONs, shown as editable cards (the demo's Seed screen). Non-negotiable casting rules:
- Every question-to-resolve must have ≥1 expert seat that owns it.
- Every decision with a community surface gets resident cohorts + an organized-opposition seed.
- Every panel gets at least one skeptic ("we hire our own critics").

**B. Demographic (data-grounded cohorts).**
For consumer/resident populations that must look like a real place:
- **Primary source: Census ACS PUMS** — free public microdata (available on the [AWS Open Data Registry](https://registry.opendata.aws/census-dataworld-pums/)), giving joint distributions of age, household composition, income, tenure, occupation, commute at PUMA level. The user picks a geography (ZIPs / county / metro); we map to PUMAs, sample N household records proportionally (respecting PUMS weights), and an LLM pass turns each sampled record into a persona narrative (name, backstory, concerns) that *preserves the record's attributes*.
- **How we access it (decided):** both an API and free bulk downloads exist. The Census Bureau's **Microdata API** (`api.census.gov/data/{year}/acs/acs1|acs5/pums`) is free (API key is free; needed above ~500 calls/day) and fine for prototyping. For production we **bulk-load**: PUMS person + household CSVs are public-domain downloads (census.gov FTP and the AWS Open Data mirror, a few GB per state-year) loaded into our own Postgres (or Parquet + DuckDB) — no rate limits, millisecond weighted sampling, and an annual refresh job when each new ACS vintage drops. POC ships with Arizona pre-loaded (matches the demo); metros are added by loading their states.
- **Upgrade path:** UrbanPop-class national synthetic populations (ORNL, published in Nature Scientific Data 2025) downscale PUMS to block-group level via iterative proportional fitting — same pipeline, finer geography. HUD, BLS, and FRED series can condition cohort context (rents, employment mix, rates).
- The demo's "ACS PUMS, ZIPS 85212 + 85142" line is exactly this mode.

**C. Narrative (authored personas).**
Manual creation and editing: the user writes (or dictates) role, backstory, stances; or pastes a bio; or asks the LLM to draft one from a one-liner ("a land-use attorney who's fought three data-center CUPs"). Saved to the Agent Library for reuse.

### 3.3 The persona library — taxonomy, pre-generation, and matching

**Canonical source: [`docs/persona-taxonomy.md`](docs/persona-taxonomy.md)** — the master built-world persona library (~1,100 base personas). It is structured as:

- **Part I — Horizontal library (37 categories):** Capital (equity · debt/credit) · individual investors · risk/insurance/title · development · design & engineering · construction (management · trades/field) · residential brokerage · commercial brokerage · mortgage & home finance · home services & inspection · property/asset management · hospitality & leisure · market experts/diligence/data · proptech · power & energy (generation · grid/utilities/markets · behind-the-meter) · water/waste/environmental · transportation/logistics · telecom & digital infrastructure · civic & regulatory (local · state/federal) · legal & professional · community & advocacy · land & natural resources · homeowners (by wealth tier & life situation) · renters & residential demand · commercial occupiers · institutions/nonprofits/anchors · disaster/resilience/recovery · media & influence · outdoor living/landscape/pool · agriculture · live events & festivals · film/TV/studio production
- **Part II — Asset-type build stacks:** the specialist rosters per product type (data center — the demo's stack, production homebuilding, custom/luxury, multifamily, high-rise/condo, mall/retail, industrial/logistics, cold storage, life science, hotel/resort, senior housing, studios/venues)
- **Part III — Technology & product-validation library:** engineering, data/AI, design/research, product/leadership, company-building/capital, GTM personas, and **buyer-side validation personas run adversarially by default** (enterprise buying committees, skeptics, churned customers) — this is how Microcosm simulates *proptech and software* questions, not just physical assets
- **Modifier axes (12):** asset class · geography/regulatory regime · disposition (cooperative→adversarial) · sophistication · cycle posture · scale · wealth tier · tenure/life stage · risk exposure · tech adoption · company stage · industry vertical. Base persona × axes = tens of thousands of effective personas.

**Additional demand-side cohorts we layer on top** (gaps worth owning for market simulations): retail shoppers & restaurant-goers (trade-area demand) · hotel guests & STR travelers · office employees (RTO sentiment) · industrial/logistics end-customers (shippers) · hyperscaler capacity planners (data-center demand) · event attendees. These fill out the *commercial consumer* side the same way §29 covers residential.

**The pre-generation pipeline (system setup, runs offline):**
1. Parse the taxonomy into base-persona records.
2. For each base persona, a frontier-model batch job generates the full persona JSON (§3.1): backstory, stances, traits, discipline, tool needs — reviewed once, then frozen as `library` provenance, version 1.
3. Embed every persona (role + backstory + stances) into pgvector.
4. Popular modifier-axis instantiations (e.g., "construction lender × Texas × skeptical × regional") are generated lazily on first use and cached back to the library.

**The matching flow (simulation time):** the Casting Director drafts the seats it needs → each draft seat is vector-searched against the library → **hit:** reuse (optionally re-instantiated along modifier axes) · **near-hit:** fork and adjust · **miss:** generate fresh, tag `auto` provenance, and queue for library backfill review. Users always see which of their panel came from the library vs. was custom-generated for them.

### 3.4 Agent Library & reuse

- Every persona (and every **Persona Set** — a saved panel composition like "Phoenix data-center diligence panel") is versioned and org-scoped.
- Users can favorite, fork, and re-run personas across simulations. Reuse is the retention loop.
- **Office Hours (direct consultation — shipped early).** Any library or custom persona can be consulted outside a simulation: a 1:1 chat grounded in the persona's compiled system prompt (§6.1), running on the expert-tier model (§6.4). Phase 2 adds **group sessions** — several personas plus the user in one thread with @mentions, on the same InteractiveGroupChat machinery as Take the Floor. Office Hours is the lightest product surface (no run, no report — just the expert) and the cheapest daily-retention hook. POC conversations are ephemeral; persistence arrives with simulation history.

### 3.5 Marketplace (Phase 3) — our own, first-party

The Microcosm Marketplace is a first-party storefront we own and operate (not a third-party listing venue). Two publishable units:

- **Individual personas/agents** — a single authored expert or cohort ("40-year Maricopa zoning attorney", "Sun Belt build-to-rent renter cohort 2027"), priced free or paid.
- **Persona sets** — complete panels ("CBRE Entitlement Panel — Sun Belt", "JBRC Buyer Cohorts 2027", "Data Center Diligence Stack") that drop into a simulation as one unit.

Mechanics: listings are the same persona JSON with `public: true` + pricing metadata; publisher revenue share; version pinning (a purchased set keeps working even if the publisher updates); ratings tied to post-run feedback ("did this panel change your decision?"). Every listing passes a review gate — quality rubric + fair-housing screen — before going live. Real-estate firms publishing their institutional judgment as agents is both a revenue stream for them and a calibration flywheel for us.

### 3.6 The seeding data corpus — curated third-party datasets

Seeding data ≠ runtime tools (§7). The corpus below is **batch-curated into our own Postgres** during system setup and refreshed on each vintage; it grounds persona *distributions and plausibility*. Runtime tools answer live questions mid-simulation; some sources (Census, HUD, FRED) appear in both roles. Privacy line: the corpus grounds distributions — **no real individual is ever simulated**; every persona is a synthetic composite.

**Tier 1 — POC (free, public-domain, bulk-loaded):**

| Dataset | What it seeds | Access |
|---|---|---|
| **ACS PUMS** (person + household) | The demographic backbone: joint age/income/tenure/household/occupation distributions (§3.2B) | Bulk CSV (census FTP / AWS Open Data); Microdata API for prototyping |
| **ACS summary tables + TIGER/Line + geocorr crosswalks** | ZIP↔PUMA↔tract mapping; block-group marginals for IPF downscaling | Census API + bulk shapefiles |
| **O*NET** (Dept. of Labor) | The *expert* persona backbone: knowledge, skills, tasks, tools, and work context for every SOC occupation — what a grid interconnection engineer actually knows and does | Free bulk database, annual |
| **BLS OES/QCEW** | Occupation & wage mix by metro — how many brokers vs. engineers vs. planners plausibly exist in a market (expert census realism) | API + bulk |
| **LEHD LODES** | Home↔work commute flows at block level — grounds "drives 28 min to Chandler" narratives | Bulk |
| **HUD FMR + Income Limits + CHAS** | Rent context and affordability strata for renter cohorts | HUD USER API + bulk |
| **FRED** | Rates, HPI, regional macro series injected as run context | API |

**Tier 2 — Phase 2 (free; adds attitudes, texture, and civic temperature):**

| Dataset | What it seeds | Access |
|---|---|---|
| **American Housing Survey (AHS)** | Unit condition, neighborhood satisfaction, moving intentions — homeowner/renter persona texture | Bulk microdata |
| **GSS + Pew datasets** | Attitude/values distributions (institutional trust, risk posture) mapped onto persona `traits` | Free microdata |
| **NAR Profile of Home Buyers & Sellers; Zillow/Redfin research series** | Behavioral priors: search duration, financing mix, contingency behavior for buyer cohorts | Published/free CSV |
| **IRS SOI county-to-county migration + USPS CoA** | Migration narratives ("relocating from LA with equity") and flow magnitudes | Bulk |
| **MIT Election Lab + local turnout data** | Civic temperature for entitlement sims — how contested is this jurisdiction | Bulk |
| **CDC PLACES** | Tract-level health context (senior-housing and healthcare-asset sims) | API + bulk |
| **State licensure rosters** (contractors, brokers, PEs, architects) | Expert-population plausibility per metro; curated state-by-state | Public rosters, scraped/curated |

**Tier 3 — licensed, per-org keys (Phase 3):** Esri Tapestry / Claritas PRIZM-class psychographic segments (narrative color) · L2/TargetSmart-class voter files (civic archetypes — handle with explicit sensitivity review) · ATTOM/CoreLogic property data · CoStar/Placer-class market and foot-traffic data (double as runtime tools).

---

## 4 · Simulation parameters

### 4.1 The configurable surface

| Parameter | Range / options | Default |
|---|---|---|
| Population composition | Experts only · Consumers/residents only · Mixed | from casting pass |
| Interaction mode | Agora · Roundtable · Tribunal · Chamber · Jury · Desk · Expedition (§5) | template-driven |
| Expert count | 4–500+ (sub-panels auto-form above ~32) | from casting pass |
| Consumer/resident count | 0–1,000 (POC) → 10,000+ (cohort batching, Phase 2) | from casting pass |
| Max discussion rounds (`max_loops`) | 1–100 | 3 |
| Max posts (budget cap) | 50–10,000+ | 600 |
| Simulated duration | 1–30 "days" (pacing metaphor for the UI) | 14 |
| Speaker selection (Agora mode) | round-robin · random · priority · mention-driven | priority |
| Convergence rule | stop on stability of positions · fixed rounds · budget exhausted | stability |
| Dissent preservation | always on (not configurable) | on |
| Temperature bands | conservative · balanced · exploratory | balanced |
| Tools enabled | per-tool toggles (§7) | docs-only |
| Adversarial seeds | 0–5 | 1 |
| Model tier | Economy · Standard · Frontier — Anthropic lineup (§6.4) | Standard |
| Verifier pass | on/off | on |
| Report template | per decision template, editable section list | template-driven |

Cost estimate is computed and shown **before** launch (posts × mean tokens × model rates), like the demo's "compressed to ~2 minutes" line — no surprise bills. Large settings (500 experts × 100 rounds × 10K posts) are allowed but the estimator will show exactly what that costs before the user commits.

### 4.2 Parameter glossary — what each control is, why it matters, when to use it

This glossary ships in-product as the help copy next to each control. Keep the two in sync.

**Population composition (Experts vs. Consumers/Residents — and how auto-decide works).**
The two groups answer different questions and are built differently:

| | **Experts** | **Consumers / Residents** |
|---|---|---|
| What they are | Professionals reasoning from *checkable constraints* — engineering, regulatory, market, capital | The people whose *behavior you're predicting* — buyers, renters, neighbors, guests, tenants |
| Where they come from | Narrative seeding: authored/generated backstories from the persona library (§3.3) | Usually demographic seeding: sampled from Census ACS PUMS records for a real geography, then given narratives (§3.2B); narrative-only cohorts also allowed |
| What they produce | Feasibility findings, risk registers, deal structures, dissent | Demand signals, willingness-to-pay, sentiment distributions, objections |
| The demo analog | The 48 experts (grid planner, water engineer, investor…) | The 400 ACS-seeded residents of ZIPs 85212/85142 |

So no — consumers/residents aren't *only* census-derived (you can author a purely narrative cohort like "downsizing boomers touring model homes"), but census-grounding is their default superpower: it makes the crowd look like the actual market.

**Auto-decide rule (what the Casting Director applies, and the UI explains):**
- Question is about *feasibility, engineering, underwriting, legal, timing* ("can this be built / financed / approved?") → **experts only**
- Question is about *demand, preference, pricing, sentiment* ("will they rent it / pay $X / choose plan A?") → **consumers/residents**, plus a thin expert bench to interpret results
- Question has a *community or political surface* (rezoning, data centers, density) → **mixed**, always with resident cohorts and an adversarial seed
- Big capital decisions ("should we buy this parcel?") → **mixed** — the demo's shape: experts deliberate feasibility while residents stress-test consent

**Max discussion rounds** — how many full passes the panel makes over the question. More rounds = positions refine, coalitions form, minds change (the demo's day-13 flip needed the later rounds). 1–3 for quick reads; 10–30 for contested questions; 50–100 only for long-horizon adversarial studies (cost scales linearly).

**Max posts** — the hard budget cap on total messages; the run stops gracefully and synthesizes whatever it has. Protects spend; the estimator prices it before launch.

**Simulated duration** — the narrative clock ("Day 7 of 14") used for pacing, burst rollups, and the report's timeline framing. Doesn't change compute; changes how the deliberation is staged and displayed.

**Speaker selection** (Agora) — who talks next: `priority` (relevance-weighted, most natural), `round-robin` (every voice each cycle, best for panels of equals), `random` (kills anchoring bias), `mention-driven` (agents summon each other with @name — most emergent, least predictable).

**Convergence rule** — when to stop: `stability` (positions stop moving between rounds — the honest default), `fixed rounds` (predictable cost/time), `budget` (run until the post cap). Convergence stats surface in the report either way ("45 of 48 aligned · 3 dissents").

**Temperature bands** — how "loose" agents think: `conservative` for compliance-flavored reads, `balanced` default, `exploratory` for brainstorming and tail-risk hunting (more variance, more surprises, slightly less repeatable).

**Adversarial seeds** — agents *instructed to oppose* (the demo's Elena R.). Why it matters: without seeded opposition, LLM panels drift agreeable and you ship a blind spot. 1 is the default; 2–5 for anything facing a hearing room.

**Model tier** — which Anthropic models power which agent kinds (§6.4). Economy for drafts and big-crowd sentiment runs; Standard for real work; Frontier when the decision at stake dwarfs the run cost.

**Verifier pass** — an independent fact-checking agent that runs *behind* the deliberation: every numeric or factual claim an agent makes is extracted and checked against the uploaded corpus and tool results; contradictions get flagged into the transcript and the report ("9 broker claims contradicted" in the demo is this feature). Why it matters: it's the difference between "agents said things" and "agents said things that survive an audit." Leave it on for anything decision-grade; turn it off only for cheap ideation runs.

**Report template** — which sections the final report must contain (driven by the decision template + questions-to-resolve). Editable pre-run so the output lands in the shape your IC expects.

---

## 5 · Interaction modes → swarms architectures

We build on **[swarms](https://github.com/kyegomez/swarms)** (Apache-2.0, `pip install swarms`; also available as a hosted API at `POST /v1/swarm/completions` with a `swarm_type` config).

**Naming rule:** our interaction modes carry Microcosm names — civic spaces of a city, on theme with "the city in silico" — and never expose the underlying framework names in the product. This table IS the mapping contract; keep it current if either side changes:

| Microcosm mode (user-facing) | swarms architecture | Use when | Reference |
|---|---|---|---|
| **Agora** (default — the demo) | `GroupChat` (+ InteractiveGroupChat @mentions — also powers Take the Floor, §2 Stage 4) | Open-square deliberation; full shared history; threads and replies | [group-chat](https://docs.swarms.ai/docs/examples/examples/group-chat) |
| **Roundtable** | `RoundRobin` | Every voice heard each round; brainstorm/consensus among equals | [round-robin](https://docs.swarms.ai/docs/examples/examples/round-robin) |
| **Tribunal** | `DebateWithJudge` | Two-sided contested question; advocates argue, a judge rules, rounds refine | [debate-with-judge](https://docs.swarms.ai/docs/examples/examples/debate-with-judge) |
| **Chamber** | `LLMCouncil` | Independent takes → anonymized peer review → chair synthesis; kills groupthink | [llm-council](https://docs.swarms.ai/docs/examples/examples/llm-council) |
| **Jury** | `MixtureOfAgents` | Parallel independent verdicts, scored and aggregated (fast, cheap first pass) | [mixture-of-agents](https://docs.swarms.ai/docs/examples/examples/mixture-of-agents) |
| **Desk** | `HierarchicalSwarm` (director + workers) | Research-desk memo output; the swarms real-estate example is our template (~$0.20, ~60s per memo) | [real-estate-investment-memo](https://docs.swarms.ai/docs/examples/examples/real-estate-investment-memo) |
| **Expedition** | `HeavySwarm` (auto 5-phase: questions → research → analysis → alternatives → verification → synthesis) | Autonomous deep research; pre-simulation background packs | [heavy-swarm](https://docs.swarms.ai/docs/examples/examples/heavy-swarm) |

**Composition pattern for a full run (the demo's shape):**
1. **Expedition** (optional) builds the background research pack from corpus + tools.
2. **Jury** cheap first-pass: every expert scores the question independently → seeds the agenda and the dimension scores.
3. **Agora** main deliberation (experts + sampled resident interjections), threaded by discipline; convergence detector watches position stability.
4. **Tribunal** spot-runs on the 1–3 most contested subquestions surfaced in (3).
5. **Desk** report synthesis: director + section workers write the final report from transcript + corpus (§8).

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
{ "type": "post",        "sim": "uuid", "seq": 214, "author": "agent|user",
  "agent_id": "uuid|null", "user_id": "uuid|null",
  "thread": "POWER", "reply_to": 198, "tag": "POST|REPLY|FLIP|BURST|FLOOR",
  "mentions": ["agent_uuid"],
  "content": "…", "cites": [{"kind":"doc","ref":"ALTA_SURVEY.PDF#p4"}], "ts": "…" }
{ "type": "stage",       "value": "seeding|running|converged|synthesizing|done" }
{ "type": "presence",    "agent_id": "uuid", "state": "thinking|speaking|idle" }
{ "type": "sentiment",   "cohort": "85212_renters", "dist": {"support":0.22,"conditional":0.41,"oppose":0.24,"disengaged":0.13} }
{ "type": "convergence", "aligned": 45, "total": 48, "dissents": 3 }
```

### 6.3 Open-source lib vs hosted swarms API — DECIDED: self-host from day one

We use the **open-source `swarms` library inside our own engine** from the POC onward (no Swarms API key, no extra vendor). Rationale: the library orchestrates in-process and calls Anthropic directly with our `ANTHROPIC_API_KEY`; per-post streaming into our event bridge is trivial when we own the process; per-persona model routing and prompt compilation become plain config. The hosted Swarms API remains a documented fallback runner only. (This resolves former open question #3.)

### 6.4 Model tiers — Anthropic lineup, priced by role

We standardize on the Anthropic API (swarms is provider-agnostic; `model.name` stays per-persona config, never hardcoded in logic). The tier maps price/intelligence to the job each agent kind does:

| Agent kind | **Economy** | **Standard** (default) | **Frontier** |
|---|---|---|---|
| Consumers/residents (high count) | `claude-haiku-4-5` | `claude-haiku-4-5` | `claude-sonnet-5` |
| Experts, debaters, judges | `claude-haiku-4-5` | `claude-sonnet-5` | `claude-opus-4-8` |
| Casting Director | `claude-sonnet-5` | `claude-opus-4-8` | `claude-opus-4-8` |
| Verifier pass | `claude-haiku-4-5` | `claude-sonnet-5` | `claude-opus-4-8` |
| Report synthesizer (Desk director) | `claude-sonnet-5` | `claude-opus-4-8` | `claude-opus-4-8` |

Logic: Haiku-class ≈ 1× cost (fast, ideal for high-volume reactive posts and cohort sentiment polls), Sonnet-class ≈ 3–5× (the reasoning workhorse), Opus-class ≈ 5–15× (reserved for the leverage points — casting, judging, synthesis — where one model call shapes the whole run). Exact per-token pricing changes; pull current rates from the Anthropic pricing page at build time and keep them in the cost-estimator config, never in code. The Casting Director never drops below Sonnet even in Economy — casting quality bounds everything downstream. Prompt caching (shared corpus context across hundreds of agents) is the single biggest cost lever; design the context layout for cache hits from day one.

---

## 7 · Agent tools (connected data)

Tools are per-simulation toggles; every tool call is logged and citable in the report ("source: tool"). Distinct from the seeding corpus (§3.6): seeding data is batch-curated to *build* the population before the run; tools are what agents *call live* during the run. Census/HUD/FRED serve both. Ship in this order:

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

Pipeline (runs as the §5 **Desk** stage):

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

### POC scope — narrow features, real infrastructure from day one

We do NOT build a throwaway single-tenant demo. Vercel + Supabase are provisioned from the first commit so users, simulations, agents, and reports are durable from run #1 and nothing gets migrated later:

1. **Infrastructure day one:** Supabase Auth (email + Google), Postgres with the full data model below + row-level security, Storage buckets for documents, Realtime channel for run events; Vercel project with preview deployments per PR. Every user gets a personal org (`orgs` row) at signup — team features come later, but all data is org-scoped from the start.
2. **Feature scope stays narrow:** Brief → upload docs → auto-cast population (editable cards) → Agora run with live graph + feed → report. Hosted Swarms API as runner; corpus RAG + web research tools only; ACS PUMS seeding for one metro (Phoenix — matches the demo).
3. **History is a POC feature, not a v1 feature:** the dashboard lists the user's simulations, agents, and reports from the first run — persistence IS the product memory and the calibration substrate (§1, principle 5).
4. Success bar: reproduce the Site 47-A demo end-to-end **live** — same UX, real agents, real docs, unscripted output.

### v1 SaaS (after POC)

Multi-user orgs (invites, roles), shareable report links, billing (run-based credits + subscription tiers matching the research page's pricing model), Agent Library UI + persona sets, self-hosted swarms runner, seeding corpus tier 2.

### Data model (Postgres)

```
orgs(id, name, plan) · users(id, org_id, role)
projects(id, org_id, name)
simulations(id, project_id, parent_id?, status, brief jsonb, config jsonb, cost_actual, created_by)  -- parent_id = scenario-fork lineage
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

**The app must be pixel-consistent with the landing site and demo — a user moving from `demo.html` into the real app should not be able to tell they changed applications.** Same fonts, same tokens, same components, same motion. Extract, don't reinvent. All tokens below are copied from the HTML pages and are the single source of truth.

**App screen ↔ existing-page reference (build each screen against its reference, side by side):**

| App screen | Reference |
|---|---|
| Brief composer | `demo.html` Stage 01 (typing header, doc-parse rows, question chips) |
| Population editor | `demo.html` Stage 02 (expert cards, shimmer loading, counts readout) + `research.html` team grid (filled-card pattern) |
| Live simulation | `demo.html` Stage 03 (canvas network + forum feed + progress bar + speed/skip controls) |
| Report viewer | `demo.html` Stage 04 (the full report grammar: verdict chip, stat tiles, scores, risk register, dissents) |
| Dashboard / lists / library | `research.html` card grids and section rhythm; `index.html` nav and CTA patterns |
| Interactive model-style widgets | `research.html` sliders (`.mrange`), scenario pills, computed outputs |

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
| **1 · POC** | §9 POC scope on production infra (Vercel + Supabase Auth/DB/Storage/Realtime from day one); Next.js app in `/app`, FastAPI service in `/engine` | Site 47-A reproduced live, unscripted, <15 min wall-clock, <$25/run — by a signed-in user whose run persists |
| **2 · Seeding depth** | ACS PUMS pipeline multi-metro, seeding corpus tier 2 (§3.6), persona editor, Agent Library, persona sets, sentiment polling, verifier pass | A non-team user runs a novel question end-to-end unassisted |
| **3 · SaaS** | Multi-user orgs & roles, sharing, billing, self-hosted swarms runner, tool phase 2 | First 5 design-partner orgs active |
| **4 · Marketplace + calibration** | Persona marketplace, outcomes tables in anger, published backtests | First backtest report public; first paid marketplace listing |

---

## 12 · Working conventions for Claude Code in this repo

- `public/demo.html` + `public/support.js` are the scripted demo — self-contained, no build step. Don't refactor them while building the app; the demo is the design reference. The archived originals live in `legacy/`.
- App code is the Next.js project at the repo root (`app/`, `components/`); the simulation engine lives in `engine/` (Python/FastAPI/swarms) — keep the split hard; the only contract between them is the event schema (§6.2) and REST endpoints.
- Secrets live in `.env.local` (gitignored, never committed): `ANTHROPIC_API_KEY`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, plus Supabase project keys once provisioned.
- Never run `npm run build` while `next dev` is running — they share `.next/` and the build corrupts the dev server's module graph (broken hydration, phantom module errors). Stop dev, build, `rm -rf .next`, restart dev.
- Never hardcode model names in business logic — model tier config only (§6.4).
- Every persona-prompt or report-prompt change needs a before/after example in the PR description.
- Test the live-stream path with a scripted fake run (replay the demo's 46 events) before touching real LLM runs — the demo's `events` array in `demo.html` is the golden fixture.
- Verify UI work in the browser against both themes; screenshot the run screen and report for every PR that touches them.
- Fair-housing gate: any feature that could rank or filter *individual* tenants/buyers is out of scope, full stop.

## 13 · Open questions (decide before Phase 2)

1. Resident scale economics: sampled-interjector pattern vs. full-population batched polls — what's the accuracy/cost frontier at 1K vs 10K agents?
2. Convergence detection: position-embedding stability vs. explicit "restate your position" polls each round?
3. ~~Hosted Swarms API streaming granularity~~ — RESOLVED: self-hosted open-source library from day one (§6.3).
4. PUMS licensing/attribution requirements for derived personas in a commercial product (likely fine — public domain — confirm).
5. Marketplace trust: who reviews published persona sets for quality and fair-housing compliance, and what's the rubric?
6. ~~Report versioning when a user re-runs with tweaked parameters~~ — RESOLVED: scenario forks with `parent_id` lineage and a first-class report diff view (§2 Stage 5).

---

*References: [swarms GitHub](https://github.com/kyegomez/swarms) · swarms docs examples: [group-chat](https://docs.swarms.ai/docs/examples/examples/group-chat), [llm-council](https://docs.swarms.ai/docs/examples/examples/llm-council), [real-estate-investment-memo](https://docs.swarms.ai/docs/examples/examples/real-estate-investment-memo), [round-robin](https://docs.swarms.ai/docs/examples/examples/round-robin), [debate-with-judge](https://docs.swarms.ai/docs/examples/examples/debate-with-judge), [mixture-of-agents](https://docs.swarms.ai/docs/examples/examples/mixture-of-agents), [heavy-swarm](https://docs.swarms.ai/docs/examples/examples/heavy-swarm) · [ACS PUMS on AWS Open Data](https://registry.opendata.aws/census-dataworld-pums/) · UrbanPop national synthetic population ([Nature Scientific Data, 2025](https://www.nature.com/articles/s41597-025-04380-7))*
