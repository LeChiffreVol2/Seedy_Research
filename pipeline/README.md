# Pipeline

แปลง PDF เป็น Markdown แล้ว index เข้า Supabase pgvector v2 ด้วย `text-embedding-3-small` + `dimensions=768`.

## Install

```bash
cd /Users/lechiffre/Desktop/Civil_MCP/pipeline
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements.index.txt
```

## CE Project Extraction

```bash
python3.10 extract.py
```

ค่า default อ่านจาก:

```text
/Users/lechiffre/Desktop/Civil_MCP/CE Project Database
```

ใช้ `pdftotext` engine ถ้าต้องการเบากว่า layout/OCR:

```bash
python3.10 extract.py --engine pdftotext
```

## NCCE Proceedings Extraction

```bash
python3.10 extract_ncce.py
```

ค่า default อ่านจาก:

```text
/Users/lechiffre/Desktop/Civil_MCP/NCCE Project Database
```

ผลลัพธ์จะถูกเขียนเป็น paper-level markdown ใน `pipeline/data/markdown` พร้อม metadata:

- `collection: ncce`
- `source_type: proceedings_paper` หรือ `proceedings_window`
- `parent_source_pdf`
- `paper_code`
- `page_start`, `page_end`
- `proceeding_no`, `proceeding_year`
- `discipline`

Boundary detection ใช้ pattern เช่น `STR01-1`, `BTL-02-1`, `EEC01-1`. ถ้า detect ได้ไม่ดีพอ จะ fallback เป็น page-window docs โดยยังเก็บ page range สำหรับ citation.

## v2 Indexing

Default mode มาจาก `INDEXING_MODE=batch`:

```bash
python3.10 index.py
```

ระบุชัดเจน:

```bash
python3.10 index.py --mode batch
```

Debug/seed corpus เล็ก:

```bash
python3.10 index.py --mode sync
```

Controlled re-index สำหรับ production cleanup/backfill:

```bash
python3.10 index.py --mode sync --collection ce_project --max-embedding-jobs 4000 --embed-batch-size 50 --sleep-seconds 2
```

Dry-run ก่อนเสียค่า embedding หรือเขียน Supabase:

```bash
python3.10 index.py --collection ce_project --dry-run
python3.10 index.py --collection ncce --source-glob 'NCCE29_*' --dry-run
```

Resume OpenAI Batch ที่ submit ไปแล้ว:

```bash
python3.10 index.py --mode batch --resume-batch-id batch_xxx --resume-batch-part 1
```

Indexer เป็น incremental:

- คำนวณ `doc_hash` จาก markdown ทั้งไฟล์
- คำนวณ `content_hash` ต่อ section/chunk
- row ที่ hash เดิมและมี embedding อยู่แล้วจะไม่ถูก embed ซ้ำ
- row ที่เปลี่ยนหรือเพิ่มใหม่เท่านั้นที่จะเข้า OpenAI embedding job
- `--collection` และ `--source-glob` จำกัด blast radius ของการ re-index
- `--max-embedding-jobs` เป็น hard cap กัน cost runaway
- `--dry-run` แสดงจำนวน docs/sections/chunks/jobs โดยไม่เรียก OpenAI และไม่เขียน DB

## Batch Controls

ปรับได้ผ่าน `.env` หรือ CLI:

```bash
MAX_BATCH_REQUESTS=10000
MAX_BATCH_ESTIMATED_TOKENS=2000000
MAX_BATCH_INPUTS_PER_REQUEST=64
MAX_BATCH_REQUEST_ESTIMATED_TOKENS=100000
BATCH_POLL_SECONDS=10
```

ตัวอย่างลด batch size เมื่อองค์กรมี enqueued token limit ต่ำ:

```bash
python3.10 index.py --mode batch --max-batch-estimated-tokens 750000
```

## Reindex Vector Indexes

หลัง ingest รอบใหญ่:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
python3.10 supabase/recheck.py --reindex-v2 --v2
```

## Readiness Check

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
python3.10 supabase/recheck.py --v2
```

## Data Quality Check

ใช้ venv หลักของ repo เพื่อให้ DB driver พร้อม:

```bash
cd /Users/lechiffre/Desktop/Civil_MCP
.venv310/bin/python harness/run_data_quality.py
```

ผ่านเมื่อ corpus มี page metadata/markers ครบ และ Supabase v2 ไม่มี missing embeddings.
