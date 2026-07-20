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
  <a href="#how-it-works">How it works</a> ·
  <a href="#the-value">The value</a> ·
  <a href="#the-site">The site</a> ·
  <a href="#running-locally">Run it</a> ·
  <a href="#editing-notes">Editing</a>
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

## How it works

The [live demo](demo.html) walks the full pipeline on a real-shaped case study — *Site 47-A: ±212 acres in Mesa, AZ, $385K/acre unpowered, 300MW data center campus, go/no-go*:

1. **Brief** — state the problem, attach the diligence set (ALTA survey, transmission maps, zoning code, Phase I ESA, broker OM), set the questions to resolve.
2. **Seed** — sample the panel: 48 expert agents across 8 disciplines (grid interconnection, water, fiber, entitlement, capital, land, site selection, plus an adversarial community seed) and 400 resident agents drawn from ACS PUMS for the actual ZIP codes.
3. **Run** — 14 simulated days of deliberation, compressed to ~2 minutes. Watch the agent network fire, threads branch, positions change. Every quantitative claim is constraint-checked against the attached documents.
4. **Read** — a decision-grade synthesis: verdict, dimension scores, findings cited to the transcript, a recommended deal structure, a mitigation-mapped risk register, deliberation analytics, and dissents preserved rather than averaged away.

The demo's verdict — *conditional go: option, don't buy* — is the kind of answer the product exists to produce: not a sentiment score, but a structure.

## The value

**The unit of work it replaces.** Decision-grade feasibility research runs $15–50K and six weeks per question. A Microcosm run is same-day, and the marginal research question becomes nearly free. Pricing follows a barbell the market has already validated:

- **Team tier (~$18K/yr)** — unlimited standard runs, priced below a single consultant study. A no-committee purchase with thousands of potential buyers.
- **Enterprise tier (~$250K/yr)** — the calibrated metro twin, the underwriting API, and the accuracy record. Sales-led, like every six-figure enterprise simulation deal in the category.
- **Public channel (~$120K/engagement)** — intervention studies for cities and pro-housing funders, on procurement rails Replica already proved (MTA, State of Illinois).

**The market.** ~$14B/yr global real estate consulting (market research and due diligence are its two largest segments), inside a $150B+ insights industry and a $198B US real estate services market.

**The moat.** The generative-agent layer is commoditizing — the moat is vertical: a real estate ontology baked into personas and reports, calibration against *actual* sales curves, lease-ups, and hearing outcomes, and embedding in underwriting workflows. The outcome corpus compounds; the agents don't.

**The number.** The [research page](research.html) carries a live, draggable model (bear / base / bull presets): base case ≈ 2,600 paying organizations, $76M year-5 revenue, ~$912M implied enterprise value at a 12× vertical-AI multiple — next to the comps that anchor it (Aaru, EliseAI, Simile, Replica, CoStar) and the capital plan that funds it (~$57M gross across three gated rounds, ~$40M net of money that arrives as revenue and grants rather than dilution).

### Honest limits

Synthetic populations are strong on stated preferences, message tests, directional ranking, and anticipating objections. They are weak in documented ways — sycophancy, compressed tails, WEIRD bias, optimism-skewed preferences — and Microcosm's position is to model the say-do gap explicitly, publish backtests with error bars, and disclose every output as synthetic and directional. Fair-housing review gates any use case near tenant or buyer selection. The simulation informs the decision-maker; it never replaces them.

## The site

A Next.js app (App Router, TypeScript) with one design system (Space Grotesk / JetBrains Mono, dark-first with a persistent light-theme toggle):

| Route | What's on it |
|---|---|
| `/` ([app/page.tsx](app/page.tsx)) | The product landing: hero with background video, plain-English three steps, interactive pipeline, simulation modes, live deliberation scenarios, why-it-works, RE use cases, waitlist |
| `/demo.html` ([public/demo.html](public/demo.html)) | The four-stage interactive demo (brief → seed → deliberation → report) with the full decision-grade report — static, self-contained, and the design golden fixture |
| `/login` ([app/login/page.tsx](app/login/page.tsx)) | Auth entry (private-preview stub until Supabase Auth lands) |

The original static pages (including the research/founder's-memo page) are archived in [`legacy/`](legacy/).

## Running locally

```bash
npm install
npm run dev
# then open http://localhost:3000
```

Working in **Claude Code**? A preview config ships in [`.claude/launch.json`](.claude/launch.json) — the `microcosm-app` server starts on port 3000 straight from the Browser pane.

## Editing notes

- Each page is self-contained: markup in an `<x-dc>` template plus one `<script type="text/x-dc">` component that supplies data and behavior via `renderVals()`. Copy, numbers, and card contents live in plain JS arrays at the bottom of each file — edit there, refresh, done.
- The **16 recruiting cards** on the research page are a placeholder array (`team`) — drop real names and profiles in as they're confirmed; the grid renders whatever the array holds.
- The **valuation model** state (defaults, presets, slider ranges) lives in the research page's component (`state.m` and `pBear`/`pBase`/`pBull`).
- [`support.js`](support.js) is a **generated** design runtime — do not edit it by hand (see its header for the rebuild command).
- Theme preference persists in `localStorage` under `mc-theme`.

## Repo layout

```
├── app/                  # Next.js routes: landing (page.tsx), /login, globals.css
├── components/           # Nav, Hero, Pipeline, Modes, LiveDemo, Access
├── public/
│   ├── demo.html         # interactive live demo (static, golden fixture)
│   ├── support.js        # generated design runtime for the demo (do not edit)
│   └── media/hero-bg.mp4 # landing hero background video
├── docs/                 # persona taxonomy, speaker script
├── legacy/               # archived original static pages
├── assets/               # logo SVGs (dark/light)
├── CLAUDE.md             # the product/tech/design spec — read before coding
└── .claude/launch.json   # local dev server config (port 3000)
```

## Status

Prototype — the landing site, live demo, and research memo are the working proof-of-concept. Next: the validation sprint (operator, founder, capital-desk, and skeptic calls, logged verbatim) and the first metro backtest program. All simulation outputs shown are illustrative and disclosed as synthetic.
