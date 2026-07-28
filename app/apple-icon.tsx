import { ImageResponse } from "next/og";

/**
 * Apple touch icon (home-screen / favorites) — same brand mark, opaque
 * white tile per Apple's guidance, larger padding for the rounded mask.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <svg width="132" height="132" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="#0a0b0c" strokeOpacity=".35" strokeWidth="1.4" strokeDasharray="66 22" strokeLinecap="round" transform="rotate(-50 16 16)" />
          <path d="M9.5 21.5 V11.5 L16 18.5 L22.5 11.5 V21.5" stroke="#0a0b0c" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="16" cy="18.5" r="2" fill="#0d9d63" />
        </svg>
      </div>
    ),
    size,
  );
}
