# CivilMCP Web

Next.js 15 chat UI for CivilMCP.

## Run Local

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
cp .env.example .env

cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## UI Behavior

- `MCP off` = model-only answer
- `MCP on` = bounded Agentic Context Engine over MCP retrieval tools
- Model dropdown: `gpt-5-mini-2025-08-07`, `gpt-5-nano`, `deepseek-v4-flash`, `deepseek-v4-pro`
- Collection dropdown: `All`, `CE Project`, `NCCE`
- Share/export support for chat sessions

## Server-Side Keys

The web API uses server-only keys from root `.env` / Vercel env vars:

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `MCP_SERVER_API_KEY`
- `SUPABASE_SERVICE_KEY`

Never expose these as `NEXT_PUBLIC_*`.
