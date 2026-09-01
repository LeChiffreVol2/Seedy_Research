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

## ThaiJO Metadata Catalog

คำสั่งนี้เก็บ metadata จากแพลตฟอร์ม ThaiJO โดยใช้ provider ID เดิม
`tci_thaijo`; ไม่ใช่ TCI citation index. TCI จะใช้ provider แยก
`tci_citation` หลังมี official export/partnership. ThaiJO เริ่มที่ metadata
catalog เท่านั้น ไม่ download PDF และไม่ส่ง record เข้า
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

# Refresh every reviewed set on the endpoint. The cap applies per set.
python3.10 pipeline/harvest_tci_oai.py \
  --endpoint 'https://ph01.tci-thaijo.org/index.php/index/oai' \
  --all-reviewed \
  --max-records 2000 \
  --output pipeline/data/catalog/tci_ph01_reviewed.jsonl \
  --apply

# Resume only the database apply if harvesting succeeded but the client failed.
.venv310/bin/python pipeline/harvest_tci_oai.py \
  --endpoint 'https://ph01.tci-thaijo.org/index.php/index/oai' \
  --output pipeline/data/catalog/tci_ph01_reviewed.jsonl \
  --apply-existing \
  --apply
```

Default delay 6.2 วินาทีต่อ request อยู่ใต้ published limit 10 requests/minute.
ต้องเลือก journal set ที่ review แล้ว; endpoint-wide harvesting ต้อง opt in ด้วย
`--allow-unscoped` เพื่อกันวารสารนอก civil engineering ปน catalog.
endpoint ทางการทั้ง 36 families จาก [ThaiJO OAI service](https://www.tci-thaijo.org/public/oai.html)
ถูกตรึงแบบ versioned ไว้ใน `pipeline/tci_official_endpoint_registry.json`.
เมื่อใช้ `--allow-unscoped` กับ endpoint ที่ match registry แบบ exact และไม่ได้ระบุ
`--discipline` ตัว harvester จะใช้ broad domain ที่ปลอดภัย (`science`,
`life_sciences`, `physical_sciences`, `health_sciences`, `social_sciences`) และ
บันทึก registry version, family, endpoint และ source URL ใน
`raw_metadata.discipline_provenance`. ตัวอย่าง dry harvest ที่ไม่แตะฐานข้อมูล:

```bash
python3.10 pipeline/harvest_tci_oai.py \
  --endpoint 'https://sc01.tci-thaijo.org/index.php/index/oai' \
  --allow-unscoped \
  --max-records 25 \
  --output pipeline/data/catalog/tci_sc01_metadata.jsonl
```

exact endpoint/set ใน allowlist ยังมี priority สูงกว่า broad domain และ
`--discipline` ที่ระบุเองยัง override fallback ได้เพื่อรักษา CLI เดิม. endpoint
ที่ไม่อยู่ใน registry จะไม่รับ broad domain อัตโนมัติ และ endpoint-wide harvest
ยังต้องมี `--allow-unscoped` อย่างชัดเจนเสมอ.
ผลลัพธ์ทุกโหมดต้องมี `provider_record_id` ไม่ซ้ำก่อนเขียน JSONL หรือ upsert:
ระเบียนซ้ำที่ hash เดียวกันจะถูกรวม, datestamp ใหม่กว่าจะชนะ, tombstone ชนะเมื่อ
datestamp เท่ากัน และ payload active ที่ขัดกันใน datestamp เดียวกันจะหยุดให้คนตรวจ
แทนการเลือกแบบเงียบ ๆ. รายการระดับทั้งฉบับที่ ThaiJO ส่งเป็น `FULL ISSUE` /
`ฉบับเต็ม` ไม่ถูกนับเป็น research paper แต่ deleted headers ยังคงเก็บเป็น tombstone
เพื่อ reconciliation และ audit.
ชุดเริ่มต้นที่ตรวจชื่อและ scope แล้วอยู่ใน
`pipeline/tci_source_allowlist.json`; การเพิ่ม set ใหม่ต้อง review ชื่อวารสาร,
scope, duplicate behavior, และ rights policy ก่อน.
`--all-reviewed` เว้นช่วงระหว่าง set ด้วย จึงไม่ทำให้คำขอแรกของแต่ละ set
ทะลุ rate limit โดยไม่ตั้งใจ และ deduplicate ด้วย provider record ID ก่อน apply.
วารสารวิศวกรรมสหสาขาเก็บ discipline เป็น `unknown` โดยตั้งใจและแสดงในผลิตภัณฑ์
เป็น General engineering แทนการเดาสาขาจากคำบางคำในชื่อบทความ.
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

## TNRR Metadata Connector

`harvest_tnrr.py` ใช้ endpoint `ResearchOutput` ตามคู่มือทางการและรับ bearer
token ที่ออกให้แล้วจาก environment ฝั่ง server เท่านั้น. ตัว connector ไม่รับ
username/password, ไม่พิมพ์ token, ไม่เก็บ abstract และไม่เรียกหรือดาวน์โหลด
รายงานฉบับเต็ม; `hasfullReport` ถูกเก็บเป็น availability flag เท่านั้น.

เริ่มด้วยช่วงเวลาและขอบเขตเล็กก่อน โดยไม่ใช้ `--apply`:

```bash
TNRR_API_TOKEN='<issued token>' python3.10 pipeline/harvest_tnrr.py \
  --update-from 20260801 \
  --update-until 20260831 \
  --max-pages 2 \
  --max-records 200 \
  --output pipeline/data/catalog/tnrr_august.jsonl
