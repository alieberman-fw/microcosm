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
  { slug: "interaction-modes", title: "Interaction modes", kicker: "04 · THE CHOREOGRAPHY", blurb: "Seven ways a panel can argue, animated — and who actually speaks in each." },
  { slug: "casting-and-population", title: "Casting & population", kicker: "05 · THE CAST", blurb: "Auto-cast vs hand-pick, re-cast vs add, and how the crowd becomes real members." },
  { slug: "getting-started", title: "Getting started", kicker: "06 · FIRST RUN", blurb: "Conversations in 2 minutes, your first simulation in 15, and where everything lives." },
];
