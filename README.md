<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" width="110" alt="Microcosm logo">
  </picture>
</p>

<h1 align="center">microcosm</h1>

<p align="center">
  <strong>Simulate the market before you build for it.</strong><br>
  Agent-simulation platform for the built world.
</p>

<p align="center">
  <a href="#the-idea">The idea</a> ·
  <a href="#the-product-today">The product today</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#build-checklist">Build checklist</a> ·
  <a href="#the-value">The value</a> ·
  <a href="#running-locally">Run it</a>
</p>

---

## The idea

Real estate is the worst-instrumented big-money decision domain in the economy. Land is bought once, product is entitled once, a tower is built once — all committed before a single buyer is surveyed. Feedback loops run 12+ months, decision-grade research costs $15–50K and takes six weeks per question, and the stakeholders who decide a project's fate — buyers, renters, neighbors, lenders, councils, LPs — never sit in one room.

**Microcosm puts them in one room.** It seeds thousands of persona-grounded AI agents — buyers, renters, neighbors, lenders, investors, and domain experts — that react, debate, change their minds, and converge (or dissent, on the record). Then it hands you the report, before a single dollar of capital is committed.

Two product modes:

| Mode | Question it answers | Example |
|---|---|---|
| **Consumer panels** | Will they pay? | Which floor plan, what unit mix, what price point, which amenity package |
| **Expert deliberation** | Will it work — and will they allow it? | Site go/no-go, entitlement rehearsal, policy wind-tunnel runs |

The bet under both: the $15–50K, six-week feasibility study collapses into a *run* — and whoever owns the calibration data that makes runs decision-grade owns the layer.

### Why now

- **The science matured.** Stanford's generative-agents line went from 25 agents in a sandbox town (2023) to 1,000-person replications hitting 85% of humans' own test-retest consistency (2024) to million-agent societies (2025). Agent-based modeling is 50 years old; LLMs just gave the agents the ability to read a floor plan and argue about it.
- **The economics flipped.** Per-unit intelligence deflates 10–40× a year. A thousand-agent metro run costs dollars, not grants.
- **The category is funded — and horizontal.** Aaru raised at a ~$1B headline; Simile ($100M Series A) employs the field's founding scientists. Nobody has verticalized for the built world, where decisions are the most illiquid and the stakes highest.

## The product today

A working multi-tenant app (internal preview, Fifth Wall Google accounts only) plus the scripted demo that serves as the product's design contract. What a signed-in user can do right now:

| Surface | What it does |
|---|---|
| **Conversations** (`/conversations`) | iMessage-style 1:1 and group chats (up to 20 personas). @mention with **autocomplete** to direct a question; with no mention, a Haiku router picks the right responder. Attach up to 8 images/PDFs per message (5MB each, ~20MB combined) — experts analyze the actual file contents. Per-participant **model toggle** (Haiku 4.5 default → Sonnet 5 → Opus 4.8), persisted per thread. Big rooms get a **roster panel** (scroll everyone, open full profiles, cycle model tiers). Rename or delete any thread from its hover menu; fresh threads with the same people are one click; history is durable and org-scoped. |
| **Agent Library** (`/personas`) | ~1,850 generated personas spanning the entire built-world taxonomy — every one with a name, age, metro, household, income, credentials, career backstory, standing positions, skills, and behavioral traits. Click any card for the full profile view. **Smart search** in plain language: a problem ("looking to build a data center") or a person ("under 40 homeowner") — an LLM pass turns the query into full-text terms + demographic filters. Custom personas: create, chat, delete (org-scoped). |
| **Monitoring** (`/monitoring`) | Every model call the org makes — surface, agent, model, tokens in/out, latency, status — with estimated spend. |
| **Dashboard** (`/dashboard`) | Simulation history (persistence is the product memory — and the future calibration substrate). |
| **Run screen** (`/sim/demo`) | The live-simulation UI (network graph + forum feed) replaying the demo's 46-event golden fixture — the contract the real engine must stream into. |
| **Live demo** (`/demo.html`) | The scripted four-stage walkthrough (Brief → Seed → Run → Read) on Site 47-A — static, self-contained, the design golden fixture. |

## Architecture

Three layers, one contract between them (the event schema in `CLAUDE.md` §6.2).

