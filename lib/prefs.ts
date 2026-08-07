"use client";

/**
 * Per-user prefs (users.prefs jsonb) — ONE writer helper that MERGES.
 * The original writers replaced the whole object ({ hide_onboarding }
 * clobbering everything else); with starred lists joining the bag, every
 * write must read-merge-write. Last-writer-wins per key is fine for
 * single-user preference data.
 */

import { createClient } from "@/lib/supabase/client";

export interface UserPrefs {
  hide_onboarding?: boolean;
  /** favorites (feature batch 1b): sims star by id; reports star by sim id
   *  (the report card identity — versions share their set's star) */
  starred_sims?: string[];
  starred_reports?: string[];
}

export async function mergePrefs(patch: Partial<UserPrefs>): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase.from("users").select("prefs").eq("id", user.id).single();
  const prefs = { ...((data?.prefs as UserPrefs | null) ?? {}), ...patch };
  await supabase.from("users").update({ prefs }).eq("id", user.id);
}

/** toggle helper for the starred lists — returns the next list */
export function toggleId(list: string[] | undefined, id: string): string[] {
  const set = new Set(list ?? []);
  if (set.has(id)) set.delete(id); else set.add(id);
  return [...set].slice(-500);
}
