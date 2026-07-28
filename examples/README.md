# Demo examples — one flagship use case per interaction mode

Seven copy-paste-ready real-estate simulations, each built to show a specific
interaction mode at its best. Every example folder contains:

- **`BRIEF.md`** — the problem statement, questions-to-resolve, and success
  criteria, formatted as paste-ready blocks for the brief composer (`/sim/new`).
- **`CONFIG.md`** — casting guidance, the exact run-config settings to pick and
  *why*, demo beats to point at on screen, and Take-the-Floor prompts.
- **`docs/`** — synthetic diligence materials to upload as the corpus
  (`.txt` and `.csv` drag-and-drop directly; the parser accepts
  PDF · text · markdown · CSV · HTML · images). The documents deliberately
  disagree with each other in places — broker optimism vs. third-party data —
  so citations, the adversarial seat, and the verifier have something to catch.

| Mode | Example | The question | Built to show |
|---|---|---|---|
| **Agora** | [`agora/mall-redevelopment`](agora/mall-redevelopment) | Redevelop a dying regional mall into a mixed-use district? | The full open-forum grammar: threads, reply chains, crowd interjections, votes, Take the Floor |
| **Roundtable** | [`roundtable/unit-mix-workshop`](roundtable/unit-mix-workshop) | Which of three unit-mix schemes for a 280-unit project? | Every voice each round + the CROSSFIRE half-round at bustling density |
| **Tribunal** | [`tribunal/rezoning-rehearsal`](tribunal/rezoning-rehearsal) | Will the 380-unit rezoning survive the council hearing? | Two benches, COUNTER volleys, the judge's round-by-round scale, approval-odds framing |
| **Chamber** | [`chamber/parcel-valuation`](chamber/parcel-valuation) | What is a fair price for a 38-acre industrial parcel asking $12.5M? | Blind independent valuations (no anchoring) → peer review → a defended price range — the flagship §2 valuation use case |
| **Jury** | [`jury/acquisition-screen`](jury/acquisition-screen) | Score an off-market industrial portfolio 0–10: does it go to full IC? | Blind round-1 scores, the code-computed TALLY, jurors moving (or holding) with attribution, honest stability stop |
| **Desk** | [`desk/investment-memo`](desk/investment-memo) | Draft the IC memo for a $52.5M build-to-rent acquisition | Director → section drafts → assembled memo; the research choreography feed |
| **Expedition** | [`expedition/market-entry`](expedition/market-entry) | Enter the Salt Lake City industrial-outdoor-storage niche with $75M? | The five-phase research route: questions → research → analysis → alternatives → verify |

## How to run one (≈5 minutes to launch)

1. **New simulation** → paste the PROBLEM STATEMENT from `BRIEF.md`. Add each
   QUESTION TO RESOLVE (paste the framing line — the chip label auto-summarizes)
   and each SUCCESS CRITERION (one per Enter).
2. **Upload the corpus** — drag every file in `docs/` into the workspace.
   Optionally hit TEST THE CORPUS with the suggested question in `CONFIG.md`
   to show cited answers before anyone deliberates.
3. **Cast** — AUTO-CAST and let the director read the brief + corpus (each
   `CONFIG.md` says what composition to expect and what guidance to give if
   you re-cast). Generate the crowd at the suggested totals.
4. **Configure the run** — set the mode and parameters from `CONFIG.md`
   (the mode card should already carry ✦ DIRECTOR'S PICK on most of these).
5. **Launch**, narrate with the demo beats, **Take the Floor** with the
   suggested prompts at the pause, then **synthesize the report**.

## Ground rules

- **Everything here is synthetic.** Addresses, people, companies, and numbers
  are invented for demonstration. No real parcel, deal, or person is described.
- The numeric spine of each example is internally consistent *except* for the
  contradictions called out in each `CONFIG.md` under "demo beats" — those are
  planted for the panel (and the verifier) to find.
- Fair-housing line (CLAUDE.md §1): these simulate markets and decisions —
  never individual tenant or buyer screening.
