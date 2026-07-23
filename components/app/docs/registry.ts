/**
 * Docs page metadata — a plain module (no "use client") so server components
 * can validate slugs and build metadata. The page bodies live in content.tsx
 * (client, interactive); the two are joined by slug.
 */

export interface DocMeta {
  slug: string;
  title: string;
  kicker: string;
  blurb: string;
}

export const DOC_META: DocMeta[] = [
  { slug: "what-is-microcosm", title: "What is Microcosm", kicker: "01 · THE IDEA", blurb: "The city in silico — hard real-estate questions answered by populations of grounded AI personas." },
  { slug: "simulations-and-swarms", title: "Simulations & swarms", kicker: "02 · THE SCIENCE", blurb: "Why many disagreeing agents beat one confident answer, and what keeps them honest." },
  { slug: "core-concepts", title: "Core concepts", kicker: "03 · THE LANGUAGE", blurb: "Kind vs tier, leads vs crowd, composition, the adversarial seed — the six words that explain everything." },
  { slug: "agents-and-the-library", title: "Agents & the library", kicker: "04 · THE AGENTS", blurb: "What a persona actually is, the 1,800 built-world library, your custom agents, and remixing." },
  { slug: "conversations", title: "Conversations & group chats", kicker: "05 · THE ROOMS", blurb: "Talk to any persona directly — 1:1 or rooms of 20, @mentions, attachments, model tiers." },
  { slug: "interaction-modes", title: "Interaction modes", kicker: "06 · THE CHOREOGRAPHY", blurb: "Seven ways a panel can argue, animated — and who actually speaks in each." },
  { slug: "casting-and-population", title: "Casting & population", kicker: "07 · THE CAST", blurb: "Auto-cast vs hand-pick, re-cast vs add, the crowd — and exactly how the numbers add up." },
  { slug: "monitoring", title: "Monitoring & costs", kicker: "08 · THE METER", blurb: "Every model call the platform makes, logged with tokens, latency, and estimated spend." },
  { slug: "getting-started", title: "Getting started", kicker: "09 · FIRST RUN", blurb: "Conversations in 2 minutes, your first simulation in 15, and where everything lives." },
];
