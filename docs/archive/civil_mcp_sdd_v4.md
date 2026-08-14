# Spec-Driven Development (SDD) — v4 Zero-Cost Production
# Civil Engineering RAG · MCP Server Prototype
**Baseline vs MCP · Deploy on Vercel + Render.com · Model: gpt-5-mini-2025-08-07**

---

## 0. Cost Breakdown

| Service | Cost | หมายเหตุ |
|---|---|---|
| **Vercel** Hobby | $0 | Web app |
| **Supabase** Free | $0 | pgvector 500MB |
| **Render.com** Free | $0 | MCP Server · spin down หลัง 15 นาที |
| **UptimeRobot** Free | $0 | Ping /health ทุก 5 นาที → ป้องกัน spin down |
| Pipeline (local) | $0 | รันครั้งเดียว |
| OpenAI index | ~$0.006 | ครั้งเดียว |
| OpenAI eval | ~$0.015 | 5Q×2 |
| **รวม** | **< $0.025** | |
| ~~Fly.io / Railway~~ | ~~❌~~ | ไม่มี free tier จริง |

---

## 1. Overview & Stack

| Item | Spec |
|---|---|
| Input | 30 PDF files — Thai Civil Engineering papers (จุฬาฯ) |
| Objective | เปรียบเทียบ **Baseline** (ส่ง Markdown ตรง) vs **MCP RAG** (Semantic Search) |
| Model | `gpt-5-mini-2025-08-07` ($0.25/1M input · $2.00/1M output) |
| Embedding | `text-embedding-3-small` (OpenAI, 1536 dims) |
| Vector DB | **Supabase pgvector** (production ตลอด — ไม่มี ChromaDB) |
| MCP Transport | **Streamable HTTP** (Python FastMCP → ASGI) |
| Deploy | **Vercel** (Next.js 15 App Router + Vercel AI SDK v4) |
| Protocol | OpenAI MCP · `@modelcontextprotocol/sdk` |

---

## 2. Architecture

```
UptimeRobot (free) ── ping /health ทุก 5min ──┐
                                               ↓
Render.com (free) ── MCP Server (FastAPI+FastMCP)
                          └── Supabase pgvector

Vercel (free) ── Next.js Compare UI
  ├── mode=baseline → OpenAI direct
  └── mode=mcp      → OpenAI tools → Supabase
```

---

## 3. Project Structure

```
civil-mcp-prototype/
│
├── pipeline/                      # Data processing (Python) — รันครั้งเดียว
│   ├── extract.py                 # PDF → Markdown
│   ├── index.py                   # Markdown → Supabase pgvector
│   ├── requirements.txt
│   ├── .env                       # OPENAI_API_KEY, SUPABASE_*
│   └── data/
│       ├── pdfs/                  # วาง 30 PDF ตรงนี้
│       └── markdown/              # Output จาก extract.py
│
├── mcp-server/                    # MCP Server (Python FastMCP · HTTP/ASGI)
│   ├── server.py
│   ├── render.yaml                # Render.com deploy config
│   ├── requirements.txt
│   └── .env                       # OPENAI_API_KEY, SUPABASE_*
│
├── eval/                          # Evaluation scripts
│   ├── baseline.py
│   ├── mcp_eval.py
│   ├── compare.py
│   └── questions.json
│
└── web/                           # Next.js — Vercel deploy
    ├── app/
    │   ├── api/
    │   │   └── chat/route.ts      # Vercel AI SDK · streamText + tools
    │   ├── page.tsx               # Compare UI (Baseline tab | MCP tab)
    │   └── layout.tsx
    ├── lib/
    │   └── supabase.ts            # pgvector client + embed helper
    ├── .env.local                 # env vars
    └── package.json
```

---

## 4. Supabase Setup (One-time)

รัน SQL นี้ใน Supabase SQL Editor ก่อนทุกอย่าง:

