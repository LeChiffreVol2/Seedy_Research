# Pipeline

แปลง PDF เป็น Markdown แล้ว index เข้า Supabase pgvector v2 ด้วย `text-embedding-3-small` + `dimensions=768`.

## Install

```bash
cd Civil_MCP
python3.10 -m venv .venv310
source .venv310/bin/activate
pip install -r pipeline/requirements.txt
pip install -r pipeline/requirements.index.txt
```

## Student Transport Project Extraction

```bash
python3.10 pipeline/extract.py
```

ค่า default อ่านจาก `CE Project Database/` ที่ root ของ repository (คงชื่อ
directory และ internal collection `ce_project` ไว้เพื่อ backward compatibility)
แต่ canonical source name คือ `Student Transport Projects`.

Default engine คือ page-preserving hybrid extraction: ใช้ `pdftotext` ก่อนและ
OCR เฉพาะหน้าที่ text อ่อนด้วย Tesseract `tha+eng`. หน้าว่างจะไม่ถูกตัดออกจาก
ลำดับ จึงไม่ทำให้ exact-page citation ของหน้าถัดไปเลื่อน.

เลือกไฟล์และลดงาน OCR ได้โดย:

```bash
python3.10 pipeline/extract.py \
  --source-glob 'Y2024_TR_Article_G01.pdf' \
  --overwrite \
  --engine hybrid
```

## NCCE Proceedings Extraction

```bash
python3.10 pipeline/extract_ncce.py
```

ค่า default อ่านจาก `NCCE Project Database/` ที่ root.

ผลลัพธ์จะถูกเขียนเป็น paper-level markdown ใน `pipeline/data/markdown` พร้อม metadata:

- `collection: ncce`
- `source_type: proceedings_paper` หรือ `proceedings_window`
- `parent_source_pdf`
- `paper_code`
- `page_start`, `page_end`
- `proceeding_no`, `proceeding_year`
- `discipline`

Boundary detection ใช้ pattern เช่น `STR01-1`, `BTL-02-1`, `EEC01-1`. ถ้า detect ได้ไม่ดีพอ จะ fallback เป็น page-window docs โดยยังเก็บ page range สำหรับ citation.

Extract เฉพาะ NCCE31 โดยไม่แตะรุ่นเดิม:

```bash
python3.10 pipeline/extract_ncce.py \
  --source-glob 'Proceedings_NCCE31.pdf'

python3.10 pipeline/sync_extracted_catalog.py \
  --source-glob 'NCCE31_*.md'
```

คำสั่ง sync ลงทะเบียน candidate เป็น `evidence_status=extracted` เท่านั้นและ
ไม่เรียก embedding provider. เติม `--apply` เมื่อต้องการเขียน source catalog.

## TCI / ThaiJO Metadata Catalog

TCI เริ่มที่ metadata catalog เท่านั้น ไม่ download PDF และไม่ส่ง record เข้า
page-linked evidence index จนกว่าสิทธิ์ full text และ page provenance จะผ่าน
review:

```bash
python3.10 pipeline/harvest_tci_oai.py \
  --endpoint 'https://ph01.tci-thaijo.org/index.php/index/oai' \
  --list-sets

python3.10 pipeline/harvest_tci_oai.py \
  --endpoint 'https://ph01.tci-thaijo.org/index.php/index/oai' \
  --set-spec '<reviewed-civil-journal-set>' \
  --discipline geotechnical \
  --max-records 100 \
  --output pipeline/data/catalog/tci_ph01.jsonl
```

Default delay 6.2 วินาทีต่อ request อยู่ใต้ published limit 10 requests/minute.
ต้องเลือก journal set ที่ review แล้ว; endpoint-wide harvesting ต้อง opt in ด้วย
`--allow-unscoped` เพื่อกันวารสารนอก civil engineering ปน catalog.
ชุดเริ่มต้นที่ตรวจชื่อและ scope แล้วอยู่ใน
`pipeline/tci_source_allowlist.json`; การเพิ่ม set ใหม่ต้อง review ชื่อวารสาร,
scope, duplicate behavior, และ rights policy ก่อน.
ใช้ `--apply` หลัง apply migration `20260724120000_civil_source_catalog.sql`
และ `20260813090000_civil_source_rights_manifest.sql` แล้วเท่านั้น. ตัว harvester
จะยอมรับ endpoint/set โดยปริยายเฉพาะคู่ที่อยู่ใน allowlist; set ใหม่ต้องผ่าน
review หรือใช้ `--allow-unreviewed-set` อย่างชัดเจน และยังคงเป็น metadata-only.

OAI header ที่ provider ส่งเป็น `status="deleted"` จะไม่ถูกทิ้ง: output JSONL
เก็บ identifier, datestamp, set และ endpoint เป็น tombstone แบบ default-deny.
เมื่อใช้ `--apply` record ที่ตรงกันจะถูกตั้ง `evidence_status=removed` โดยไม่
hard-delete metadata/evidence, ไม่เปลี่ยนสิทธิ์ที่คนตรวจแล้ว และไม่ตัด
`document_id`; audit อยู่ใน `raw_metadata.oai_tombstone` และ counts ของ
`civil_ingest_runs`. การรัน tombstone เดิมซ้ำให้ผลสถานะเดิม ส่วนการนำ record
กลับเข้า discovery/evidence หลัง provider ประกาศลบต้องผ่าน review โดยตั้งใจ.

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
- effective titles มาจาก `web/lib/paper-title-overrides.json` source เดียวกัน
  และถูก sync เข้า `civil_source_catalog`

Sync title catalog โดยไม่ re-embed:

```bash
python3.10 pipeline/sync_catalog_titles.py
.venv310/bin/python pipeline/sync_catalog_titles.py --apply
```

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
python3.10 supabase/recheck.py --reindex-v2 --v2
```

## Readiness Check

```bash
python3.10 supabase/recheck.py --v2
```

## Data Quality Check

ใช้ venv หลักของ repo เพื่อให้ DB driver พร้อม:

```bash
.venv310/bin/python harness/run_data_quality.py
```

ผ่านเมื่อ corpus มี page metadata/markers ครบ และ Supabase v2 ไม่มี missing embeddings.
