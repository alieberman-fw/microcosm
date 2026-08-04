/**
 * Poll-distribution display math (field-report batch 2, C1): rounding each
 * option independently made 40/30/29/2 = 101% in the field. Largest-remainder
 * rounding — floor every share, then hand the leftover points to the largest
 * fractional remainders — makes the displayed percentages sum to EXACTLY 100
 * whenever anything was counted. One implementation for the run card, the
 * report slider/table, and the SIMPLIFY crowd section.
 */

export interface DistShare {
  key: string;
  count: number;
  pct: number;
}

export function distShares(dist: Record<string, number>, order: string[]): DistShare[] {
  const counts = order.map((key) => ({ key, count: Math.max(0, dist[key] ?? 0) }));
  const total = counts.reduce((s, x) => s + x.count, 0);
  if (total === 0) return counts.map((x) => ({ ...x, pct: 0 }));
  const exact = counts.map((x) => (x.count / total) * 100);
  const floors = exact.map(Math.floor);
  let leftover = 100 - floors.reduce((s, x) => s + x, 0);
  // hand leftover points to the largest remainders; ties break to the earlier
  // option so the result is deterministic
  const byRemainder = exact
    .map((v, i) => ({ i, rem: v - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const pcts = [...floors];
  for (const { i } of byRemainder) {
    if (leftover <= 0) break;
    pcts[i] += 1;
    leftover -= 1;
  }
  return counts.map((x, i) => ({ ...x, pct: pcts[i] }));
}
