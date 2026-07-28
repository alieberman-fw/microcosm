# Config — Buckeye Logistics Portfolio (Jury)

## Corpus

Upload all three files — note `02-rent-roll.csv` is a real CSV, the corpus
handles it natively. TEST THE CORPUS:
`Which tenants expire within 24 months and what share of income do they represent?`

## Casting

- Composition: **EXPERTS ONLY**.
- Expect 10–12 jurors with different lenses: acquisitions, industrial leasing
  broker, asset management, capex/engineering, debt capital markets, market
  economist, 1031/private-buyer specialist, cold-eyed portfolio manager,
  adversarial seat. More jurors = better tally signal (the fit flag says so).
- Re-cast guidance if needed: `make it a true jury — twelve independent
  scorers, each with a distinct reason to say no`
- Population totals: **50 experts · 0 residents** (small expert crowd for
  polls/interjections; the verdict math only uses the jurors).

## Run configuration

| Control | Setting | Why |
|---|---|---|
| Mode | **Jury** | Independent scored verdicts → tally → hold-or-move layers |
| Rounds | **4** | Blind round + up to three deliberation layers |
| Density | **LIVELY** | Interjections thread under verdicts; verdict structure untouched |
| Stop when | **POSITIONS STABILIZE** | The showcase: it stops the round after no juror moves ≥1 point |
| Temperature | BALANCED | |
| Tier | **STANDARD** | |
| Verifier | **ON** | Teaser's "institutional-quality roofs" vs. the PCA |
| Report length | **STANDARD** | |

## Demo beats

- **Round 1 is BLIND**: every verdict card opens "SCORE: n/10" written with
  zero visibility into the other jurors — the spread is the honest prior.
- **THE TALLY**: pure arithmetic posts after each round — mean, FOR (≥6),
  AGAINST (≤4), fence, range, and "N JURORS MOVED ≥1 POINT". No model call;
  point that out.
- **Planted contradiction**: the teaser says "roofs professionally maintained,
  institutional quality"; the PCA prices $2.84M of roof and parking capex
  inside 36 months (≈$7.17/SF on the basis). Watch a juror move a full point
  on it — the tally names the movement.
- **Stability stop**: if scores freeze, the run ends with "positions
  stabilized" BEFORE the round cap — the honest-stop story in one line.
- **Take the Floor**:
  - `@<debt seat> — at what price does this clear a 1.25x DSCR at today's coupon? Give the number.`
  - `The rollover bulls and bears are both citing the same rent roll — someone reconcile the mark-to-market math on the record.`
- **Report**: the verdict chip should commit (pursue / pass / renegotiate-to-$X),
  dimension scores echo the jury spread, and the tally history reads as the
  deliberation analytics.
