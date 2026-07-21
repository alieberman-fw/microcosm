"use client";

/**
 * Minimal markdown renderer for chat bubbles: **bold**, *italics*, `code`,
 * ### headers, bullet/numbered lists, paragraphs — rendered as React elements
 * (no HTML injection), no dependencies. Also highlights @mentions of the
 * room's participants in accent.
 */

import { CSSProperties, Fragment, ReactNode } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inline(text: string, mentionPat: string | null, keyBase: string): ReactNode[] {
  const pat = new RegExp(
    `(\`[^\`]+\`|\\*\\*[^*]+\\*\\*|\\*[^*\\s][^*]*\\*${mentionPat ? `|${mentionPat}` : ""})`,
    "g"
  );
  const out: ReactNode[] = [];
  text.split(pat).forEach((part, i) => {
    if (!part) return;
    const key = `${keyBase}.${i}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code key={key} style={{ ...mono, fontSize: "0.88em", background: "var(--sf2)", border: "1px solid var(--ln3)", borderRadius: 5, padding: "1px 5px" }}>
          {part.slice(1, -1)}
        </code>
      );
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(
        <strong key={key} style={{ fontWeight: 600, color: "var(--t0)" }}>
          {inline(part.slice(2, -2), mentionPat, key)}
        </strong>
      );
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else if (mentionPat && part.startsWith("@")) {
      out.push(<span key={key} style={{ color: "var(--acc)", fontWeight: 600 }}>{part}</span>);
    } else {
      out.push(<Fragment key={key}>{part}</Fragment>);
    }
  });
  return out;
}

export default function Markdown({ text, mentions = [] }: { text: string; mentions?: string[] }) {
  // longest-first so "Priyanka" wins over "Priya"
  const mentionPat = mentions.length
    ? `@(?:${[...new Set(mentions)].sort((a, b) => b.length - a.length).map(esc).join("|")})`
    : null;

  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={key++} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {inline(para.join("\n"), mentionPat, `p${key}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={key++} style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
        {list.items}
      </Tag>
    );
    list = null;
  };

  text.split("\n").forEach((line, i) => {
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    const ul = line.match(/^\s*[-•]\s+(.+)$/) ?? line.match(/^\s*\*\s+(.+)$/);
    const ol = line.match(/^\s*(\d{1,2})[.)]\s+(.+)$/);
    if (h) {
      flushPara(); flushList();
      blocks.push(
        <div key={key++} style={{ fontWeight: 600, color: "var(--t0)", fontSize: "1.02em", marginTop: blocks.length ? 4 : 0 }}>
          {inline(h[2], mentionPat, `h${i}`)}
        </div>
      );
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(<li key={i}>{inline(ul[1], mentionPat, `l${i}`)}</li>);
    } else if (ol) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      // explicit value: models often blank-line between items, which splits
      // the <ol> — this keeps 1, 2, 3 instead of restarting at 1
      list.items.push(<li key={i} value={Number(ol[1])}>{inline(ol[2], mentionPat, `l${i}`)}</li>);
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  });
  flushPara(); flushList();

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{blocks}</div>;
}
