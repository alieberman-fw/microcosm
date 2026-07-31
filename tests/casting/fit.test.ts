/**
 * The casting fit gate's lexical bypass (field report, 2026-07-31): a
 * Location Intelligence / Foot-Traffic Analyst took a "Retail Leasing Broker
 * (Grocery/Fitness)" seat because overlapScore() counted her tagline words
 * ("retail", "broker", "leases") — the same words FTS surfaced her on — so
 * the Haiku fit judge never ran. The bypass is now roleOverlap(): seat title
 * vs the persona's OWN title, nothing else.
 */

import { describe, expect, it } from "vitest";
import { overlapScore, roleOverlap, seatRoleDiffers } from "@/lib/casting";
import type { PersonaSpec } from "@/lib/personas";

const valentina: PersonaSpec = {
  name: "Valentina J.", initials: "VJ", kind: "expert",
  role: "Location Intelligence / Foot-Traffic Analyst",
  tagline: "reads mobile ping data like a retail broker reads leases · doesn't trust device counts alone",
  backstory: "Retail site selection for a grocery chain, then location intelligence.",
  stances: [], skills: ["mobile device panel analysis", "trade-area capture modeling"],
};

describe("roleOverlap (the fit-gate bypass)", () => {
  it("the Valentina case: zero role overlap — the judge must run", () => {
    expect(roleOverlap("Retail Leasing Broker (Grocery/Fitness)", valentina.role)).toBe(0);
  });

  it("regression pin: the OLD bypass (overlapScore on tagline/skills) would have let her through free", () => {
    expect(overlapScore("Retail Leasing Broker (Grocery/Fitness) grocery anchor leasing", valentina)).toBeGreaterThanOrEqual(2);
  });

  it("a near-fit shares one title word — still faces the judge", () => {
    expect(roleOverlap("Multifamily Market Analyst", "Rent Comp Analyst")).toBe(1);
  });

  it("a persona whose own title names the seat skips the judge", () => {
    expect(roleOverlap("Land Use / Zoning Attorney", "Land Use / Zoning Attorney")).toBeGreaterThanOrEqual(2);
    expect(roleOverlap("Construction Lender / Debt Advisor", "Construction Lender")).toBeGreaterThanOrEqual(2);
  });

  it("short filler words never count", () => {
    expect(roleOverlap("VP of Ops", "Head of Ops")).toBe(0); // "of" too short, "ops" is 3 chars
  });
});

describe("seatRoleDiffers (the UI bridge)", () => {
  it("true when the seat title and the persona's own title genuinely differ", () => {
    expect(seatRoleDiffers({ role: valentina.role, seat: { role: "Retail Leasing Broker (Grocery/Fitness)" } })).toBe(true);
  });

  it("false for identical titles regardless of case and whitespace", () => {
    expect(seatRoleDiffers({ role: "Zoning Attorney", seat: { role: " zoning attorney " } })).toBe(false);
  });

  it("false when there is no seat (library browsing) or no role", () => {
    expect(seatRoleDiffers({ role: "Zoning Attorney" })).toBe(false);
    expect(seatRoleDiffers({ seat: { role: "Zoning Attorney" } })).toBe(false);
  });
});
