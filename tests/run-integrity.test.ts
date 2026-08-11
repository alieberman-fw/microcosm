import { describe, expect, it } from "vitest";
import { dedupeCites, modeFitFlags } from "@/lib/run";
import { stripThinking } from "@/lib/engine";

/** Field report: a post rendered "# 02-RENT-COMP-SURVEY.TXT" three times —
 *  the model cites the same document once per claim; chips show sources. */

describe("dedupeCites — one chip per source", () => {
  it("collapses repeat citations of the same document, keeping the first quote", () => {
    const out = dedupeCites([
      { title: "02-rent-comp-survey.txt", quote: "first claim" },
      { title: "02-RENT-COMP-SURVEY.TXT", quote: "second claim" },
      { title: "02-rent-comp-survey.txt", quote: "third claim" },
      { title: "01-scheme-comparison.txt", quote: "other doc" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].quote).toBe("first claim");
    expect(out[1].title).toBe("01-scheme-comparison.txt");
  });

  it("dedupes web sources by url, not display title", () => {
    const out = dedupeCites([
      { title: "SRP queue update", url: "https://example.com/a", quote: "" },
      { title: "SRP queue update (2)", url: "https://example.com/a", quote: "" },
      { title: "SRP queue update", url: "https://example.com/b", quote: "" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("drops empty-title junk and preserves order", () => {
    const out = dedupeCites([
      { title: "  ", quote: "" },
      { title: "B.pdf", quote: "" },
      { title: "A.pdf", quote: "" },
    ]);
    expect(out.map((c) => c.title)).toEqual(["B.pdf", "A.pdf"]);
  });
});

/** Field report: a Tribunal post opened "<thinking> This is a roleplay as
 *  Grigor Petrosyan…" — literal reasoning leaked into the forum feed. */
describe("stripThinking — leaked reasoning never reaches the feed", () => {
  it("an unclosed leading <thinking> tag drops everything (→ retry/skip path)", () => {
    expect(stripThinking("<thinking> This is a roleplay as Grigor Petrosyan, a cost estimator…")).toBe("");
  });

  it("a closed block is removed and the real post survives", () => {
    expect(stripThinking("<thinking>plan the argument</thinking>Floor plate depth is the obstacle."))
      .toBe("Floor plate depth is the obstacle.");
  });

  it("text before an unclosed tag survives", () => {
    expect(stripThinking("The DSCR math holds. <think>now I should also…")).toBe("The DSCR math holds.");
  });

  it("variant tags and casing are covered; clean text is untouched", () => {
    expect(stripThinking("<THINK>x</THINK><reasoning>y</reasoning>Verdict: convert now.")).toBe("Verdict: convert now.");
    const clean = "A post that mentions thinking about comps but has no tags.";
    expect(stripThinking(clean)).toBe(clean);
  });
});

/** Field report: director-recommended Tribunal warned "sides split 10 vs 0"
 *  — the flag now judges the engine's ACTUAL benches when sides exist. */
describe("modeFitFlags — Tribunal judges real benches", () => {
  const base = { mode: "Tribunal", leads: 10, expertSide: 10, residentSide: 0, crowd: 40 };
  it("kind-lopsided cast WITH genuine benches passes clean", () => {
    expect(modeFitFlags({ ...base, benchPro: 5, benchCon: 5 })).toEqual([]);
  });
  it("thin explicit bench still warns", () => {
    const flags = modeFitFlags({ ...base, benchPro: 9, benchCon: 1 });
    expect(flags.some((f) => f.text.includes("SIDES SPLIT 9 vs 1"))).toBe(true);
  });
  it("legacy casts (no sides) keep the kind-based warning", () => {
    const flags = modeFitFlags(base);
    expect(flags.some((f) => f.text.includes("SIDES SPLIT 10 vs 0"))).toBe(true);
  });
});
