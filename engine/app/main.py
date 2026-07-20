"""Microcosm simulation engine — FastAPI service (CLAUDE.md §6, §9).

Step-2 skeleton: health + version. The run pipeline (persona compilation,
swarms orchestration, event publishing to Supabase Realtime) lands in
build steps 4–5. Runs the open-source `swarms` library in-process — the
only external model dependency is ANTHROPIC_API_KEY.
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()
load_dotenv("../.env.local")  # share repo-root secrets in local dev

app = FastAPI(title="microcosm-engine", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "microcosm-engine",
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "supabase_configured": bool(os.getenv("NEXT_PUBLIC_SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
    }
