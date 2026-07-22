"use client";

/**
 * Dashboard simulation cards with a hover ⋮ menu (same pattern as custom
 * persona cards): Edit brief → the workspace; Delete → two-step confirm →
 * DELETE /api/simulations/[id] (documents, chunks, storage, Files API
 * objects, cast — everything goes).
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface SimCardRow {
  id: string;
  status: string;
  created_at: string;
  problem: string;
  questionCount: number;
  docCount: number;
  seatCount: number;
}

export default function SimCards({ initialSims }: { initialSims: SimCardRow[] }) {
  const router = useRouter();
  const [sims, setSims] = useState(initialSims);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null);
        setConfirmFor(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const remove = async (id: string) => {
    setDeleting(id);
    const res = await fetch(`/api/simulations/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSims((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    }
    setDeleting(null);
    setMenuFor(null);
    setConfirmFor(null);
  };

  return (
    <div className="grid3" style={{ marginTop: 36 }}>
      {sims.map((s) => {
        const meta = [
          s.questionCount ? `${s.questionCount} QUESTIONS` : null,
          s.docCount ? `${s.docCount} DOC${s.docCount > 1 ? "S" : ""}` : null,
          s.seatCount ? `${s.seatCount} LEADS` : null,
        ].filter(Boolean).join(" · ") || "BRIEF ONLY";
        const menuOpen = menuFor === s.id;
        return (
          <div key={s.id} className="card simCard" style={{ position: "relative", opacity: deleting === s.id ? 0.4 : 1, transition: "opacity .2s" }}>
            <Link href={`/sim/${s.id}`} style={{ display: "block", padding: "26px 28px" }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)", paddingRight: 22 }}>
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
                <span style={{ color: s.status === "done" ? "var(--acc)" : "var(--t5)" }}>{s.status.toUpperCase()}</span>
              </div>
              <h3 style={{ margin: "14px 0 0", fontSize: 16.5, fontWeight: 600, lineHeight: 1.35, color: "var(--t1)" }}>
                {s.problem}
              </h3>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 14 }}>{meta}</div>
            </Link>

            {/* hover ⋮ */}
            <button
              className="rowActions"
              onClick={(e) => { e.preventDefault(); setMenuFor(menuOpen ? null : s.id); setConfirmFor(null); }}
              aria-label="Simulation actions"
              style={{
                position: "absolute", top: 14, right: 12, width: 26, height: 26, borderRadius: 8,
                background: menuOpen ? "var(--sf2)" : "transparent", border: "none", color: "var(--t5)",
                cursor: "pointer", fontSize: 15, lineHeight: 1, letterSpacing: 1,
                ...(menuOpen ? { opacity: 1 } : {}),
              }}
            >
              ⋮
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                style={{
                  position: "absolute", top: 42, right: 12, zIndex: 40, width: 180,
                  background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 6,
                  boxShadow: "0 10px 28px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both",
                }}
              >
                <Link
                  href={`/sim/${s.id}`}
                  style={{ display: "block", padding: "9px 12px", fontSize: 12.5, color: "var(--t2)", borderRadius: 8 }}
                >
                  Edit brief & setup
                </Link>
                <button
                  onClick={() => (confirmFor === s.id ? void remove(s.id) : setConfirmFor(s.id))}
                  style={{
                    width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 12.5,
                    background: "none", border: "none", borderRadius: 8, cursor: "pointer",
                    color: "var(--warn)", fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: confirmFor === s.id ? 600 : 400,
                  }}
                >
                  {confirmFor === s.id ? "Really delete? This removes everything" : "Delete simulation"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <Link
        href="/sim/new"
        className="card"
        style={{ padding: "26px 28px", border: "1px dashed var(--ln6)", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", gap: 8 }}
      >
        <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--acc)" }}>+ NEW SIMULATION</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
          State the problem, attach or write the diligence, and cast the room.
        </p>
      </Link>

    </div>
  );
}