```sql
-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Main table
create table civil_chunks (
  id           text primary key,
  source       text not null,         -- ชื่อไฟล์ .md
  discipline   text not null,         -- transport | structural | geotechnical | construction_mgmt
  chunk_index  integer not null,
  content      text not null,
  embedding    vector(1536),
  created_at   timestamptz default now()
);

-- 3. IVFFlat index (เร็วขึ้นมากเมื่อ rows > 10k)
create index on civil_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- 4. Semantic search function
create or replace function match_civil_chunks(
  query_embedding vector(1536),
  match_count     int     default 5,
  filter_disc     text    default null
)
returns table (
  id           text,
  source       text,
  discipline   text,
  content      text,
  similarity   float
)
language sql stable as $$
  select
    id, source, discipline, content,
    1 - (embedding <=> query_embedding) as similarity
  from civil_chunks
  where filter_disc is null or discipline = filter_disc
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

---

## 5. Phase 1 — PDF Extraction

### `pipeline/requirements.txt`

```
unstructured[pdf]==0.16.12
pillow
pdfminer.six
pytesseract
python-dotenv
```

### `pipeline/extract.py`

```python
"""
PDF → Markdown
ใช้ unstructured hi_res + infer_table_structure
รองรับ Thai + HTML table output
"""
import os
from pathlib import Path
from unstructured.partition.pdf import partition_pdf

PDF_DIR = Path("data/pdfs")
OUT_DIR = Path("data/markdown")
OUT_DIR.mkdir(exist_ok=True)

def pdf_to_markdown(pdf_path: Path) -> str:
    elements = partition_pdf(
        filename=str(pdf_path),
        strategy="hi_res",
        infer_table_structure=True,
        extract_images_in_pdf=False,
        languages=["tha", "eng"],
    )
    lines = []
    for el in elements:
        el_type = type(el).__name__
        text    = str(el).strip()
        if not text:
            continue
        if el_type == "Title":
            lines.append(f"\n## {text}\n")
        elif el_type == "Table":
            html = getattr(el.metadata, "text_as_html", None)
            lines.append(f"\n{html or text}\n")
        elif el_type == "ListItem":
            lines.append(f"- {text}")
        else:
            lines.append(text)
    return "\n".join(lines)

def run():
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    print(f"Found {len(pdfs)} PDFs")
    for pdf in pdfs:
        out = OUT_DIR / pdf.with_suffix(".md").name
        if out.exists():
            print(f"  skip (exists): {pdf.name}")
            continue
        print(f"  → {pdf.name}")
        md = pdf_to_markdown(pdf)
        out.write_text(md, encoding="utf-8")
    print("Extraction complete.")

if __name__ == "__main__":
    run()
```

> **QA**: ตรวจ Markdown ว่า `<table>` มี header ครบ ถ้าเพี้ยนให้ใช้ `docling` แทน unstructured

---

## 6. Phase 2 — Indexing → Supabase pgvector

### `pipeline/requirements.txt` (เพิ่ม)

```
openai>=1.40.0
supabase>=2.5.0
langchain-text-splitters>=0.2.0
```

### `pipeline/.env`

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role key (write access)
```

### `pipeline/index.py`

```python
"""
Markdown → chunk → embed → Supabase pgvector
Discipline ดึงจาก filename prefix: TR/ST/GE/CM
"""
import os, time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client
from langchain_text_splitters import MarkdownTextSplitter

load_dotenv()

openai_client: OpenAI   = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
supabase: Client        = create_client(os.environ["SUPABASE_URL"],
                                        os.environ["SUPABASE_SERVICE_KEY"])
splitter = MarkdownTextSplitter(chunk_size=800, chunk_overlap=150)
MD_DIR   = Path("data/markdown")

DISC_MAP = {"TR": "transport", "ST": "structural",
            "GE": "geotechnical", "CM": "construction_mgmt"}

def get_discipline(stem: str) -> str:
    parts = stem.split("_")
    return DISC_MAP.get(parts[1] if len(parts) > 1 else "", "unknown")

def embed_batch(texts: list[str]) -> list[list[float]]:
    resp = openai_client.embeddings.create(
        model="text-embedding-3-small", input=texts
    )
    return [d.embedding for d in resp.data]

def run():
    for md_file in sorted(MD_DIR.glob("*.md")):
        text       = md_file.read_text(encoding="utf-8")
        chunks     = splitter.create_documents([text])
        if not chunks:
            continue

        discipline = get_discipline(md_file.stem)
        docs       = [c.page_content for c in chunks]

        # Embed in batches of 50
        BATCH  = 50
        vectors: list[list[float]] = []
        for i in range(0, len(docs), BATCH):
            vectors.extend(embed_batch(docs[i:i+BATCH]))
            time.sleep(0.3)   # rate limit buffer

        # Upsert to Supabase
        rows = [
            {
                "id":          f"{md_file.stem}_{i}",
                "source":      md_file.name,
                "discipline":  discipline,
                "chunk_index": i,
                "content":     doc,
                "embedding":   vec,
            }
            for i, (doc, vec) in enumerate(zip(docs, vectors))
        ]
        supabase.table("civil_chunks").upsert(rows).execute()
        print(f"  ✓ {len(rows):3d} chunks ← {md_file.name} [{discipline}]")

    count = supabase.table("civil_chunks").select("id", count="exact").execute()
    print(f"\nTotal rows in Supabase: {count.count}")

if __name__ == "__main__":
    run()
```

