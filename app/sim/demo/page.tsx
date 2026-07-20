"use client";

import { CSSProperties, useMemo } from "react";
import Nav from "@/components/Nav";
import RunScreen from "@/components/run/RunScreen";
import { createReplayStream } from "@/lib/replay";
import { SITE47A } from "@/lib/fixtures/site47a";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export default function DemoSim() {
  const stream = useMemo(() => createReplayStream(), []);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "104px 40px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--acc)" }}>
              GOLDEN FIXTURE · SCRIPTED REPLAY THROUGH THE REAL RUN SCREEN
            </div>
            <h1 style={{ margin: "10px 0 0", fontSize: "clamp(20px,2.4vw,28px)", fontWeight: 600, letterSpacing: "-.02em", maxWidth: 760, lineHeight: 1.3 }}>
              {SITE47A.question}
            </h1>
          </div>
          <span style={{ ...mono, fontSize: 10.5, color: "var(--t7)" }}>{SITE47A.meta}</span>
        </div>
        <RunScreen stream={stream} />
        <p style={{ ...mono, margin: "22px 0 0", fontSize: 10.5, lineHeight: 1.7, color: "var(--t7)" }}>
          THIS PAGE REPLAYS THE DEMO&apos;S 46 SCRIPTED EVENTS THROUGH THE PRODUCTION RUN COMPONENTS (CLAUDE.MD §12). WHEN THE ENGINE LANDS, THE SAME SCREEN CONSUMES LIVE EVENTS FROM SUPABASE REALTIME — ZERO UI CHANGES.
        </p>
      </main>
    </>
  );
}
