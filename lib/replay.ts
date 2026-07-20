/**
 * Replay stream — plays the golden fixture through the RunStream interface
 * the run screen consumes. The Supabase Realtime implementation will expose
 * the exact same interface, so swapping transports touches zero UI code.
 */

import { RunStream, StreamUpdate, SimEvent, PostEvent } from "./events";
import { AGENTS, EVENTS, SITE47A, FixtureEvent } from "./fixtures/site47a";

function toSimEvent(ev: FixtureEvent, seq: number): SimEvent {
  if (ev.k === "b") {
    return {
      type: "post", sim: SITE47A.id, seq, author: "agent", agent_id: null, user_id: null,
      thread: "MAIN", reply_to: null, tag: "BURST", mentions: [], content: ev.x,
      cites: [], ts: "",
    } satisfies PostEvent;
  }
  const a = AGENTS[ev.a!];
  return {
    type: "post", sim: SITE47A.id, seq, author: "agent", agent_id: ev.a!, user_id: null,
    thread: a.tag ?? "MAIN", reply_to: null,
    tag: ev.flip ? "FLIP" : ev.k === "c" ? "REPLY" : "POST",
    mentions: ev.to ? [ev.to] : [], content: ev.x, cites: [], ts: "",
    agent_name: a.name, agent_role: a.role, agent_initials: a.initials,
    post_number: ev.n,
  } satisfies PostEvent;
}

export function createReplayStream(): RunStream {
  let vt = 0;
  let fired = 0;
  let speed = 1;
  let paused = false;
  let done = false;
  let last = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<(u: StreamUpdate) => void>();

  const totalT = SITE47A.totalT;

  const update = (event: SimEvent | null) => {
    const next = EVENTS[fired];
    const nextAgent = next && next.k !== "b" ? AGENTS[next.a!].name : null;
    const u: StreamUpdate = {
      event,
      vt,
      progress: Math.min(1, vt / totalT),
      simDay: Math.max(1, Math.min(SITE47A.simDays, Math.ceil((vt / totalT) * SITE47A.simDays))),
      postCount: Math.round(Math.min(1, vt / totalT) * SITE47A.totalPosts),
      typingAgent: done ? null : nextAgent,
      done,
    };
    subs.forEach((cb) => cb(u));
  };

  const tick = () => {
    if (paused || done) { last = performance.now(); return; }
    const now = performance.now();
    vt += ((now - last) / 1000) * speed;
    last = now;
    let emitted = false;
    while (fired < EVENTS.length && EVENTS[fired].t <= vt) {
      const ev = toSimEvent(EVENTS[fired], fired);
      fired++;
      emitted = true;
      update(ev);
    }
    if (vt >= totalT) {
      done = true;
      if (timer) clearInterval(timer);
      update(null);
      return;
    }
    if (!emitted) update(null);
  };

  return {
    get speed() { return speed; },
    get paused() { return paused; },
    play() {
      if (timer || done) return;
      last = performance.now();
      timer = setInterval(tick, 120);
    },
    pause() { paused = !paused; },
    toggleSpeed() { speed = speed === 1 ? 4 : 1; return speed; },
    skipToEnd() {
      while (fired < EVENTS.length) {
        update(toSimEvent(EVENTS[fired], fired));
        fired++;
      }
      vt = totalT;
      done = true;
      if (timer) clearInterval(timer);
      update(null);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
  };
}
