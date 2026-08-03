/**
 * The synthesis ticker (PR-B, field-report item 4): the report draft streams
 * schema-shaped JSON, so the buffer itself tells the user where the director
 * is. These pin the milestone detection, the findings counter, and the
 * fallbacks — a wrong ticker is worse than no ticker.
 */

import { describe, expect, it } from "vitest";
import { synthTicker } from "@/lib/synth-progress";

describe("synthTicker", () => {
  it("returns null until the first known key appears (the route keeps its generic note)", () => {
    expect(synthTicker("")).toBeNull();
    expect(synthTicker('{"unknown_key": {')).toBeNull();
  });

  it("names the section being written, with the previous milestone checked off", () => {
    const buf = '{"verdict": {"label": "GO"}, "bottom_line": {"answer": "Buy it."}, "executive_summary": "The panel conv';
    const tick = synthTicker(buf)!;
    expect(tick).toContain("✓ BOTTOM LINE");
    expect(tick).toContain("WRITING SUMMARY");
    expect(tick).toContain("WORDS");
  });

  it("counts findings as they stream — the section being written, out of the expected total", () => {
    const buf =
      '{"verdict": {}, "executive_summary": "x", "dimension_scores": [], "sections": [' +
      '{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}, {"question": "Q3", "an';
    const tick = synthTicker(buf, { expectedSections: 6 })!;
    expect(tick).toContain("✓ SCORES");
    expect(tick).toContain("WRITING FINDINGS 3/6");
  });

  it("caps the findings counter at the expected total and works without one", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `{"question": "Q${i}"}`).join(", ");
    expect(synthTicker(`{"sections": [${nine}`, { expectedSections: 6 })).toContain("WRITING FINDINGS 6/6");
    expect(synthTicker(`{"sections": [${nine}`)).toContain("WRITING FINDINGS 9");
  });

  it("a sections key with no items yet reads as writing the first", () => {
    expect(synthTicker('{"sections": [', { expectedSections: 4 })).toContain("WRITING FINDINGS 1/4");
  });

  it("formats elapsed time as m:ss and skips it under a second", () => {
    expect(synthTicker('{"verdict": {', { elapsedMs: 67_000 })).toContain("1:07");
    expect(synthTicker('{"verdict": {', { elapsedMs: 400 })).not.toMatch(/\d:\d\d/);
  });

  it("late keys read as the current milestone (tripwires, media)", () => {
    const buf = '{"verdict": {}, "risks": [], "dissents": [], "tripwires": ["x"], "media": [{"file": "green.png"';
    const tick = synthTicker(buf)!;
    expect(tick).toContain("✓ TRIPWIRES");
    expect(tick).toContain("WRITING KEY MATERIALS");
  });
});
