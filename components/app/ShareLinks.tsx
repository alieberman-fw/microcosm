"use client";

/**
 * Report magic links — the management popover (pre-5a feature batch).
 * One panel, two hosts: the report header's SHARE pill (ShareLinksButton)
 * and the reports-tab card ⋯ menu ("Share links…"). Links are named,
 * optionally expiring, revocable, VIEW-ONLY (/r/<token>), and never
 * auto-sent — minting copies the URL to the clipboard and that's it.
 */

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface ShareLink {
  id: string;
  token: string;
  name: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const EXPIRY_PRESETS = [
  { label: "7 DAYS", days: 7 },
  { label: "30 DAYS", days: 30 },
  { label: "90 DAYS", days: 90 },
  { label: "NEVER", days: 0 },
] as const;

function statusOf(l: ShareLink): { label: string; tone: "live" | "dead" } {
  if (l.revoked_at) return { label: "REVOKED", tone: "dead" };
  if (l.expires_at && Date.parse(l.expires_at) < Date.now()) return { label: "EXPIRED", tone: "dead" };
  if (!l.expires_at) return { label: "LIVE · NO EXPIRY", tone: "live" };
  const days = Math.max(1, Math.ceil((Date.parse(l.expires_at) - Date.now()) / 86_400_000));
  return { label: `LIVE · ${days}D LEFT`, tone: "live" };
}

export function ShareLinksPanel({ simId, onClose }: { simId: string; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null); // link id just copied
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/simulations/${simId}/links`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load links");
        setLinks(data.links as ShareLink[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load links");
        setLinks([]);
      }
    })();
  }, [simId]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  const urlOf = (token: string) => `${window.location.origin}/r/${token}`;

  const copy = useCallback(async (l: ShareLink) => {
    try {
      await navigator.clipboard.writeText(urlOf(l.token));
      setCopied(l.id);
      setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 1600);
    } catch { setError("Clipboard unavailable — copy from the address bar after opening"); }
  }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulations/${simId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Shared link", days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the link");
      const link = data.link as ShareLink;
      setLinks((prev) => [link, ...(prev ?? [])]);
      setName("");
      void copy(link); // minting copies — the whole point is handing it out
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (l: ShareLink) => {
    setLinks((prev) => (prev ?? []).map((x) => (x.id === l.id ? { ...x, revoked_at: new Date().toISOString() } : x)));
    await fetch(`/api/links/${l.id}`, { method: "PATCH" });
  };

  const remove = async (l: ShareLink) => {
    setLinks((prev) => (prev ?? []).filter((x) => x.id !== l.id));
    await fetch(`/api/links/${l.id}`, { method: "DELETE" });
  };

  return (
    <div
      ref={ref}
      style={{
        width: 372, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 14,
        padding: 12, boxShadow: "0 12px 32px rgba(0,0,0,.35)", animation: "fadeUp .18s ease both",
      }}
    >
      <div style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--t6)", padding: "2px 6px 10px", borderBottom: "1px solid var(--ln3)" }}>
        MAGIC LINKS — VIEW-ONLY ACCESS TO THIS REPORT · NEVER AUTO-SENT
      </div>

      {/* mint a new link */}
      <div style={{ padding: "10px 6px 12px", borderBottom: "1px solid var(--ln3)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            maxLength={60}
            placeholder="Name this link (“LP committee”, “broker”)…"
            style={{
              flex: 1, minWidth: 0, boxSizing: "border-box", background: "var(--sf)", border: "1px solid var(--ln4)",
              borderRadius: 100, padding: "8px 14px", fontSize: 12, color: "var(--t1)", outline: "none",
              fontFamily: "var(--font-sans), sans-serif",
            }}
          />
          <button
            onClick={() => void create()}
            disabled={busy}
            style={{
              ...mono, flex: "none", fontSize: 9, letterSpacing: ".06em", padding: "8px 14px", borderRadius: 100,
              border: "1px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "MINTING…" : "+ NEW LINK"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
          <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)" }}>EXPIRES</span>
          {EXPIRY_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              style={{
                ...mono, fontSize: 8, letterSpacing: ".05em", padding: "3px 10px", borderRadius: 100, cursor: "pointer",
                border: `1px solid ${days === p.days ? "var(--acc)" : "var(--ln4)"}`,
                background: days === p.days ? "var(--acc-dim)" : "transparent",
                color: days === p.days ? "var(--acc)" : "var(--t6)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* the links that exist */}
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {links === null && <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)", padding: "12px 6px" }}>LOADING…</div>}
        {links !== null && links.length === 0 && (
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t6)", padding: "12px 6px" }}>
            No links yet — mint one above. Anyone with the URL sees this report (view-only), until it expires or you revoke it.
          </div>
        )}
        {(links ?? []).map((l) => {
          const st = statusOf(l);
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 6px", borderBottom: "1px solid var(--ln1)" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: st.tone === "live" ? "var(--t2)" : "var(--t6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.name}
                </span>
                <span style={{ ...mono, display: "block", fontSize: 7.5, letterSpacing: ".06em", color: st.tone === "live" ? "var(--acc)" : "var(--t7)", marginTop: 2 }}>
                  {st.label} · MINTED {new Date(l.created_at).toLocaleDateString()}
                </span>
              </span>
              {st.tone === "live" ? (
                <>
                  <button
                    onClick={() => void copy(l)}
                    style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".05em", padding: "4px 11px", borderRadius: 100, border: `1px solid ${copied === l.id ? "var(--acc)" : "var(--ln5)"}`, background: copied === l.id ? "var(--acc-dim)" : "transparent", color: copied === l.id ? "var(--acc)" : "var(--t4)", cursor: "pointer" }}
                  >
                    {copied === l.id ? "COPIED ✓" : "COPY"}
                  </button>
                  <button
                    onClick={() => void revoke(l)}
                    style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".05em", padding: "4px 11px", borderRadius: 100, border: "1px solid var(--warn)", background: "transparent", color: "var(--warn)", cursor: "pointer" }}
                  >
                    REVOKE
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void remove(l)}
                  title="Remove this dead link from the list"
                  style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".05em", padding: "4px 11px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t6)", cursor: "pointer" }}
                >
                  × REMOVE
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && <div style={{ ...mono, fontSize: 9, color: "var(--warn)", padding: "10px 6px 2px" }}>{error.toUpperCase().slice(0, 90)}</div>}
    </div>
  );
}

/** the report header's SHARE pill — toggles the panel under itself */
export function ShareLinksButton({ simId }: { simId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Share this report — named, expiring, view-only links"
        style={{
          ...mono, fontSize: 9, letterSpacing: ".07em", padding: "5px 14px", borderRadius: 100,
          border: `1px solid ${open ? "var(--acc)" : "var(--ln5)"}`,
          background: open ? "var(--acc-dim)" : "transparent",
          color: open ? "var(--acc)" : "var(--t5)", cursor: "pointer",
        }}
      >
        ⎘ SHARE
      </button>
      {open && (
        <span style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 60 }}>
          <ShareLinksPanel simId={simId} onClose={() => setOpen(false)} />
        </span>
      )}
    </span>
  );
}
