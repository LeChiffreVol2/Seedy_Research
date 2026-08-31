# Deadline-safe lawful full-paper expansion

**Research issue:** [#5 Audit deadline-safe lawful full-paper expansion](https://github.com/LeChiffreVol2/Seedy_Research/issues/5)  
**Decision date:** 2026-09-01  
**Scope:** WebMCP Challenge readiness, not national completeness  
**Method:** Official provider, publisher, repository, license, and product-source evidence only. No production assets were downloaded or promoted during this audit.

## Decision

Before the Challenge, expand the full-paper story in two deliberately different
ways:

1. keep a **small native-reader showcase** limited to individually audited assets
   with an unambiguous reusable license or explicit permission, exact source
   identity, a pinned PDF checksum, verified page count, and reproducible page
   mapping; and
2. maximize lawful reach through **source-hosted and institution-mediated access**
   without representing those links as Seedy Research evidence.

Do not begin a new TCI, TNRR, TDC, conference, institutional-repository, or
OpenAlex PDF bulk-ingestion program before judging. Those sources can enlarge
discovery or lawful link-out coverage, but their current official interfaces do
not establish the asset-level storage, transformation, display, and
redistribution permissions needed for native reading.

The current verified baseline remains exactly **three LEARN Journal assets and 68
page-addressable pages**. That number comes from the committed reviewed manifest
and its integrity tests, not from this research. No additional full paper is
classified as production-ready by this audit.

## Why this is the fastest defensible route

- ThaiJO's official OAI service is expressly a **metadata** service. It publishes
  identifiers, titles, authors, DOI values, and dates, and applies a documented
  rate limit of 10 requests per minute before throttling. It does not confer
  full-text rights. [ThaiJO OAI service](https://www.tci-thaijo.org/public/oai.html)
- CC BY 4.0 permits sharing and adaptation, including commercial use, if the user
  gives attribution, links the license, and indicates changes. It does not clear
  third-party, privacy, publicity, or moral rights automatically.
  [Creative Commons CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/)
- A live PDF or an `open access` label is therefore an availability signal, not a
  sufficient native-reader decision. The exact asset and the exact governing
  license statement must agree.
- Seedy Research already has a fail-closed reader and a tested pack-to-database
  path. Reusing that boundary is lower-risk than creating a new crawler or rights
  model during the Challenge freeze.

## Required access-state vocabulary

These states are asset-level decisions. A work can have several assets in
different states.

| State | Required proof | Challenge behavior | Evidence status |
| --- | --- | --- | --- |
| `native_verified` | License or permission covers storage, extraction, native display, and the actions actually enabled; official identity; source URL; checksum; page count; stable page/text hashes | Render pages in Seedy Research; keep attribution, license, and change notice visible | Page-citable only after page and quality gates pass |
| `source_hosted` | Stable official publisher/repository landing or reader URL, but native rights incomplete or unnecessary | Link to the official host; do not proxy, copy, or expose extracted page text | Metadata-only unless a separate stable, rights-cleared page anchor exists |
| `restricted` | Official record shows institutional, account, embargo, or member access | Explain access path and preserve user context; never bypass or proxy authentication | Metadata-only in Seedy Research |
| `metadata_only` | Provider permits the bibliographic record but no verified usable manifestation exists | Show metadata, DOI/provider identity, and official resolver | Discovery lead, not evidence |
| `unavailable` | No verified manifestation, dead/withdrawn asset, or unresolved identity | Say that no verified full text is available; do not invent a fallback URL | Not citable |

Unknown or conflicting rights must resolve downward, never upward:

```text
native_verified -> source_hosted -> restricted/metadata_only -> unavailable
```

## Audited opportunity lanes

### Lane A — extend an already proven CC BY publisher lane

The LEARN Journal's official policy says its content is immediately open access
and that the journal is licensed CC BY 4.0. The existing pack has already pinned
three article URLs, PDF URLs, DOI identities, checksums, page counts, attribution,
and a transformation notice against that policy.
[LEARN Journal official policy](https://so04.tci-thaijo.org/index.php/LEARN/about)

**Deadline-safe use:** inventory one bounded LEARN issue, then promote only the
articles whose article page, PDF, and license evidence all still agree. The issue
manifest is the denominator; there is no pre-declared paper-count target. The
same journal policy is a useful shortlist signal, but every new article remains
unverified until its bytes and pages pass the gate.

**Why this is first:** it preserves the already reviewed publisher, license,
host, extraction tool, attribution form, and DOI-based identity strategy.

### Lane B — add one cross-domain, article-level CC BY proof candidate

The official article page for *Knowledge, attitude, and practice of northern Thai
honey producers on good agricultural practice standard in honeybee farms*
provides a DOI (`10.12982/VIS.2026.021`), an official PDF link, and an explicit
article-level CC BY 4.0 statement permitting reading, copying, distribution, and
derivative works with attribution.
[Veterinary Integrative Sciences article](https://he02.tci-thaijo.org/index.php/vis/article/view/275273)

**Current classification:** candidate only, not `native_verified`. Before
promotion, pin the exact PDF redirect target and bytes, calculate SHA-256 and
page count, confirm title/DOI/authors inside the PDF, inspect third-party content,
extract every page, and record attribution/change notices. If any step fails,
keep it `source_hosted`.

This is a stronger Challenge proof than adding many papers from the same journal:
it demonstrates that the rights/provenance contract generalizes across Thai
research domains without claiming broad coverage.

### Lane C — journal-wide CC BY policies as discovery shortlists

Several official ThaiJO-hosted journal pages contain unusually clear policies:

- Journal of Language and Culture says authors retain copyright, all articles are
  CC BY 4.0, the journal must be credited, and the license appears on both HTML
  and PDF versions. [JLC official policy](https://so03.tci-thaijo.org/index.php/JLC/AboutJournal)
- The inspected JLC article page has an official PDF link and repeats CC BY 4.0 at
  article level. It does not expose a DOI in the inspected page, so the current
  pack's DOI-only canonical identity path cannot ingest it safely without a
  separate stable provider-identity decision.
  [Inspected JLC article](https://so03.tci-thaijo.org/index.php/JLC/article/view/279392)
- Journal of Islamic Studies, Prince of Songkla University says authors retain
  copyright and articles are published under CC BY 4.0, including commercial
  reuse with attribution and change indication.
  [JOIS official copyright notice](https://so03.tci-thaijo.org/index.php/JOIS/about/submissions)
- Journal of Health Research states that third-party reuse is governed by CC BY
  4.0 and authors retain copyright.
  [JHR official journal record](https://www.tci-thaijo.org/en/journals/jhealthres)

**Current classification:** shortlist, not a rights grant for every discovered
PDF. Enumerate article records and resolve article/PDF/license agreement before
choosing an asset state. Prefer DOI-bearing assets before the Challenge because
that matches the tested pack identity path.

### Lane D — source-hosted institutional and repository access

Institutional repositories can quickly improve the user journey without copying
their files. Stable item/Handle pages can be represented as `source_hosted`, and
authenticated or embargoed items as `restricted`.

Do not infer asset permission from a repository footer. For example, official
repository records can expose a downloadable thesis while the item license is
CC BY-NC-ND, or can identify the institution itself as the rights holder. These
states do not match Seedy Research's current general-purpose translation,
embedding, redistribution, and future commercial contexts without a narrower
action decision or permission. They remain link-outs until item-specific rights
are reviewed.

**Deadline-safe use:** add official landing URLs and access instructions only for
records already in the catalog. Do not crawl bitstreams, proxy credentials, or
copy files during the Challenge freeze.

### Lane E — global full-text location enrichment

OpenAlex can identify works with PDF/TEI content and filter candidates using
`best_oa_location.license`. It is useful for finding a lawful location or a CC BY
candidate. However, OpenAlex explicitly says the PDFs retain their original
copyright and OpenAlex grants no additional content rights.
[OpenAlex full-text documentation](https://help.openalex.org/access/fulltext/)

**Deadline-safe use:** use OpenAlex as a candidate locator after exact DOI
matching. Preserve the original host and verify the owner's license before native
promotion. OpenAlex content must not become Thai evidence merely because its
content endpoint returns a PDF or GROBID XML.

## Sources that must not be bulk-promoted before judging

| Source | Official evidence | Safe Challenge state | Blocking fact |
| --- | --- | --- | --- |
| ThaiJO OAI | Official service exposes OAI metadata and rate limits | `metadata_only`, with separately reviewed article link-outs | OAI metadata does not convey PDF rights |
| TCI | Citation/journal-quality provider distinct from the ThaiJO publisher host | `metadata_only` | TCI membership is not an asset license; no partner export/usage contract is recorded |
| TNRR | Official API requires an authenticated bearer token; `ResearchOutput` exposes `bibid`, DOI, `linkPublic`, and `hasfullReport` | `metadata_only`; `source_hosted` only when `linkPublic` resolves to an official lawful reader | `hasfullReport` is only an availability flag; the API manual exposes no asset license, file checksum, or display/transform permission. [TNRR API manual](https://app.nriis.go.th/cdn/tnrr/files/API_TNRR.pdf) |
| ThaiLIS/TDC | Official portal is a national access surface | `restricted` or `source_hosted` after an item resolver is verified | No reviewed feed/rights contract or item-level native-display decision is recorded; the portal could not be inspected through the research client on 2026-09-01 |
| NCCE and other conferences | Official archive establishes a conference source | Existing reviewed evidence remains; new full-paper assets stay `source_hosted`/`metadata_only` | No publisher-wide license statement was found on the inspected NCCE31 landing page; organizer permission and an edition manifest remain required. [NCCE archive](https://conference.thaince.org/) |
| Institutional repositories | Official item/Handle records can identify a work and lawful access path | `source_hosted` or `restricted` | Repository/site license may not govern the deposited bitstream; embargo and item license vary |
| OpenAlex PDFs/TEI | Content endpoints and OA-license fields help locate candidates | `metadata_only` lead or source locator | OpenAlex grants no additional copyright permission |

## Rights-conflict findings that require quarantine

1. The inspected Journal of Information and Learning article page identifies the
   work as **CC BY-NC 4.0**, not unrestricted CC BY. A generic journal or search
   label must not override the exact article page.
   [Exact article license](https://so04.tci-thaijo.org/index.php/jil/article/view/285603)
2. The official Journal of Management Sciences and Communication preview says
   all articles are CC BY 4.0 and permits commercial reuse, but later on the same
   page says republication, translation, adaptation, database publication, and
   commercial use require written permission from the author and journal. This
   internal contradiction blocks automated promotion.
   [Conflicting official policy](https://www.tci-thaijo.org/journals/jmsc_journal)
3. CC BY-NC, CC BY-ND, and CC BY-NC-ND are not interchangeable with CC BY. Native
   page display, text extraction, embeddings, translation, user download, and
   commercial use must each be decided independently.

These assets can still be useful as `source_hosted`; quarantine is not deletion.

## Exact promotion contract

An asset may become `native_verified` only when one reviewed manifest entry
contains all of the following and the build fails closed on any mismatch.

### Identity and provenance

- deterministic canonical identity: normalized DOI when available; otherwise an
  explicitly approved stable provider record ID;
- official article/record URL and exact provider identifier;
- title, authors, venue, publication date, version, language, and source host;
- identity cross-check between landing page, PDF, and DOI/provider record;
- harvest/review timestamp and raw metadata hash;
- no unresolved duplicate, correction, retraction, or version conflict.

### Rights

- exact license expression and canonical license URL, or explicit permission ID;
- official article-level evidence URL, plus journal/publisher policy where useful;
- action booleans for source download, storage, extraction/OCR, native display,
  snippets, embeddings, summarization, translation, annotation, user download,
  redistribution, commercial use, and model training;
- attribution statement and transformation/change notice;
- third-party-material exception review;
- reviewer, checked/verified dates, expiry/review date, and takedown contact;
- conflicts resolve to deny until written clarification exists.

### Asset integrity

- resolved official origin URL and expected media type;
- byte length, SHA-256 of the exact source PDF, and PDF page count;
- stable asset ID and version kind;
- no silent redirect to a different work, login page, HTML error, or issue bundle;
- repeated fetch policy: a changed checksum creates a new version/review, never a
  silent overwrite.

### Page mapping and quality

- contiguous physical page index plus printed page label where available;
- deterministic page anchor and source locator;
- non-empty normalized text and SHA-256 for every page;
- extraction method/version, source asset checksum, OCR flag/confidence, and
  section label;
- title/author/DOI and page-count parity checks;
- quarantine for image-only, malformed, duplicated, truncated, or misidentified
  assets until a reviewed OCR/repair path exists.

### Runtime and rollback

- only `native_verified` returns page text;
- any failed/expired/revoked right falls back to `source_hosted`,
  `metadata_only`, or `unavailable` without exposing cached text;
- asset/page tombstones preserve provenance and user annotation history;
- a source change or takedown can disable one asset without deleting the
  canonical work or unrelated provider records.

## What the current implementation already proves

The local repository has the right safety shape for a **bounded showcase**:

- [`pipeline/build_reader_pack.py`](../../../pipeline/build_reader_pack.py)
  verifies exact PDF SHA-256 and page count before extraction, creates physical
  page indexes and printed labels, and hashes normalized page text.
- [`pipeline/ingest_reader_pack.py`](../../../pipeline/ingest_reader_pack.py)
  rejects missing rights actions/provenance or broken page integrity and maps the
  pack into canonical work, catalog record, asset, and page rows.
- [`web/lib/paper-reader.ts`](../../../web/lib/paper-reader.ts) fails closed when
  a native asset lacks verified rights, dates, provenance, storage/extraction/
  display actions, checksum, or location.
- [`web/lib/paper-reader.test.mjs`](../../../web/lib/paper-reader.test.mjs) proves
  that non-native and revoked assets expose no page text.

The committed baseline validation passes:

```text
python3.10 -m unittest pipeline.test_reader_pack
Ran 5 tests ... OK
```

## Deadline blockers in the current pack path

The same implementation is intentionally **not** a national-scale importer:

- the builder hard-codes one journal, one license evidence URL, one discipline,
  one pack date, and individual PDF metadata/checksums;
- ingestion assumes every work has a DOI and builds the canonical key from it;
- each committed page file is manually imported into the Next.js server bundle;
- the repository stores full page text (though not PDF binaries), so each new
  asset is a redistribution decision;
- the runtime verifies page-text hashes, while the binary checksum is established
  during the offline build because the PDF is intentionally not committed;
- no automated journal-policy conflict detector, retraction feed, third-party
  material review, or rights-expiry scheduler exists.

Therefore, adding many journals or no-DOI works before the Challenge would require
new product code and broader rights judgment. Keep the Challenge pack small; use
the database-backed asset/page model for scale after the freeze instead of
continuing to grow bundled JSON imports.

## Recommended Challenge sequence

1. **Freeze the existing 3-paper/68-page proof as the guaranteed judge path.**
   The demo should succeed even if every external publisher is unavailable.
2. **Create a candidate inventory, not a scrape queue.** Start with one bounded
   LEARN issue and the inspected DOI-bearing Veterinary Integrative Sciences
   article. Record pass/fail for every promotion field above; publish no target
   count until that inventory exists.
3. **Promote only a complete reviewed batch.** Rebuild from locally acquired
   official PDFs, rerun Python and reader integrity tests, dry-run ingestion, and
   verify the live reader. A partially reviewed batch does not ship.
4. **Add lawful breadth as link-outs.** Existing ThaiJO records can resolve to
   official article pages/PDF buttons as `source_hosted`; institutional/member
   copies remain `restricted`. Do not call these page-citable evidence.
5. **Use one cross-domain paper in the judge narrative only if it clears every
   gate.** The win condition is a repeatable human-agent path with reopenable
   evidence, not a last-minute paper count.
6. **Move partnerships and generic ingestion after judging.** TCI/TNRR/TDC,
   conference organizers, and repositories need provider agreements, rights
   manifests, deletion/takedown terms, denominator definitions, and stable
   incremental feeds.

## Ship/no-ship rule

Ship a new native batch only if all assets pass identity, rights, checksum,
page-map, quality, rollback, and live-reader checks. Otherwise retain the current
native baseline and ship the additional records only in their truthful
`source_hosted`, `restricted`, `metadata_only`, or `unavailable` states.

This produces the strongest truthful Challenge claim:

> Seedy Research does not claim to mirror all Thai PDFs. It resolves each Thai
> work to the best lawful access mode, and only rights-verified, checksum-pinned,
> page-mapped assets become reopenable evidence for humans and browser agents.

