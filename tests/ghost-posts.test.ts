import { describe, expect, it } from "vitest";
import { clampWords, pickReplyTarget, windowOf } from "@/lib/engine";
import { stripCellMeta } from "@/lib/report";

/** Field report: "[REPLY] Renata O. (): ''" — a ghost post derailed a live
 *  panel for rounds, and long posts published ending mid-clause. */

describe("clampWords — sentence-boundary clamp", () => {
  it("short posts pass through untouched", () => {
    expect(clampWords("Two sentences. Both fine.")).toBe("Two sentences. Both fine.");
  });

  it("over-limit posts end on a sentence boundary, not mid-clause", () => {
    const sentence = "The carrying cost jumps twelve thousand annually and the lender recalculates. ";
    const long = sentence.repeat(40); // ~440 words
    const out = clampWords(long);
    expect(out.endsWith("recalculates.")).toBe(true);
    expect(out.endsWith("…")).toBe(false);
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(220);
  });

  it("one giant run-on sentence still hard-cuts with an ellipsis", () => {
    const runOn = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const out = clampWords(runOn);
    expect(out.endsWith("…")).toBe(true);
    expect(out.split(/\s+/).length).toBe(220);
  });
});

describe("windowOf — ghost rows never reach a prompt", () => {
  const posts = [
    { name: "Marion V.", role: "Tax-Policy Attorney", content: "The parcel structure matters.", tag: "POST" },
    { name: "Renata O.", role: "", content: "", tag: "REPLY" },            // the ghost
    { name: "Todd R.", role: "Brokerage Lead", content: "   ", tag: "REPLY" }, // whitespace ghost
    { name: "Floor", role: "", content: "What about escrow?", tag: "FLOOR" },
  ];

  it("skips empty and whitespace-only posts", () => {
    const w = windowOf(posts);
    expect(w).not.toContain("Renata");
    expect(w).not.toContain("Todd");
    expect(w).toContain("Marion V.");
  });

  it("never renders a bare () for a missing role", () => {
    const w = windowOf(posts);
    expect(w).toContain("[FLOOR] Floor: What about escrow?");
    expect(w).not.toContain("()");
  });
});

describe("pickReplyTarget — ghosts are not reply targets", () => {
  const posts = [
    { seq: 1, round: 1, tag: "POST", agentKey: "a", name: "A", content: "Real argument here.", replyTo: null },
    { seq: 2, round: 1, tag: "REPLY", agentKey: "b", name: "B", content: "", replyTo: 1 }, // ghost / in-flight
  ];
  it("only substantive posts are candidates", () => {
    for (let salt = 0; salt < 6; salt++) {
      const t = pickReplyTarget(posts, 1, salt, undefined, "lively");
      expect(t?.seq).toBe(1);
    }
  });
});

describe("stripCellMeta — 'COMMITTED —' cell prefixes (field report)", () => {
  it("strips the leaked meta-labels", () => {
    expect(stripCellMeta("COMMITTED — the central mechanism")).toBe("the central mechanism");
    expect(stripCellMeta("ANSWERED: splits by leverage tier")).toBe("splits by leverage tier");
    expect(stripCellMeta("DECIDED – hold the parcel")).toBe("hold the parcel");
  });
  it("keeps honest cell verdicts untouched", () => {
    expect(stripCellMeta("YES — 480V in place")).toBe("YES — 480V in place");
    expect(stripCellMeta("UNTESTED — panel never priced it")).toBe("UNTESTED — panel never priced it");
    expect(stripCellMeta("HOLDS — cliff confirmed at $2.1M")).toBe("HOLDS — cliff confirmed at $2.1M");
    expect(stripCellMeta(undefined)).toBe("");
  });
});
