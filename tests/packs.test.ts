import { describe, expect, it } from "vitest";
import {
  MAX_PACK_DESC, MAX_PACK_NAME, PACK_CAPS,
  clipPackDescription, clipPackName, normalizePackIds, parsePackKind,
} from "@/lib/packs";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parsePackKind", () => {
  it("accepts only the two kinds", () => {
    expect(parsePackKind("panel")).toBe("panel");
    expect(parsePackKind("crowd")).toBe("crowd");
    expect(parsePackKind("PANEL")).toBeNull();
    expect(parsePackKind("")).toBeNull();
    expect(parsePackKind(undefined)).toBeNull();
    expect(parsePackKind(3)).toBeNull();
  });
});

describe("clipPackName / clipPackDescription", () => {
  it("trims, collapses whitespace, and clips the name", () => {
    expect(clipPackName("  Phoenix   DC  panel  ")).toBe("Phoenix DC panel");
    expect(clipPackName("x".repeat(200)).length).toBe(MAX_PACK_NAME);
    expect(clipPackName(undefined)).toBe("");
  });

  it("empty description becomes null", () => {
    expect(clipPackDescription("   ")).toBeNull();
    expect(clipPackDescription(undefined)).toBeNull();
    expect(clipPackDescription("a real description")).toBe("a real description");
    expect(clipPackDescription("y".repeat(500))?.length).toBe(MAX_PACK_DESC);
  });
});

describe("normalizePackIds", () => {
  it("dedupes and keeps order", () => {
    const ids = [uuid(1), uuid(2), uuid(1), uuid(3)];
    expect(normalizePackIds(ids, "panel")).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it("drops non-uuids and junk", () => {
    expect(normalizePackIds(["not-a-uuid", uuid(1), 42, null, "'; drop table--"], "panel")).toEqual([uuid(1)]);
    expect(normalizePackIds("not-an-array", "panel")).toEqual([]);
    expect(normalizePackIds(undefined, "crowd")).toEqual([]);
  });

  it("lowercases mixed-case uuids so dedupe is case-insensitive", () => {
    const upper = uuid(7).toUpperCase();
    expect(normalizePackIds([upper, uuid(7)], "panel")).toEqual([uuid(7)]);
  });

  it("caps panel packs at 20 and crowd packs at 200", () => {
    const many = Array.from({ length: 250 }, (_, i) => uuid(i + 1));
    expect(normalizePackIds(many, "panel")).toHaveLength(PACK_CAPS.panel);
    expect(normalizePackIds(many, "crowd")).toHaveLength(PACK_CAPS.crowd);
    expect(PACK_CAPS.panel).toBe(20);   // mirrors MAX_SEATS
    expect(PACK_CAPS.crowd).toBe(200);  // mirrors the manual-crowd request cap
  });
});
