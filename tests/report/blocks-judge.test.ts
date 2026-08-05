/**
 * 6-PR4 (§6e/§6f) — blocks + the answer-completeness judge: the pure seams.
 */

import { describe, expect, it } from "vitest";
import {
  REPORT_BLOCKS_SCHEMA, REPORT_JSON_SCHEMA, ReportBlock, blocksSpecFor, blocksSynthSystem, judgePatchSystem, judgeSystem,
  mergePatchedBlocks, mergePatchedSections, normalizeBlocks, parseJudgeVerdict, reportSynthSystem,
} from "@/lib/report";

const ENTITIES = ["ghost kitchens", "AV/EV charging", "edge data centers"];

describe("blocksSpecFor — what the contract demands", () => {
  it("artifact contracts become required blocks; lead-shaped contracts don't", () => {
    const s = blocksSpecFor([{ type: "ranked_list" }, { type: "matrix" }, { type: "verdict" }], ENTITIES, ["real estate exists", "players named"])!;
    expect(s).toContain("ranked_list: rank ALL of these");
    expect(s).toContain("ghost kitchens · AV/EV charging · edge data centers");
    expect(s).toContain("matrix: entities");
    expect(s).not.toContain("- verdict"); // lead-shaped contracts never become blocks
  });

  it("null without artifact contracts or without entities", () => {
    expect(blocksSpecFor([{ type: "verdict" }], ENTITIES, [])).toBeNull();
    expect(blocksSpecFor([{ type: "ranked_list" }], [], [])).toBeNull();
    expect(blocksSpecFor(undefined, ENTITIES, [])).toBeNull();
    expect(blocksSpecFor([{ type: "comparison" }], ["only-one"], [])).toBeNull(); // a comparison needs 2+
  });

  it("blocks live in their OWN call + schema — the main grammar stays under budget (the live 400 this fixes)", () => {
    expect(blocksSynthSystem("- ranked_list: rank ALL")).toContain("BLOCKS REQUIRED (from the brief's contract");
    expect(reportSynthSystem("standard")).not.toContain("BLOCKS REQUIRED");
    expect(REPORT_JSON_SCHEMA.required).not.toContain("blocks"); // grammar budget — never re-add
    expect(REPORT_BLOCKS_SCHEMA.required).toContain("blocks");
  });
});

