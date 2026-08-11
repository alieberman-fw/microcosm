import { describe, expect, it } from "vitest";
import { dedupeCites } from "@/lib/run";

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
