"""Event schema — pydantic mirror of lib/events.ts (CLAUDE.md §6.2).

The TypeScript side is the source of truth for field names; keep in sync.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class Cite(BaseModel):
    kind: Literal["doc", "tool", "post"]
    ref: str


class PostEvent(BaseModel):
    type: Literal["post"] = "post"
    sim: str
    seq: int
    author: Literal["agent", "user"] = "agent"
    agent_id: Optional[str] = None
    user_id: Optional[str] = None
    thread: str = "MAIN"
    reply_to: Optional[int] = None
    tag: Literal["POST", "REPLY", "FLIP", "BURST", "FLOOR"] = "POST"
    mentions: list[str] = Field(default_factory=list)
    content: str
    cites: list[Cite] = Field(default_factory=list)
    ts: str = ""
    agent_name: Optional[str] = None
    agent_role: Optional[str] = None
    agent_initials: Optional[str] = None
    post_number: Optional[int] = None


class StageEvent(BaseModel):
    type: Literal["stage"] = "stage"
    sim: str
    value: Literal["seeding", "running", "converged", "synthesizing", "done"]


class PresenceEvent(BaseModel):
    type: Literal["presence"] = "presence"
    sim: str
    agent_id: str
    state: Literal["thinking", "speaking", "idle"]


class SentimentEvent(BaseModel):
    type: Literal["sentiment"] = "sentiment"
    sim: str
    cohort: str
    dist: dict[str, float]


class ConvergenceEvent(BaseModel):
    type: Literal["convergence"] = "convergence"
    sim: str
    aligned: int
    total: int
    dissents: int
