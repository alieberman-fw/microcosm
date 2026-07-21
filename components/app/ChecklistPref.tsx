"use client";

import { CSSProperties, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

/** Settings row: re-enable (or hide) the Home getting-started checklist. */
export default function ChecklistPref({ initiallyHidden }: { initiallyHidden: boolean }) {
  const supabase = createClient();
  const [hidden, setHidden] = useState(initiallyHidden);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    const next = !hidden;
    setHidden(next);
    const { data: { user } } = await supabase!.auth.getUser();
    if (user) await supabase!.from("users").update({ prefs: { hide_onboarding: next } }).eq("id", user.id);
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "14px 0" }}>
      <span>
        <span style={{ ...mono, display: "block", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase" }}>
          Getting-started checklist
        </span>
        <span style={{ display: "block", fontSize: 12.5, color: "var(--t5)", marginTop: 4 }}>
          The guided steps on your Home tab.
        </span>
      </span>
      <button
        onClick={toggle}
        disabled={busy}
        className="btnGhost"
        style={{ padding: "9px 18px", fontSize: 12.5, borderRadius: 100, opacity: busy ? 0.6 : 1, flex: "none" }}
      >
        {hidden ? "Show again" : "Hide"}
      </button>
    </div>
  );
}
