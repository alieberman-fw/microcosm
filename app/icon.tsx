import { ImageResponse } from "next/og";

/**
 * The browser-tab favicon — the exact brand mark from components/Nav.tsx
 * (open arc · M · green vertex dot) on a white disc so it reads on light
 * AND dark tab bars in every browser (PNG — Safari ignores SVG favicons).
 * Next's file convention wires the <link rel="icon"> automatically.
 */

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 62, height: 62, borderRadius: 9999, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* the Logo paths, verbatim (components/Nav.tsx) — tokens: ink #0a0b0c, accent (light) #0d9d63 */}
          <svg width="52" height="52" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#0a0b0c" strokeOpacity=".35" strokeWidth="1.6" strokeDasharray="66 22" strokeLinecap="round" transform="rotate(-50 16 16)" />
            <path d="M9.5 21.5 V11.5 L16 18.5 L22.5 11.5 V21.5" stroke="#0a0b0c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="16" cy="18.5" r="2.4" fill="#0d9d63" />
          </svg>
        </div>
      </div>
    ),
    size,
  );
}
