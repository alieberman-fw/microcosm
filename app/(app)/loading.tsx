/**
 * Instant navigation shell for every app page (perf field fix: clicking
 * between nav items showed nothing until the server render landed —
 * dynamic pages get no prefetch, so this skeleton is what makes the app
 * FEEL fast). Renders inside the preserved AppShell sidebar immediately;
 * the real page streams in over it. Shimmer grammar from the demo Seed
 * stage (§10).
 */

const shim = {
  borderRadius: 8,
  background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln2) 50%, var(--sf2) 75%)",
  backgroundSize: "400px 100%",
  animation: "shim 1.2s linear infinite",
} as const;

export default function Loading() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div style={{ ...shim, height: 12, width: 120 }} />
      <div style={{ ...shim, height: 34, width: 340, marginTop: 16 }} />
      <div style={{ ...shim, height: 13, width: 480, marginTop: 14 }} />
      <div className="grid3" style={{ marginTop: 34 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...shim, height: 38, width: 38, borderRadius: "50%" }} />
            <div style={{ ...shim, height: 15, width: "72%" }} />
            <div style={{ ...shim, height: 11, width: "88%" }} />
            <div style={{ ...shim, height: 11, width: "56%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