---

## 7. Phase 3 — MCP Server (Production HTTP)

### `mcp-server/requirements.txt`

```
fastapi
mcp>=1.9.0
openai>=1.40.0
supabase>=2.5.0
python-dotenv
uvicorn[standard]
```

### `mcp-server/.env`

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### `mcp-server/server.py`

เพิ่ม FastAPI wrapper + `/health` endpoint สำหรับ UptimeRobot ping

```python
"""
Civil Engineering MCP Server
Transport: Streamable HTTP (ASGI) — production-ready
Tools: search_civil_knowledge, list_papers
"""
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP
from openai import OpenAI
from supabase import create_client

load_dotenv()
oa  = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
sb  = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
mcp = FastMCP("civil-engineering-mcp")

def embed(text: str) -> list[float]:
    return oa.embeddings.create(
        model="text-embedding-3-small", input=[text]
    ).data[0].embedding

@mcp.tool()
def search_civil_knowledge(
    query: str,
    discipline: str = "",
    max_results: int = 5,
) -> str:
    """
    Search the Civil Engineering RAG knowledge base (30 papers, จุฬาฯ ป.ตรี).
    Returns semantically relevant chunks with source file and similarity score.

    Args:
        query: คำถามหรือ keyword ภาษาไทยหรืออังกฤษ
        discipline: กรองสาย — "transport" | "structural" | "geotechnical" | "construction_mgmt" | "" (ทุกสาย)
        max_results: จำนวน chunks ที่ต้องการ (default 5)
    """
    r = sb.rpc("match_civil_chunks", {
        "query_embedding": embed(query),
        "match_count":     max_results,
        "filter_disc":     discipline or None,
    }).execute()
    if not r.data:
        return "No relevant content found in the knowledge base."
    return "\n\n---\n\n".join(
        f"[{round(row['similarity'],3)}] {row['source']} · {row['discipline']}\n{row['content']}"
        for row in r.data
    )

@mcp.tool()
def list_papers(discipline: str = "") -> str:
    """
    List all available papers in the knowledge base.

    Args:
        discipline: กรองสาย — "transport" | "structural" | "geotechnical" | "construction_mgmt" | "" (ทุกสาย)
    """
    q = sb.table("civil_chunks").select("source, discipline")
    if discipline:
        q = q.eq("discipline", discipline)
    rows = q.execute().data
    sources = sorted({(r["source"], r["discipline"]) for r in rows})
    return f"Found {len(sources)} papers:\n" + "\n".join(f"- [{d}] {s}" for s, d in sources)

# FastAPI wrapper — /health ให้ UptimeRobot ping ป้องกัน Render spin down
app = FastAPI()

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})

app.mount("/", mcp.get_asgi_app())
```

### `mcp-server/render.yaml`

```yaml
services:
  - type: web
    name: civil-mcp-server
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn server:app --host 0.0.0.0 --port $PORT
    plan: free
    envVars:
      - key: OPENAI_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
```

---

## 8. UptimeRobot Setup (ป้องกัน Render Spin Down)

```
1. สมัคร uptimerobot.com (ฟรี)
2. Add Monitor → HTTP(s)
3. URL: https://civil-mcp-server.onrender.com/health
4. Interval: 5 minutes → Save
```

---

## 9. Phase 4 — Evaluation

### `eval/questions.json`

