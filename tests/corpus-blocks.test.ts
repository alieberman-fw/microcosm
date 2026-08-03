/**
 * PR-A — the shared corpus-block builder. The field bug: "describe the home
 * in 4.jpg" failed because image blocks were attached ANONYMOUSLY — no name.
 * Every image now carries a label block with its filename and upload ordinal,
 * so "4.jpg" and "the second uploaded image" both resolve.
 */

import { describe, expect, it } from "vitest";
import { buildCorpusBlocks } from "@/lib/corpus";

describe("buildCorpusBlocks", () => {
  it("labels every image with its filename and ordinal (the 4.jpg fix)", () => {
    const blocks = buildCorpusBlocks([
      { name: "1.jpg", mime: "image/jpeg", file_id: "f1" },
      { name: "survey.pdf", mime: "application/pdf", file_id: "f2" },
      { name: "4.jpg", mime: "image/jpeg", file_id: "f3" },
    ]);
    const labels = blocks.filter((b) => b.type === "text").map((b) => String(b.text));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('UPLOADED IMAGE 1 OF 2: "1.jpg"');
    expect(labels[1]).toContain('UPLOADED IMAGE 2 OF 2: "4.jpg"');
    // the label sits IMMEDIATELY before its image block
    const idx = blocks.findIndex((b) => b.type === "text" && String(b.text).includes("4.jpg"));
    expect((blocks[idx + 1] as { type: string }).type).toBe("image");
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
