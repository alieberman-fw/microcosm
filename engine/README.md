# Microcosm engine

Python simulation service: FastAPI + the open-source [swarms](https://github.com/kyegomez/swarms) library, per CLAUDE.md §6. Owns persona→prompt compilation, swarm orchestration, the verifier pass, and event publishing to Supabase Realtime.

## Run locally

```bash
cd engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/health
```

Secrets are read from the repo root `.env.local` (ANTHROPIC_API_KEY, Supabase keys). No Swarms API key is needed — the library runs in-process and calls Anthropic directly.

## Status

Step-2 skeleton (health endpoint + event models mirroring `lib/events.ts`). The run pipeline lands in build steps 4–5.