```json
[
  {
    "id": "Q1",
    "discipline": "transport",
    "question": "ค่าแรงต้านทานด้านข้างของหมอนรางรถไฟคอนกรีตเทียบกับไม้ไผ่เทียมเป็นอย่างไร?"
  },
  {
    "id": "Q2",
    "discipline": "transport",
    "question": "วิธี AI ที่ใช้วิเคราะห์น้ำหนักรถไฟมีความแม่นยำสูงสุดเท่าไหร่?"
  },
  {
    "id": "Q3",
    "discipline": "transport",
    "question": "นโยบายค่าผ่านทางในกรุงเทพฯ กระทบพฤติกรรมการเดินทางอย่างไร?"
  },
  {
    "id": "Q4",
    "discipline": "structural",
    "question": "กำลังรับแรงอัดของคอนกรีตผสมวัสดุทดแทนในงานโครงสร้างเป็นเท่าไหร่?"
  },
  {
    "id": "Q5",
    "discipline": "construction_mgmt",
    "question": "เทคนิคการบริหารโครงการก่อสร้างที่ช่วยลดความล่าช้ามีอะไรบ้าง?"
  }
]
```

### `eval/baseline.py`

```python
"""
Baseline: ส่ง Markdown context ตรงเข้า gpt-5-mini — ไม่ผ่าน RAG
"""
import json, os, time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client    = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL     = "gpt-5-mini-2025-08-07"
MD_DIR    = Path("../pipeline/data/markdown")
QUESTIONS = json.loads(Path("questions.json").read_text(encoding="utf-8"))

DISC_PREFIX = {
    "transport": "TR", "structural": "ST",
    "geotechnical": "GE", "construction_mgmt": "CM"
}

def load_context(discipline: str, max_chars: int = 60_000) -> str:
    prefix = DISC_PREFIX.get(discipline, "")
    files  = sorted(MD_DIR.glob(f"*{prefix}*.md"))
    buf    = ""
    for f in files:
        buf += f.read_text(encoding="utf-8")[:3_000] + "\n\n---\n\n"
        if len(buf) >= max_chars:
            break
    return buf[:max_chars]

results = []
for q in QUESTIONS:
    context = load_context(q["discipline"])
    t0 = time.time()
    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=600,
        messages=[
            {"role": "system", "content":
             "You are a Civil Engineering assistant. Answer ONLY from the provided documents. "
             "If the answer is not found, say 'ไม่พบข้อมูลในเอกสาร'."},
            {"role": "user", "content":
             f"Documents:\n{context}\n\nQuestion: {q['question']}"},
        ],
    )
    latency = round(time.time() - t0, 2)
    results.append({
        "id":       q["id"],
        "question": q["question"],
        "answer":   resp.choices[0].message.content,
        "tokens":   resp.usage.total_tokens,
        "latency":  latency,
        "method":   "baseline",
    })
    print(f"[{q['id']}] tokens={resp.usage.total_tokens} | {latency}s")

Path("baseline_results.json").write_text(
    json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("→ baseline_results.json")
```

### `eval/mcp_eval.py`

MCP_URL ชี้ไป Render URL แทน localhost + timeout=60s สำหรับ cold start

```python
"""
MCP Eval: OpenAI tool calling loop → MCP Server HTTP → Supabase RAG
"""
import json, os, time, requests
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client    = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL     = "gpt-5-mini-2025-08-07"
MCP_URL   = os.environ.get("MCP_URL", "https://civil-mcp-server.onrender.com")
QUESTIONS = json.loads(Path("questions.json").read_text(encoding="utf-8"))

TOOLS = [{
    "type": "function",
    "function": {
        "name": "search_civil_knowledge",
        "description": "Search Civil Engineering RAG knowledge base (30 papers จุฬาฯ). "
                       "MUST call before answering any engineering question.",
        "parameters": {
            "type": "object",
            "properties": {
                "query":       {"type": "string",
                                "description": "Search query in Thai or English"},
                "discipline":  {"type": "string",
                                "enum": ["transport","structural",
                                         "geotechnical","construction_mgmt",""]},
                "max_results": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
}]

def call_mcp(name: str, args: dict) -> str:
    resp = requests.post(
        f"{MCP_URL}/tools/call",
        json={"name": name, "arguments": args},
        timeout=60,   # เผื่อ cold start
    )
    resp.raise_for_status()
    return resp.json().get("content", [{}])[0].get("text", "No result")

results = []
for q in QUESTIONS:
    messages = [
        {"role": "system", "content":
         "You are a Civil Engineering assistant. "
         "ALWAYS use search_civil_knowledge tool before answering."},
        {"role": "user", "content": q["question"]},
    ]
    total_tokens = 0
    t0 = time.time()

    while True:
        resp = client.chat.completions.create(
            model=MODEL, messages=messages,
            tools=TOOLS, tool_choice="auto", max_tokens=700,
        )
        total_tokens += resp.usage.total_tokens
        msg = resp.choices[0].message

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                args   = json.loads(tc.function.arguments)
                result = call_mcp(tc.function.name, args)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
        else:
            answer = msg.content
            break

    latency = round(time.time() - t0, 2)
    results.append({
        "id":       q["id"],
        "question": q["question"],
        "answer":   answer,
        "tokens":   total_tokens,
        "latency":  latency,
        "method":   "mcp_rag",
    })
    print(f"[{q['id']}] tokens={total_tokens} | {latency}s")

Path("mcp_results.json").write_text(
    json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("→ mcp_results.json")
```

