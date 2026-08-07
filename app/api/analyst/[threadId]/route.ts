import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** Reopen an analyst thread: its messages, oldest first (RLS-scoped). */
export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: conv } = await supabase.from("conversations")
    .select("id, title, sim_id").eq("id", threadId).eq("kind", "analyst").maybeSingle();
  if (!conv) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const { data: messages } = await supabase.from("conversation_messages")
    .select("id, role, agent_key, agent_name, content, created_at")
    .eq("conversation_id", threadId).order("id", { ascending: true }).limit(200);

  return NextResponse.json({ thread: conv, messages: messages ?? [] });
}

/** Delete an analyst thread (the panel's history menu). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await supabase.from("conversations").delete().eq("id", threadId).eq("kind", "analyst");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
