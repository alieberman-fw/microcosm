import { describe, expect, it } from "vitest";
import { DEFAULT_ORB_INK, hexToRgb, remapInk, themeIsDark } from "@/lib/orb-ink";

const ACC = { r: 55, g: 217, b: 138 };

describe("themeIsDark", () => {
  it("dark + gray take light ink; fog + light take dark ink", () => {
    expect(themeIsDark("dark")).toBe(true);
    expect(themeIsDark("gray")).toBe(true);
    expect(themeIsDark(undefined)).toBe(true); // boot default is dark
    expect(themeIsDark("fog")).toBe(false);
    expect(themeIsDark("light")).toBe(false);
  });
});

describe("hexToRgb", () => {
  it("parses tokens and falls back on junk", () => {
    expect(hexToRgb("#37d98a", ACC)).toEqual({ r: 55, g: 217, b: 138 });
    expect(hexToRgb(" #0d9d63 ", ACC)).toEqual({ r: 13, g: 157, b: 99 });
    expect(hexToRgb("rgba(1,2,3,.5)", ACC)).toEqual(ACC);
    expect(hexToRgb("", ACC)).toEqual(ACC);
  });
});

describe("remapInk", () => {
  it("maps full-strength dark-theme ink to full accent alpha", () => {
    expect(remapInk("rgba(255,255,255,0.8)", true, ACC)).toBe("rgba(55,217,138,0.800)");
  });

  it("ink strength scales alpha — mid-gray keeps the painters' depth cues", () => {
    expect(remapInk("rgba(128,128,128,1)", true, ACC)).toBe("rgba(55,217,138,0.502)");
  });

  it("light themes invert strength (dark ink = strong)", () => {
    expect(remapInk("rgba(0,0,0,0.9)", false, ACC)).toBe("rgba(55,217,138,0.900)");
    expect(remapInk("rgba(255,255,255,0.9)", false, ACC)).toBe("rgba(55,217,138,0.000)");
  });

  it("non-grayscale styles pass through untouched", () => {
    expect(remapInk("rgba(10,20,30,0.5)", true, ACC)).toBe("rgba(10,20,30,0.5)");
    expect(remapInk("#ff0000", true, ACC)).toBe("#ff0000");
    expect(remapInk("blue", true, ACC)).toBe("blue");
  });
});

describe("defaults", () => {
  it("accent is the default ink (Adam's call)", () => {
    expect(DEFAULT_ORB_INK).toBe("accent");
  });
});
