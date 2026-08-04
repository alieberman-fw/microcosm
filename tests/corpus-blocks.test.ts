/**
 * PR-A — the shared corpus-block builder. The field bug: "describe the home
 * in 4.jpg" failed because image blocks were attached ANONYMOUSLY — no name.
 * Every image now carries a label block with its filename and upload ordinal,
 * so "4.jpg" and "the second uploaded image" both resolve.
 */

import { describe, expect, it } from "vitest";
import { buildCorpusBlocks, corpusQaSystem, imageOrdinalsSafe } from "@/lib/corpus";

describe("buildCorpusBlocks", () => {
  it("digit-named images get filename-ONLY labels (field report 3: 'IMAGE 1' vs '1.jpg' collided)", () => {
    const blocks = buildCorpusBlocks([
      { name: "1.jpg", mime: "image/jpeg", file_id: "f1" },
      { name: "survey.pdf", mime: "application/pdf", file_id: "f2" },
      { name: "4.jpg", mime: "image/jpeg", file_id: "f3" },
    ]);
    const labels = blocks.filter((b) => b.type === "text").map((b) => String(b.text));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('UPLOADED IMAGE: "1.jpg"');
    expect(labels[0]).not.toMatch(/IMAGE \d+ OF/);
    expect(labels[1]).toContain('UPLOADED IMAGE: "4.jpg"');
    // the label sits IMMEDIATELY before its image block
    const idx = blocks.findIndex((b) => b.type === "text" && String(b.text).includes("4.jpg"));
    expect((blocks[idx + 1] as { type: string }).type).toBe("image");
  });

  it("digit-free image names keep the ordinal labels (no collision possible)", () => {
    const blocks = buildCorpusBlocks([
      { name: "green.png", mime: "image/png", file_id: "f1" },
      { name: "red.png", mime: "image/png", file_id: "f2" },
    ]);
    const labels = blocks.filter((b) => b.type === "text").map((b) => String(b.text));
    expect(labels[0]).toContain('UPLOADED IMAGE 1 OF 2: "green.png"');
    expect(labels[1]).toContain('UPLOADED IMAGE 2 OF 2: "red.png"');
    expect(imageOrdinalsSafe(["green.png", "red.png"])).toBe(true);
    expect(imageOrdinalsSafe(["3.webp", "front.jpg"])).toBe(false);
  });

  it("documents keep their titled, citation-enabled block; text fallback too", () => {
    const blocks = buildCorpusBlocks([
      { name: "OM.pdf", mime: "application/pdf", file_id: "f1" },
      { name: "notes.txt", mime: "text/plain", text: "rent roll says $2.05/SF" },
    ]);
    const docs = blocks.filter((b) => b.type === "document") as { title?: string; citations?: { enabled: boolean } }[];
    expect(docs.map((d) => d.title)).toEqual(["OM.pdf", "notes.txt"]);
    expect(docs.every((d) => d.citations?.enabled)).toBe(true);
  });

  it("an image without a file id is dropped, never emitted blank", () => {
    const blocks = buildCorpusBlocks([{ name: "broken.png", mime: "image/png" }]);
    expect(blocks).toHaveLength(0);
  });
});

describe("corpusQaSystem (the images-only refusal fix)", () => {
  const sys = corpusQaSystem("Which of these three listing photos should lead the listing?");

  it("treats every upload as evidence — images included, refusal forbidden", () => {
    expect(sys).toContain("ALL of it is first-class evidence");
    expect(sys).toContain("Never refuse because the corpus lacks text documents");
  });

  it("images cite by filename, not by document citation", () => {
    expect(sys).toContain("the filename reference IS the citation");
  });

  it("understands @filename, quoted, and bare file references", () => {
    expect(sys).toContain(`"@filename", a quoted filename, or a bare filename`);
  });

  it("answers the question asked — the brief is background, not the question", () => {
    expect(sys).toContain("BACKGROUND context only");
    expect(sys).toContain("Do not substitute the research problem for the question");
  });

  it("clamps a runaway problem statement", () => {
    expect(corpusQaSystem("x".repeat(2000)).length).toBeLessThan(2200);
  });
});
