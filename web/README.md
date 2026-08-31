# CivilMCP Web

Next.js 15 chat UI for CivilMCP.

## Run Local

```bash
cd Civil_MCP
cp .env.example .env

cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## UI Behavior

- `Quick Answer` is the default, streaming path for the shortest time to first answer.
- `Research Path` builds a four-stage evidence-grounded learning path, assesses page-linked checkpoints, preserves mastered stages during adaptation, and can export or synthesize the completed path.
- `MCP off` = model-only answer
- `MCP on` = bounded Agentic Context Engine over MCP retrieval tools
- Model dropdown: OpenAI GPT-5.6 Luna (default), Terra, and Sol; DeepSeek is an optional fallback. Every model is open access.
- Account: Supabase Google OAuth, email magic link, and password fallback
- Authenticated feature boundary: required for Explore, Chat, Workspace, Research Path, History, and Share/Export; each surface has independent feature flags
- Collection dropdown: `All`, `CE Project`, `NCCE`
- Share/export support for chat sessions

## Server-Side Keys

The web API uses server-only keys from root `.env` / Vercel env vars:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `MCP_SERVER_API_KEY`
- `SUPABASE_SERVICE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_FOUNDER_PRO_PRICE_ID` (only when billing is enabled)

Never expose these as `NEXT_PUBLIC_*`.

For lower demo latency, the server defaults to one combined MCP retrieval call
and deterministic routing. Set `FAST_RETRIEVAL_ENABLED=false` to restore the
legacy section-then-chunk recipe or `LLM_ROUTER_ENABLED=true` to restore the
model router. Research Path concurrency and provider timeouts are bounded by
the server-only variables documented in `.env.local.example`.
