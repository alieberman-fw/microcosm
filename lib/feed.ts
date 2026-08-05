/**
 * Feed assembly helpers (pure — offline-pinned).
 *
 * A web search belongs INSIDE the post it informed (the gray SEARCHED rows),
 * never floating as a separate card. The engine emits search events before
 * the post of the turn that ran them, so the primary attachment is FORWARD:
 * a tool hooks onto the same agent's next post. But the run screen's
 * OBSERVER tail polls posts before events each cycle, which can deliver a
 * live search AFTER the post it informed (Adam's Chamber field report:
 * "WEB RESEARCH" cards stranded at the bottom of the feed) — so unattached
 * tools take a second, BACKWARD pass onto the agent's latest earlier post
 * in the same round. A standalone card remains only for truly orphaned
 * searches, where the turn failed after searching and its post never landed.
 */

export interface FeedToolLike {
  agent_key: string;
  round: number;
}

export interface FeedItemLike<T extends FeedToolLike> {
  kind: string;
  post?: { seq: number; agent_key: string; round: number; author?: string };
  t?: T;
}

export function computeToolAttachment<T extends FeedToolLike>(
  items: ReadonlyArray<FeedItemLike<T>>,
): { toolsBySeq: Map<number, T[]>; attachedTools: Set<number> } {
  const pending = new Map<string, { idx: number; t: T }[]>();
  const bySeq = new Map<number, T[]>();
  const attached = new Set<number>();
  const put = (seq: number, t: T, idx: number) => {
    bySeq.set(seq, [...(bySeq.get(seq) ?? []), t]);
    attached.add(idx);
  };
  items.forEach((it, idx) => {
    if (it.kind === "tool" && it.t) {
      const list = pending.get(it.t.agent_key) ?? [];
      list.push({ idx, t: it.t });
      pending.set(it.t.agent_key, list);
    } else if (it.kind === "post" && it.post && it.post.author !== "user") {
      const list = pending.get(it.post.agent_key);
      if (list?.length) {
        list.forEach((x) => put(it.post!.seq, x.t, x.idx));
        pending.delete(it.post.agent_key);
      }
    }
  });
  // backward pass: live-observer ordering can invert tool/post — hook the
  // search onto the agent's LATEST earlier post from the same round
  for (const list of pending.values()) {
    for (const x of list) {
      for (let i = x.idx - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "post" && it.post && it.post.author !== "user" && it.post.agent_key === x.t.agent_key && it.post.round === x.t.round) {
          put(it.post.seq, x.t, x.idx);
          break;
        }
      }
    }
  }
  return { toolsBySeq: bySeq, attachedTools: attached };
}
