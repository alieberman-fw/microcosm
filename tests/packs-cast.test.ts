import { describe, expect, it } from "vitest";
import { CAST_MEMBER_CAPS, normalizePackPlan, packDraftSystem, packPlanSystem } from "@/lib/packs-cast";

const member = (role: string, kind = "expert") => ({ role, kind, discipline: "CAPITAL", why: "distinct angle", query: "reit manager" });

describe("normalizePackPlan", () => {
  it("shapes a good plan", () => {
    const plan = normalizePackPlan({
      name: "REIT & AV investors", kind: "panel", description: "Investor bench",
      members: [member("REIT portfolio manager"), member("AV infrastructure VC")],
    });
    expect(plan?.name).toBe("REIT & AV investors");
    expect(plan?.kind).toBe("panel");
    expect(plan?.members).toHaveLength(2);
    expect(plan?.members[0].key).toMatch(/^reit-portfolio-manager-1$/);
    expect(plan?.clamped).toBe(false);
  });

  it("rejects empty/garbage plans", () => {
    expect(normalizePackPlan(null)).toBeNull();
    expect(normalizePackPlan({})).toBeNull();
    expect(normalizePackPlan({ members: [] })).toBeNull();
  });

  it("clamps to the NL casting caps and flags it", () => {
    const many = Array.from({ length: 30 }, (_, i) => member(`Investor ${i}`));
    const plan = normalizePackPlan({ name: "Big team", kind: "panel", members: many });
    expect(plan?.members).toHaveLength(CAST_MEMBER_CAPS.panel);
    expect(plan?.clamped).toBe(true);
    expect(plan?.requested).toBe(30);
    const crowd = normalizePackPlan({ name: "Crowd", kind: "crowd", members: Array.from({ length: 60 }, (_, i) => member(`Renter ${i}`, "consumer")) });
    expect(crowd?.members).toHaveLength(CAST_MEMBER_CAPS.crowd);
  });

  it("honors overrides and defaults member kinds by pack kind", () => {
    const plan = normalizePackPlan(
      { name: "x", kind: "panel", members: [{ role: "Renter", kind: "banana" }] },
      { kindOverride: "crowd", nameOverride: "My crowd" },
    );
    expect(plan?.kind).toBe("crowd");
    expect(plan?.name).toBe("My crowd");
    expect(plan?.members[0].kind).toBe("consumer"); // junk kind → crowd default
  });

  it("never emits adversarial members", () => {
    const plan = normalizePackPlan({ name: "x", members: [{ role: "Skeptic", kind: "adversarial" }] });
    expect(plan?.members[0].kind).toBe("expert");
  });
});

describe("prompt builders", () => {
  it("plan system pins kind when overridden and states the caps", () => {
    expect(packPlanSystem("crowd")).toContain(`kind MUST be "crowd"`);
    expect(packPlanSystem()).toContain(`capped at ${CAST_MEMBER_CAPS.panel} for panel`);
    expect(packPlanSystem()).toContain("No adversarial seats");
  });

  it("draft system demands one strict-JSON persona", () => {
    const s = packDraftSystem();
    expect(s).toContain("ONE synthetic persona");
    expect(s).toContain("never a real person");
  });
});