### `eval/compare.py`

```python
"""Side-by-side comparison report"""
import json
from pathlib import Path

B = {r["id"]: r for r in json.loads(Path("baseline_results.json").read_text())}
M = {r["id"]: r for r in json.loads(Path("mcp_results.json").read_text())}

print(f"\n{'─'*70}")
print(f"{'ID':<4} {'Method':<10} {'Tokens':>7} {'Latency':>9}")
print(f"{'─'*70}")
for qid in sorted(B):
    b, m = B[qid], M[qid]
    print(f"{qid:<4} baseline   {b['tokens']:>7,}   {b['latency']:>7.1f}s")
    print(f"     mcp_rag   {m['tokens']:>7,}   {m['latency']:>7.1f}s  "
          f"[Δ tokens: {m['tokens']-b['tokens']:+,}]")
    print(f"  Q: {b['question'][:60]}")
    print(f"  [B] {b['answer'][:120]}…")
    print(f"  [M] {m['answer'][:120]}…")
    print()
```

---

## 10. Phase 5 — Vercel Next.js App

### `web/package.json` (key deps)

```json
{
  "dependencies": {
    "ai": "^4.3.0",
    "@ai-sdk/openai": "^1.3.0",
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.2.0",
    "zod": "^3.23.0"
  }
}
```

### `web/.env.local`

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_MCP_URL=https://civil-mcp-server.onrender.com
```

### `web/lib/supabase.ts`

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding as number[];
}

export async function searchChunks(
  query: string,
  discipline?: string,
  maxResults = 5
): Promise<string> {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("match_civil_chunks", {
    query_embedding: embedding,
    match_count:     maxResults,
    filter_disc:     discipline || null,
  });

  if (error || !data?.length) return "No relevant content found.";
  return (data as any[])
    .map((r) => `[Score: ${r.similarity.toFixed(3)}] ${r.source}\n${r.content}`)
    .join("\n\n---\n\n");
}
```

### `web/app/api/chat/route.ts`

```typescript
import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { searchChunks } from "@/lib/supabase";
import { z } from "zod";

export const runtime = "edge";
export const maxDuration = 60;

const MODEL = "gpt-5-mini-2025-08-07";

export async function POST(req: Request) {
  const { messages, mode } = await req.json();

  // ── Baseline: no RAG ──────────────────────────────────────────────────────
  if (mode === "baseline") {
    const result = streamText({
      model: openai(MODEL),
      system:
        "You are a Civil Engineering assistant. Answer from your general knowledge only. " +
        "Be honest when you're uncertain.",
      messages,
    });
    return result.toDataStreamResponse();
  }

  // ── MCP RAG mode ──────────────────────────────────────────────────────────
  const result = streamText({
    model: openai(MODEL),
    system:
      "You are a Civil Engineering assistant with access to a knowledge base of 30 research papers " +
      "from Chulalongkorn University. ALWAYS call search_civil_knowledge before answering. " +
      "Cite the source file in your answer.",
    messages,
    tools: {
      search_civil_knowledge: tool({
        description:
          "Search the Civil Engineering knowledge base (30 papers, จุฬาฯ ป.ตรี). " +
          "Returns semantically relevant chunks with source attribution.",
        parameters: z.object({
          query: z.string().describe("Search query in Thai or English"),
          discipline: z
            .enum(["transport", "structural", "geotechnical", "construction_mgmt", ""])
            .default("")
            .describe("Filter by engineering discipline"),
          max_results: z.number().int().min(1).max(10).default(5),
        }),
        execute: async ({ query, discipline, max_results }) => {
          return await searchChunks(query, discipline || undefined, max_results);
        },
      }),
    },
    maxSteps: 3,
  });

  return result.toDataStreamResponse();
}
```