describe("normalizeBlocks", () => {
  it("keeps valid blocks, clips at word boundaries, drops junk", () => {
    const long = "a committed verdict clause that runs well past the two hundred and forty character ceiling ".repeat(4);
    const out = normalizeBlocks([
      { kind: "ranked_list", title: "The ranking", columns: [], rows: [{ label: "#1 · kitchens", cells: [long], note: "why" }] },
      { kind: "pie_chart", title: "nope", columns: [], rows: [{ label: "x", cells: ["y"] }] },
      { kind: "matrix", title: "empty rows", columns: ["a"], rows: [] },
      "garbage",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("ranked_list");
    expect(out[0].rows[0].cells[0].length).toBeLessThanOrEqual(241);
    expect(out[0].rows[0].cells[0].endsWith("…")).toBe(true);
    expect(out[0].rows[0].note).toBe("why");
  });

  it("caps: 4 blocks, 16 rows, 8 cells, 6 cites; rows need labels", () => {
    const mk = (kind: string) => ({ kind, title: kind, columns: [], rows: [{ label: "r", cells: ["c"] }] });
    expect(normalizeBlocks([mk("ranked_list"), mk("matrix"), mk("comparison"), mk("ranked_list"), mk("matrix")])).toHaveLength(4);
    const big = normalizeBlocks([{
      kind: "matrix", title: "m", columns: Array.from({ length: 12 }, (_, i) => `c${i}`),
      rows: Array.from({ length: 20 }, (_, i) => ({ label: `e${i}`, cells: Array.from({ length: 12 }, () => "v"), cites: Array.from({ length: 9 }, (_, j) => j + 1) })),
    }]);
    expect(big[0].columns).toHaveLength(8);
    expect(big[0].rows).toHaveLength(16);
    expect(big[0].rows[0].cells).toHaveLength(8);
    expect(big[0].rows[0].cites).toHaveLength(6);
    expect(normalizeBlocks([{ kind: "ranked_list", title: "t", columns: [], rows: [{ label: "", cells: ["x"] }] }])).toHaveLength(0);
  });
});

describe("parseJudgeVerdict", () => {
  it("clean pass; failures force pass=false even when the model says pass=true", () => {
    expect(parseJudgeVerdict({ pass: true, failures: [] })).toEqual({ pass: true, failures: [] });
    const inconsistent = parseJudgeVerdict({ pass: true, failures: [{ target: "block:ranked_list", problem: "misses 5 of 11", must_fix: "add them" }] })!;
    expect(inconsistent.pass).toBe(false);
    expect(inconsistent.failures).toHaveLength(1);
  });

  it("null on garbage; failures need target+problem; capped at 6", () => {
    expect(parseJudgeVerdict(null)).toBeNull();
    expect(parseJudgeVerdict({ verdict: "fine" })).toBeNull();
    const v = parseJudgeVerdict({
      pass: false,
      failures: [
        { target: "", problem: "no target" },
        { target: "criteria", problem: "" },
        ...Array.from({ length: 8 }, (_, i) => ({ target: `section:q${i}`, problem: `gap ${i}`, must_fix: "fix" })),
      ],
    })!;
    expect(v.failures).toHaveLength(6);
    expect(v.failures[0].target).toBe("section:q0");
  });

  it("the judge and repair prompts state the contract-vs-answers job", () => {
    expect(judgeSystem()).toContain("answered means a committed verdict");
    expect(judgeSystem()).toContain("EVERY enumerated entity");
    expect(judgePatchSystem()).toContain("ONLY the failing pieces");
  });
});

describe("merge patches", () => {
  it("sections replace by question (case/space-insensitive); missing sections append", () => {
    const existing = [
      { question: "Does the real estate exist?", finding: "old" },
      { question: "Who are the players?", finding: "kept" },
    ];
    const merged = mergePatchedSections(existing, [
      { question: "does the real  estate exist?", finding: "REPAIRED" },
      { question: "What is the right expression?", finding: "NEW" },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0].finding).toBe("REPAIRED");
    expect(merged[1].finding).toBe("kept");
    expect(merged[2].finding).toBe("NEW");
  });

  it("blocks replace by kind; new kinds append", () => {
    const rl: ReportBlock = { kind: "ranked_list", title: "old", columns: [], rows: [{ label: "#1 · x", cells: ["v"] }] };
    const merged = mergePatchedBlocks([rl], [
      { kind: "ranked_list", title: "repaired", columns: [], rows: [{ label: "#1 · y", cells: ["w"] }] },
      { kind: "matrix", title: "new", columns: ["c"], rows: [{ label: "e", cells: ["v"] }] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("repaired");
    expect(merged[1].kind).toBe("matrix");
  });
});

describe("6-PR4b — parallel section synthesis (pure seams)", () => {
  it("the director schema is DERIVED: full schema minus sections, nothing else drifts", async () => {
    const { REPORT_DIRECTOR_SCHEMA, REPORT_JSON_SCHEMA: FULL } = await import("@/lib/report");
    const d = REPORT_DIRECTOR_SCHEMA as { required: string[]; properties: Record<string, unknown> };
    const f = FULL as { required: string[]; properties: Record<string, unknown> };
    expect(d.required).not.toContain("sections");
    expect(d.properties.sections).toBeUndefined();
    expect(d.required).toEqual(f.required.filter((k) => k !== "sections"));
    expect(Object.keys(d.properties).sort()).toEqual(Object.keys(f.properties).filter((k) => k !== "sections").sort());
  });

  it("the director prompt provides sections as input; the full prompt still writes them", async () => {
    const { reportSynthSystem: synth, sectionWorkerSystem: worker } = await import("@/lib/report");
    expect(synth("standard", { director: true })).toContain("Do NOT emit a \"sections\" field");
    expect(synth("standard", { director: true })).not.toContain("\"sections\": [{");
    expect(synth("standard")).toContain("\"sections\": [{");
    expect(worker("standard")).toContain("ONE ASSIGNED QUESTION");
    expect(worker("standard")).toContain("RANKING RULE");
    expect(worker("dense")).toContain("DEPTH: DENSE");
  });
});
