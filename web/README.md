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

- `MCP off` = model-only answer
- `MCP on` = bounded Agentic Context Engine over MCP retrieval tools
- Model dropdown: `gpt-5.6-luna` (default), Founder Pro `gpt-5.6-terra`/`gpt-5.6-sol`, and optional DeepSeek models
- Account: Supabase Google OAuth, email magic link, and password fallback
- Founder Pro: Stripe-hosted subscription checkout, portal, and weighted monthly credits
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
