"use client";

/**
 * Unread-reports badge (field fix) — the (n) circle on the Reports nav item:
 * how many reports exist that this user hasn't OPENED. "Seen" is a local
 * per-device set (localStorage) that ReportView stamps on mount; the id
 * list is org-scoped from /api/reports/ids. Polls softly (45s + window
 * focus) so a run finishing while you're elsewhere in the app pops the
 * badge without a reload, and the "mc-reports-seen" event clears it the
 * moment a report is opened in this tab.
 */

import { CSSProperties, useCallback, useEffect, useState } from "react";

export const SEEN_KEY = "mc-seen-reports";

export function seenReports(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** ReportView calls this on mount — stamp + notify every badge in this tab */
export function markReportSeen(id: string) {
  try {
    const seen = seenReports();
    if (seen.has(id)) return;
    seen.add(id);
    // cap the stamp list — old ids age out once they'd never be unread anyway
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
    window.dispatchEvent(new Event("mc-reports-seen"));
  } catch { /* private mode — the badge just stays session-approximate */ }
}

export default function ReportsBadge({ collapsed }: { collapsed: boolean }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/ids");
      if (!res.ok) return;
      const { ids } = (await res.json()) as { ids: string[] };
      const seen = seenReports();
      setUnread(ids.filter((id) => !seen.has(id)).length);
    } catch { /* transient — the next poll lands */ }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 45_000);
    const onSeen = () => void refresh();
    window.addEventListener("mc-reports-seen", onSeen);
    window.addEventListener("focus", onSeen);
    return () => { clearInterval(t); window.removeEventListener("mc-reports-seen", onSeen); window.removeEventListener("focus", onSeen); };
  }, [refresh]);

  if (unread === 0) return null;

  const badge: CSSProperties = {
    fontFamily: "var(--font-mono), monospace", fontSize: 9, fontWeight: 500,
    minWidth: 16, height: 16, padding: "0 4px", borderRadius: 100, boxSizing: "border-box",
    background: "var(--acc)", color: "var(--acc-c)",
    display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
  };
  // collapsed rail: a corner dot on the icon; expanded: the (n) pill after the label
  return collapsed
    ? <span style={{ ...badge, position: "absolute", top: 4, right: 10 }}>{unread > 9 ? "9+" : unread}</span>
    : <span style={{ ...badge, marginLeft: "auto" }}>{unread > 99 ? "99+" : unread}</span>;
}
