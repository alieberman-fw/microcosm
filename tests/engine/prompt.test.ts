/**
 * compilePersonaPrompt is a PURE function and a product contract (§6.1):
 * prompt regressions are product regressions. These tests pin the seat
 * mandate, the forum rules (anti-stock-opener, anti-consensus), the
 * temperature bands, and the trait styling — plus a full snapshot.
 */

import { describe, it, expect } from "vitest";
import { compilePersonaPrompt, stripSelfPrefix } from "@/lib/engine";
import type { FrozenSpec } from "@/lib/casting";

const spec = (over: Partial<FrozenSpec> = {}): FrozenSpec => ({
  name: "Aurelio R.",
  initials: "AR",
  role: "Wine cellar construction specialist",
  tagline: "Refrigerated storage builder",
  kind: "expert",
  backstory: "Two decades building climate-controlled cellars.",
  stances: ["Moisture management decides everything"],
  seat: { role: "Pool construction specialist", why: "closest cost-engineering fit", discipline: "BUILD", adversarial: false, provenance: "library" },
  ...over,
} as FrozenSpec);

const args = { mode: "Agora", problem: "Build the pool?", temperature: "balanced" as const };

describe("compilePersonaPrompt", () => {
  it("seat mandate: a persona seated outside its own role speaks WITH the seat's authority (the Wine-Cellar-as-Pool-Specialist fix)", () => {
    const p = compilePersonaPrompt(spec(), args);
    expect(p).toContain("You are Aurelio R., Pool construction specialist.");
    expect(p).toContain("The panel seated you as its Pool construction specialist — closest cost-engineering fit.");
    expect(p).toContain("not a reason to hedge or hand the question to someone else");
  });

  it("no mandate line when the seat matches the persona's own role", () => {
    const p = compilePersonaPrompt(spec({ seat: { role: "Wine cellar construction specialist", why: "", discipline: "BUILD", adversarial: false, provenance: "library" } }), args);
    expect(p).not.toContain("The panel seated you");
  });

  it("forum rules carry the anti-stock-opener and anti-consensus lines", () => {
    const p = compilePersonaPrompt(spec(), args);
    expect(p).toContain("write ONE post in your own voice, 60–140 words");
    expect(p).toContain("Never open with stock contrarian framing");
    expect(p).toContain("Do NOT rush to consensus");
    expect(p).toContain("never prefix your post with your own name");
  });

  it("temperature bands steer through the prompt (no API temperature param)", () => {
    expect(compilePersonaPrompt(spec(), { ...args, temperature: "conservative" })).toContain("Stay close to what the documents");
    expect(compilePersonaPrompt(spec(), { ...args, temperature: "exploratory" })).toContain("Chase tail risks");
    expect(compilePersonaPrompt(spec(), { ...args, temperature: "balanced" })).not.toMatch(/Stay close|Chase tail/);
  });

  it("traits shape the voice", () => {
    const p = compilePersonaPrompt(spec({ traits: { verbosity: 0.2, risk_tolerance: 0.2, agreeableness: 0.2 } }), args);
    expect(p).toContain("You are terse");
    expect(p).toContain("You price risk conservatively");
    expect(p).toContain("You push back readily");
  });

  it("full prompt snapshot — any change here is a reviewed product change", () => {
    expect(compilePersonaPrompt(spec(), args)).toMatchSnapshot();
  });
});

describe("stripSelfPrefix", () => {
  it("strips bold/plain self-prefixes models love to open with", () => {
    expect(stripSelfPrefix("**Aurelio R.** Pool shells crack at $80K.", "Aurelio R.")).toBe("Pool shells crack at $80K.");
    expect(stripSelfPrefix("Aurelio R.: Pool shells crack.", "Aurelio R.")).toBe("Pool shells crack.");
    expect(stripSelfPrefix("Aurelio R — Pool shells crack.", "Aurelio R.")).toBe("Pool shells crack.");
  });
  it("leaves unprefixed posts (and other people's names) alone", () => {
    expect(stripSelfPrefix("The pool costs $80K, Rosa.", "Aurelio R.")).toBe("The pool costs $80K, Rosa.");
    expect(stripSelfPrefix("Rosa M. is right about the shell.", "Aurelio R.")).toBe("Rosa M. is right about the shell.");
  });
});