### `web/app/page.tsx` (Compare UI skeleton)

```tsx
"use client";
import { useState } from "react";
import { useChat } from "ai/react";

type Mode = "baseline" | "mcp";

function ChatPane({ mode, label }: { mode: Mode; label: string }) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      api: "/api/chat",
      body: { mode },
    });

  return (
    <div className="flex flex-col h-full border rounded-xl p-4 gap-3">
      <h2 className="font-semibold text-lg">{label}</h2>
      <div className="flex-1 overflow-y-auto space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-2 rounded-lg text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-50 ml-8" : "bg-gray-50 mr-8"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="ถามคำถามวิศวกรรมโยธา..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  return (
    <main className="h-screen p-6 grid grid-cols-2 gap-6">
      <ChatPane mode="baseline" label="🔵 Baseline (No RAG)" />
      <ChatPane mode="mcp"      label="🟢 MCP RAG (Supabase)" />
    </main>
  );
}
```

---

## 11. Deployment

### MCP Server → Render.com (Free)

```bash
# 1. Push mcp-server/ ขึ้น GitHub
# 2. Render.com → New Web Service → Connect repo
# 3. ใส่ env vars: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
# 4. Deploy (render.yaml จะถูก detect อัตโนมัติ)
```

> render.yaml อยู่ใน `mcp-server/render.yaml` แล้ว — Render จะ auto-detect

### Next.js → Vercel

```bash
cd web
vercel --prod

# Set env vars in Vercel dashboard:
# OPENAI_API_KEY · SUPABASE_URL · SUPABASE_ANON_KEY · NEXT_PUBLIC_MCP_URL
```

---

## 12. Quick Start Checklist

```
[ ] 1.  Supabase free project → รัน SQL (Section 4)
[ ] 2.  วาง 30 PDF ใน pipeline/data/pdfs/
[ ] 3.  python pipeline/extract.py
[ ] 4.  python pipeline/index.py                   (~$0.006)
[ ] 5.  Push mcp-server/ ขึ้น GitHub
[ ] 6.  Render.com → New Web Service → Connect repo → ใส่ env vars → Deploy
[ ] 7.  UptimeRobot → ping https://civil-mcp-server.onrender.com/health ทุก 5min
[ ] 8.  python eval/baseline.py
[ ] 9.  MCP_URL=https://civil-mcp-server.onrender.com python eval/mcp_eval.py
[ ] 10. python eval/compare.py
[ ] 11. cd web && vercel --prod
```

---

## 13. Model & Cost Reference

| Model | Input | Output | Context | Use |
|---|---|---|---|---|
| `gpt-5-mini-2025-08-07` | $0.25/1M | $2.00/1M | 400K | ใช้ใน eval + web app |
| `text-embedding-3-small` | $0.02/1M | — | — | Embedding (pipeline + query) |

**ประมาณการค่าใช้จ่าย eval (5 คำถาม × 2 method):**
- Baseline: ~60K tokens × $0.25 = ~$0.015
- MCP RAG: ~10K tokens × $0.25 = ~$0.003
- Embedding (index 30 papers): ~300K tokens × $0.02 = ~$0.006
- **รวมทั้งหมด < $0.025**

---

## 14. Evaluation Metrics

| Metric | วิธีวัด |
|---|---|
| **Factual Accuracy** | คำตอบตรงกับเนื้อหาใน papers หรือเปล่า |
| **Token Efficiency** | MCP ใช้ token น้อยกว่า baseline กี่ % |
| **Source Attribution** | ระบุชื่อ paper ต้นทางได้ถูกต้องไหม |
| **Hallucination Rate** | ตอบข้อมูลที่ไม่มีใน 30 papers หรือเปล่า |
| **Latency** | TTFT (time-to-first-token) วินาที |

---

*Document version: 4.0 (Zero-Cost Production) · Model: gpt-5-mini-2025-08-07*  
*อ้างอิง: developers.openai.com/apps-sdk/build/mcp-server · platform.openai.com/docs/models/gpt-5-mini*
