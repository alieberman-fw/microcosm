import { describe, expect, it } from "vitest";
import { CAST_MEMBER_CAPS, normalizePackPlan, normalizeTopupMembers, packDraftSystem, packPlanSystem, packTopupSystem } from "@/lib/packs-cast";

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

describe("the count contract (asked for 10, got 9 — field report)", () => {
  it("target comes from target_count even when the plan came up short", () => {
    const plan = normalizePackPlan({
      name: "Ten leads", kind: "panel", target_count: 10,
      members: Array.from({ length: 9 }, (_, i) => member(`Investor ${i}`)),
    });
    expect(plan?.members).toHaveLength(9); // what the plan produced…
    expect(plan?.target).toBe(10);         // …vs what the route must reach
    expect(plan?.clamped).toBe(false);
  });

  it("target clamps to the kind cap and flags over-asks", () => {
    const plan = normalizePackPlan({ name: "x", kind: "panel", target_count: 25, members: [member("A")] });
    expect(plan?.target).toBe(CAST_MEMBER_CAPS.panel);
    expect(plan?.requested).toBe(25);
    expect(plan?.clamped).toBe(true);
  });

  it("junk target_count falls back to the member count", () => {
    const plan = normalizePackPlan({ name: "x", target_count: "banana", members: [member("A"), member("B")] });
    expect(plan?.target).toBe(2);
  });

  it("normalizeTopupMembers continues the key sequence and tolerates junk", () => {
    const more = normalizeTopupMembers([member("Solar Farm Investor"), { role: 7 }], "panel", 9);
    expect(more).toHaveLength(2);
    expect(more[0].key).toBe("solar-farm-investor-10");
    expect(more[1].role).toBe("7");
    expect(normalizeTopupMembers("junk", "crowd", 0)).toEqual([]);
  });

  it("topup system demands the exact missing count and forbids duplicates", () => {
    const s = packTopupSystem(["REIT analyst", "LP allocator"], 3);
    expect(s).toContain("EXACTLY 3 ADDITIONAL");
    expect(s).toContain("REIT analyst; LP allocator");
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

describe("packs field report — the plan honors the role class and the market", () => {
  it("packPlanSystem carries the role-class fidelity and context-travel rules", () => {
    const sys = packPlanSystem();
    expect(sys).toContain("ROLE-CLASS FIDELITY");
    expect(sys).toContain("EVERY member IS that role class");
    expect(sys).toContain("CONTEXT TRAVELS IN EVERY MEMBER");
  });
});
