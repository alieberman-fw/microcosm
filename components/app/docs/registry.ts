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
  { slug: "simulations-and-swarms", title: "What is a swarm?", kicker: "02 · THE SCIENCE", blurb: "Why a room of disagreeing agents beats one confident answer — even one with web search — and when a single chat is honestly enough." },
  { slug: "leads-and-the-crowd", title: "Leads & the crowd", kicker: "03 · THE ARCHITECTURE", blurb: "Why 12 voices argue while 500 get polled — and why that beats 1,000 agents all talking, or one voice guessing." },
  { slug: "core-concepts", title: "Core concepts", kicker: "04 · THE LANGUAGE", blurb: "Kind vs tier, leads vs crowd, composition, the adversarial seed — the six words that explain everything." },
  { slug: "asking-good-questions", title: "Asking good questions", kicker: "05 · THE CRAFT", blurb: "The eight question shapes that work — go/no-go, valuation, absorption, entitlement, policy — with paste-ready examples of each." },
  { slug: "agents-and-the-library", title: "Agents & the library", kicker: "06 · THE AGENTS", blurb: "What a persona actually is, the 1,800 built-world library, your custom agents, and remixing." },
  { slug: "conversations", title: "Conversations & group chats", kicker: "07 · THE ROOMS", blurb: "Talk to any persona directly — 1:1 or rooms of 20, @mentions, attachments, model tiers." },
  { slug: "interaction-modes", title: "Interaction modes", kicker: "08 · THE CHOREOGRAPHY", blurb: "Seven ways a panel can argue, animated — and who actually speaks in each." },
  { slug: "casting-and-population", title: "Casting & population", kicker: "09 · THE CAST", blurb: "Auto-cast vs hand-pick, re-cast vs add, the crowd — and exactly how the numbers add up." },
  { slug: "reports-and-the-analyst", title: "The report & the analyst", kicker: "10 · THE DELIVERABLE", blurb: "Verdicts with receipts, preserved dissents, inspectable polls — and the analyst that keeps the room open after the run." },
  { slug: "monitoring", title: "Monitoring & costs", kicker: "11 · THE METER", blurb: "Every model call the platform makes, logged with tokens, latency, and estimated spend." },
  { slug: "guided-tour", title: "The guided tour", kicker: "12 · THE WALKTHROUGH", blurb: "One simulation end to end — brief, checkpoint, cast, crowd, run, report, analyst — with the actual screens in miniature." },
  { slug: "getting-started", title: "Getting started", kicker: "13 · FIRST RUN", blurb: "Conversations in 2 minutes, your first simulation in 15, and where everything lives." },
];