```

ตรวจ JSONL และข้อตกลงการใช้ข้อมูลก่อนเติม `--apply`. แม้ record จะระบุ
`hasfullReport=true` ก็ยังคงเป็น `metadata_only`; การเปิด native reader,
extraction, embedding, translation หรือ redistribution ต้องมีสิทธิ์ระดับ asset
แยกต่างหาก.

## Rights-Reviewed ThaiJO Reader Pack

candidate ฝั่ง local มีบทความ LEARN Journal บน ThaiJO **3 เรื่อง รวม 68 หน้า**
ที่บันทึกหลักฐานสิทธิ์ CC BY 4.0 ระดับวารสาร, checksum ของ PDF, page count,
attribution และสิทธิ์แยกตาม action. ชุดนี้เป็น proof ที่ตั้งใจให้เล็ก ไม่ใช่
ตัวแทน coverage ของ ThaiJO, TCI หรือ Thai research ทั้งประเทศ และยังไม่ได้
apply เข้า database หรือ deploy ขึ้น production.

ไฟล์ PDF ต้นฉบับไม่ commit เข้า repository. หากต้อง rebuild ให้เตรียมไฟล์จาก
official publisher ตามชื่อที่ builder กำหนด แล้วรัน:

```bash
python3.10 pipeline/build_reader_pack.py \
  --source-dir /path/to/verified-learn-journal-pdfs
```

builder ต้องพบ `pdfinfo` และ `pdftotext` และจะหยุดทันทีถ้า checksum หรือจำนวน
หน้าไม่ตรงกับ manifest ที่ review แล้ว. output default คือ
`web/data/reader-papers/` ซึ่งเก็บ manifest กับ page-addressable text และ hash
รายหน้า ไม่เก็บ PDF binary.

ตรวจ pack และ row mapping แบบไม่เขียน database:

```bash
python3.10 -m unittest pipeline.test_reader_pack
python3.10 pipeline/ingest_reader_pack.py
```

คำสั่ง ingest เป็น dry-run โดย default และควรรายงาน 3 papers, 3 assets, 68
pages และ 0 full-text downloads. `--apply` เป็นการเขียน Supabase จริง จึงใช้ได้
หลัง review migration
`supabase/migrations/20260831120000_civil_research_graph_assets.sql`, ตรวจ
environment ฝั่ง server (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) และได้รับ
อนุมัติการ apply สำหรับ target นั้นแล้วเท่านั้น:

```bash
python3.10 pipeline/ingest_reader_pack.py --apply
```

ตรวจ reader contract และ browser flow จาก repository root:

```bash
(cd web && node --test lib/paper-reader.test.mjs)
(cd web && npx playwright test tests/e2e/paper-reader.spec.ts)
(cd web && npx playwright test tests/e2e/webmcp.spec.ts)
```

ชุด WebMCP ต้องคงจำนวน site tools ที่หกตัว และ
`inspect_paper_evidence` ส่งเพียง access mode, สถานะการอ่าน และ stable reader
anchor ที่ตรวจแล้ว โดยไม่ส่ง full page text กลับใน tool result.

อย่าใช้ service-role key ใน browser หรือ `NEXT_PUBLIC_*`. การมี asset ใน pack
ไม่ได้อนุญาต paper อื่นใน ThaiJO โดยอัตโนมัติ และ mode ที่สิทธิ์ไม่ครบต้องลดเป็น
`source_hosted`, `restricted`, `metadata_only` หรือ `unavailable` แทน native.

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
- `evidence_exclusions.json` คือ manifest แบบ versioned สำหรับ duplicate ที่ผ่าน human review;
  `index.py` validate manifest แล้วตัด excluded source ออกจากแผนจริงเสมอ การระบุ
  `--source-glob` ที่ตรงเฉพาะไฟล์ excluded จะหยุดพร้อม error และชี้ canonical source

ตรวจ cleanup ของ duplicate ที่ review แล้ว (dry-run และ read-only โดย default):

```bash
.venv310/bin/python pipeline/cleanup_reviewed_duplicate.py
```

ใช้ `--apply` เฉพาะหลังตรวจ dry-run: script จะ validate exact canonical/document/catalog
IDs ก่อนเขียน audit tombstone ลง `civil_source_catalog` แล้วลบเฉพาะ duplicate document;
sections/chunks ของเอกสารนั้น cascade ตาม foreign key และการรันซ้ำเป็น idempotent

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
