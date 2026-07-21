/**
 * Chat model tiers (CLAUDE.md §6.4) — the only place Conversations model ids
 * live. Never hardcode model names in business logic; import from here.
 */
export const CHAT_MODELS = [
  { id: "claude-haiku-4-5", name: "Haiku 4.5", desc: "Lightweight & fast", short: "HAIKU 4.5" },
  { id: "claude-sonnet-5", name: "Sonnet 5", desc: "Balanced", short: "SONNET 5" },
  { id: "claude-opus-4-8", name: "Opus 4.8", desc: "Frontier reasoning", short: "OPUS 4.8" },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const CHAT_MODEL_IDS: string[] = CHAT_MODELS.map((m) => m.id);

/** Every participant answers on the lightweight tier unless bumped per-thread. */
export const DEFAULT_CHAT_MODEL: ChatModelId = "claude-haiku-4-5";

export function chatModel(id?: string | null) {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0];
}