```
┌─ Next.js 15 (App Router, TS) on Vercel ─────────────────────────┐
│  UI (inline styles + CSS token design system, dark/light)       │
│  BFF route handlers: /api/converse · /api/personas/search       │
└──────────────┬───────────────────────────────┬──────────────────┘
               │ @supabase/ssr (RLS-scoped)    │ @anthropic-ai/sdk
┌──────────────▼──────────────┐   ┌────────────▼──────────────────┐
│  Supabase                   │   │  Anthropic API                │
│  Postgres + org RLS         │   │  Haiku 4.5 / Sonnet 5 /       │
│  Auth (Google, internal)    │   │  Opus 4.8 (see tiers below)   │
│  Storage (documents bucket) │   └───────────────────────────────┘
│  Realtime (run events) ·    │
│  pgvector (embeddings col)  │
└──────────────▲──────────────┘
               │ event schema §6.2 (posts, stage, presence, sentiment, convergence)
┌──────────────┴──────────────────────────────────────────────────┐
│  engine/ — Python FastAPI + swarms (simulation runs; skeleton)  │
└─────────────────────────────────────────────────────────────────┘
```

### Frameworks & libraries that do the heavy lifting

| Layer | Technology | Role |
|---|---|---|
| Web app | **Next.js 15** (App Router) + TypeScript + React 19, deployed on **Vercel** (GitHub → main auto-deploy) | All UI + backend-for-frontend route handlers |
| Data / auth / files | **Supabase**: Postgres with row-level security (every table org-scoped via `public.user_org()`), Auth (Google OAuth, internal-only; email sign-in disabled at the provider level), Storage, Realtime, pgvector | Multi-tenant persistence from day one — users, orgs, personas, conversations, documents, interactions |
| LLM access | **`@anthropic-ai/sdk`** (direct, no middleware) | Group-chat replies, routing, persona generation, smart-search query parsing |
| Simulation orchestration | **[swarms](https://github.com/kyegomez/swarms)** (Apache-2.0, self-hosted in `engine/` — Python FastAPI) | Multi-agent architectures behind the Microcosm interaction modes (below); the hosted Swarms API is a documented fallback only |
| Persona search | **Postgres full-text search** (generated `tsvector` + GIN) + a Haiku query-understanding pass + jsonb demographic filters via the `search_personas` RPC | "Under 40 homeowner" → age/tenure filters; "build a data center" → expanded professional term search |

### Group chats vs. simulations — how each runs

**Conversations (shipped)** are orchestrated in the Next.js route handler ([app/api/converse/route.ts](app/api/converse/route.ts)): parse @mentions → if none, a Haiku router reads the transcript tail and picks 1–2 responders → each responder gets its compiled persona system prompt ([lib/personas.ts](lib/personas.ts) `compilePersonaPrompt` — a versioned pure function), the rolling transcript, and any attachments as native image/document content blocks → replies generate sequentially so later speakers can react to earlier ones → every call is logged to `agent_interactions`.

**Simulations (next)** run in `engine/` on swarms, streaming events to Supabase Realtime. The interaction modes users see map to swarms architectures:

| Microcosm mode | swarms architecture | Shape |
|---|---|---|
| **Agora** (default) | `GroupChat` / `InteractiveGroupChat` | Open-square deliberation, threads, @mentions — also powers "Take the Floor" |
| **Roundtable** | `RoundRobin` | Every voice each round |
| **Tribunal** | `DebateWithJudge` | Advocates argue, judge rules |
| **Chamber** | `LLMCouncil` | Independent takes → anonymized peer review → synthesis |
| **Jury** | `MixtureOfAgents` | Parallel verdicts, aggregated |
| **Desk** | `HierarchicalSwarm` | Director + section workers (report synthesis) |
| **Expedition** | `HeavySwarm` | Autonomous deep research packs |

### Anthropic models — who runs on what

Model ids live in config only ([lib/chat-models.ts](lib/chat-models.ts), `CLAUDE.md` §6.4) — never hardcoded in logic.

| Model | Tier | Where it runs today |
|---|---|---|
| **Haiku 4.5** (`claude-haiku-4-5`) | Lightweight & fast | Default for every chat reply (bump per-persona via the thread toggle) · group-chat responder routing · smart-search query parsing |
| **Sonnet 5** (`claude-sonnet-5`) | Balanced | "Balanced" chat tier · the persona foundry (`scripts/generate-personas.mjs`) · future: casting director (standard), verifier |
| **Opus 4.8** (`claude-opus-4-8`) | Frontier reasoning | "Frontier" chat tier · future: judges, casting (frontier), report synthesis |

### The persona pipeline

1. [`docs/persona-taxonomy.md`](docs/persona-taxonomy.md) — the master library: 37 horizontal categories, 12 asset-type build stacks, the tech/product-validation library, 12 modifier axes (~1,100 base personas).
2. [`scripts/generate-personas.mjs`](scripts/generate-personas.mjs) parses it into ~1,867 seats (household/demand cohorts get 2–3 demographic variants), batches 10 seats per Sonnet call, and writes full persona JSONs to Postgres as global library rows. Idempotent via `spec.seed_key` — re-run any time; only gaps generate.
3. Every persona is a **synthetic composite** — realistic demographics and career narratives, never a real individual. Fair-housing line: Microcosm simulates markets and decisions, never individual tenant/buyer screening.
4. Search: Haiku translates the user's natural-language query into websearch-syntax terms + structured filters (age bounds, tenure, kind) → `search_personas` RPC executes over the FTS index under RLS. The pgvector matching flow (casting-time library reuse) activates when an embeddings key is added — the `embedding vector(1536)` column is already in the schema.

## Build checklist

**This is the living tracker — every feature PR checks items off (or adds them) so the README always shows what exists and what's next.** Mirrors `CLAUDE.md` §11 phases.

### Phase 0 — Spec
- [x] `CLAUDE.md`: product / tech / design contract, persona taxonomy, swarms mode mapping

### Phase 1 — POC (real infrastructure, narrow features)
- [x] Landing site + interactive scripted demo (the design golden fixture)
- [x] Supabase from day one: full schema + org RLS, personal org per signup, Storage, signup trigger
- [x] Auth: Google OAuth locked to the Fifth Wall workspace; email sign-in disabled at the provider
- [x] App shell: sidebar nav, profile popover, theme toggle, settings, dashboard history
- [x] Run-screen golden fixture: `/sim/demo` replays the demo's 46 events through the real event schema
- [x] **Conversations**: persistent 1:1/group chats, @mentions, Haiku responder routing, fresh threads
- [x] **Attachments**: 8 images/PDFs per message analyzed natively; overlap-chip UX with +N expander/lightbox
- [x] **Monitoring**: every model call logged (`agent_interactions`) with estimated spend
- [x] **Persona library at scale**: ~1,850 taxonomy-generated personas with full demographics/backstories; profile view; LLM smart search; picker integration
- [x] **Per-participant model toggle** (Haiku 4.5 default · Sonnet 5 · Opus 4.8), persisted per thread
- [x] **Chat management**: rename/delete via hover ⋯ menu; rooms up to 20 personas with a roster panel (scroll the list, click through to full profiles, cycle each person's model tier); @mention autocomplete in the composer
- [x] **Library QC + speed**: every persona name unique library-wide (dedup pass + generator enforcement); LLM audit of demographics coherence (income/credentials/tenure/experience vs role + metro); two-phase search (instant full-text, AI refinement ~2s later); middleware session fast-path; same-name participants disambiguated end-to-end (typeahead-resolved mention keys, role-tagged transcript labels)
- [x] **Library filters + pagination**: filter rail (kind · category · age band · tenure · sort) with facet counts, composing with tabs and search; 24-per-page pagination with totals; LLM parse cached across pages
- [x] **Chat polish**: markdown rendering in replies (bold/headers/lists/code + @mention highlighting, dependency-free); sidebar list fills its height with SEE ALL → searchable `/conversations/history` (deep links reopen the exact thread); landing **Conversations** section ("Don't need a full simulation? Just ask the room.")
- [x] **Monitoring analytics**: filter rail (area · model · status · search), 14-day activity chart, spend-by-model and calls-by-area breakdowns, app-area labels, and expandable rows showing the conversation context — what was asked, what the agent replied, per-call spend, and a deep link into the thread
- [x] **Remix + full persona editor**: remix any persona (library or custom) into your own editable copy with a ⑂ REMIX tag and a clickable lineage chain (remix-of-remix keeps full ancestry, e.g. "Delores V. → Casey R. → Jordan P."); custom personas get every library field (tagline, demographics, skills, trait sliders) and are editable after creation; renames auto-rewrite story references; chat composer grows vertically as you type
- [x] **Clean location fields**: demographics store city and state separately (all 1,867 library rows migrated off "Kansas City, MO"-style duplication); the editor's CITY field is a verifiable typeahead over a curated US city dataset (✓ VERIFIED / UNLISTED hint) with a proper State select; displays recompose "City, ST"
- [ ] **⟶ NEXT: Brief composer + corpus** — problem statement, auto-suggested question chips, document upload → parse/chunk/embed (RAG)
- [ ] Casting Director: auto-population from brief + corpus, library vector matching, editable persona cards
- [ ] ACS PUMS demographic seeding (Arizona first — the demo's ZIPs)
- [ ] Agora engine: swarms `GroupChat` in `engine/`, events over Supabase Realtime into the live run screen
- [ ] Verifier pass: claims checked against the corpus, contradictions flagged
- [ ] Report engine: Desk-mode synthesis — verdict, dimension scores, cited findings, risk register, preserved dissents
- [ ] **Phase 1 exit:** Site 47-A reproduced live, unscripted, <15 min wall-clock, <$25/run, by a signed-in user whose run persists

### Phase 2 — Seeding depth
- [ ] Multi-metro PUMS pipeline + seeding corpus tier 2 (AHS, GSS/Pew, NAR, migration, licensure)
- [ ] Persona editor + persona sets; embeddings-based library matching (Voyage key)
- [ ] Cohort sentiment polling between rounds; convergence detection
- [ ] Scenario forks + report diffs (`simulations.parent_id`)
- [ ] Take the Floor: user posts into live runs; Ask-the-panel follow-ups on reports
- [ ] Conversations v2: docs through the corpus pipeline, in-thread chart generation, opt-in cross-thread memory

### Phase 3 — SaaS
- [ ] Multi-user orgs, invites, roles; shareable report links
- [ ] Billing: run-based credits + subscription tiers
- [ ] Tool phase 2: Census/FRED/HUD/parcel/flood/OSM live tools

### Phase 4 — Marketplace + calibration
- [ ] First-party persona marketplace (review gate: quality + fair-housing)
- [ ] Outcomes tables in anger; first published backtest

## The value

**The unit of work it replaces.** Decision-grade feasibility research runs $15–50K and six weeks per question. A Microcosm run is same-day, and the marginal research question becomes nearly free. Pricing follows a barbell the market has already validated:

- **Team tier (~$18K/yr)** — unlimited standard runs, priced below a single consultant study. A no-committee purchase with thousands of potential buyers.
- **Enterprise tier (~$250K/yr)** — the calibrated metro twin, the underwriting API, and the accuracy record. Sales-led, like every six-figure enterprise simulation deal in the category.
- **Public channel (~$120K/engagement)** — intervention studies for cities and pro-housing funders, on procurement rails Replica already proved (MTA, State of Illinois).

**The market.** ~$14B/yr global real estate consulting (market research and due diligence are its two largest segments), inside a $150B+ insights industry and a $198B US real estate services market.

**The moat.** The generative-agent layer is commoditizing — the moat is vertical: a real estate ontology baked into personas and reports, calibration against *actual* sales curves, lease-ups, and hearing outcomes, and embedding in underwriting workflows. The outcome corpus compounds; the agents don't.

### Honest limits

Synthetic populations are strong on stated preferences, message tests, directional ranking, and anticipating objections. They are weak in documented ways — sycophancy, compressed tails, WEIRD bias, optimism-skewed preferences — and Microcosm's position is to model the say-do gap explicitly, publish backtests with error bars, and disclose every output as synthetic and directional. Fair-housing review gates any use case near tenant or buyer selection. The simulation informs the decision-maker; it never replaces them.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Secrets live in `.env.local` (gitignored): `ANTHROPIC_API_KEY`, Supabase URL/keys, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`. The app runs unauthenticated pages without them, but auth, Conversations, and the library need Supabase + Anthropic keys.

One-time / occasional scripts:

```bash
node scripts/generate-personas.mjs --dry     # parse the taxonomy, count seats
node scripts/generate-personas.mjs           # generate & insert missing library personas (idempotent)
npx supabase db push --password $SUPABASE_DB_PASSWORD   # apply new migrations
```

Working in **Claude Code**? A preview config ships in [`.claude/launch.json`](.claude/launch.json) — the `microcosm-app` server starts on port 3000 straight from the Browser pane.

## Repo layout

```
├── app/                    # Next.js routes
│   ├── page.tsx            #   landing
│   ├── login/              #   Google-only auth
│   ├── (app)/              #   authed app: dashboard, conversations, personas, monitoring, settings
│   ├── api/converse/       #   group-chat orchestration (routing, replies, attachments, logging)
│   ├── api/personas/search #   LLM smart search over the library
│   └── sim/demo/           #   golden-fixture run screen
├── components/             # Nav, Hero, app shell, Conversations, PersonaManager, RunScreen…
├── lib/                    # personas + prompt compiler, chat model tiers, supabase clients, event schema, fixtures
├── engine/                 # Python FastAPI + swarms simulation service (skeleton)
├── scripts/                # generate-personas.mjs (persona foundry)
├── supabase/migrations/    # schema, RLS, conversations, monitoring, library search, model overrides
├── docs/                   # persona taxonomy (~1,100 base personas), speaker script
├── public/                 # demo.html + support.js (golden fixture), hero video
├── legacy/                 # archived original static pages
└── CLAUDE.md               # the product/tech/design spec — read before coding
```

## Status

Internal preview on production infrastructure — auth, persistent conversations, the generated persona library, smart search, and monitoring are live for Fifth Wall accounts. The current build target is the Phase 1 exit: reproducing the Site 47-A demo live and unscripted (see the [build checklist](#build-checklist)). All simulation outputs shown are illustrative and disclosed as synthetic.
