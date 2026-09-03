# Immediate Lawful Route to 1,000 Native Papers

**Research date:** 2 September 2026 (ICT)  
**Scope:** primary and first-party APIs, current service documentation, and
machine-readable rights evidence. Counts are dated screening results, not a
national denominator or a legal opinion.

## Decision

Seedy reached **1,000 genuinely stored full papers** by adding 897
Thai-affiliated international open-access papers from the PubMed Central (PMC)
Article Datasets. The production cohort accepts only `CC BY`
published article versions with a dataset PDF, full JATS, a Thai author
affiliation, and no retraction/preprint/correction signal.

The broader dated screening query below returned **33,942 candidates**. The
stricter production query removed CC0 and author manuscripts and returned
**33,517 candidates**. The importer evaluated a fixed 1,500-candidate file until
897 records passed; it did not assume that the first 897 search results would
all pass.

This route changes the honest corpus statement to:

> 1,000 rights-verified native full papers: 103 Thai-local/ThaiJO papers plus
> 897 Thai-affiliated global OA papers.

It does **not** prove that Seedy has recovered 1,000 Thailand-local, Thai-language,
or internationally invisible papers. Those remain a separate acquisition lane
requiring Thai journal and institutional rights agreements.

## Exact acquisition census

### PMC primary cohort

The official [PMC search fields](https://pmc.ncbi.nlm.nih.gov/about/userguide/)
define `[ad]`/`[Affiliation]` as the institutional affiliation and address of
all authors, provide explicit Creative Commons licence filters, and expose the
`open access`, `has pdf`, preprint, correction, and retraction properties.

The broader research census used this ESearch query:

```text
Thailand[Affiliation]
AND (cc0_license[filter] OR cc_by_license[filter])
AND open_access[filter]
AND has_pdf[filter]
AND 2000:2025[dp]
NOT articletypecorrection
NOT articletyperetraction
NOT hasretractionin
NOT preprint[filter]
```

The [live official ESearch request](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=Thailand%5BAffiliation%5D%20AND%20%28cc0_license%5Bfilter%5D%20OR%20cc_by_license%5Bfilter%5D%29%20AND%20open_access%5Bfilter%5D%20AND%20has_pdf%5Bfilter%5D%20AND%202000%3A2025%5Bdp%5D%20NOT%20articletypecorrection%20NOT%20articletyperetraction%20NOT%20hasretractionin%20NOT%20preprint%5Bfilter%5D&retmode=json&retmax=0)
returned `count=33942` on the research date. Fixing publication dates at
2000–2025 makes the release cohort reproducible even as new 2026 records arrive.

The exact count remains a screening count. `article-type`, the licence URI in
JATS, the S3 article-version manifest, the downloaded checksum, and the PDF's
own rights statement are still release gates.

The production builder pins the narrower query below (`count=33,517` on the
same date), which excludes author manuscripts and accepts CC BY only:

```text
Thailand[Affiliation] AND cc_by_license[filter] AND open_access[filter]
AND has_pdf[filter] AND 2000:2025[dp]
NOT articletypecorrection NOT articletyperetraction NOT hasretractionin
NOT preprint[filter] NOT author_manuscript[filter]
```

### Corroborating and alternate discovery counts

These counts overlap heavily and **must not be added together**.

| Source and dated query | Result | Safe interpretation |
| --- | ---: | --- |
| [PMC ESearch: stable CC0/CC BY PDF cohort](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=Thailand%5BAffiliation%5D%20AND%20%28cc0_license%5Bfilter%5D%20OR%20cc_by_license%5Bfilter%5D%29%20AND%20open_access%5Bfilter%5D%20AND%20has_pdf%5Bfilter%5D%20AND%202000%3A2025%5Bdp%5D%20NOT%20articletypecorrection%20NOT%20articletyperetraction%20NOT%20hasretractionin%20NOT%20preprint%5Bfilter%5D&retmode=json&retmax=0) | **33,942** | Primary rights-screening pool for the 897-paper import. |
| [OpenAlex: single-country Thai, 2000–2025, CC BY published article with cached PDF](https://api.openalex.org/works?filter=authorships.institutions.country_code:TH,countries_distinct_count:1,has_content.pdf:true,best_oa_location.license:cc-by,best_oa_location.version:publishedVersion,is_retracted:false,type:article,from_publication_date:2000-01-01,to_publication_date:2025-12-31&per_page=1&select=id,doi,title,language,publication_year,best_oa_location,has_content,content_urls,is_retracted,type,countries_distinct_count) | **28,616** | Strong fallback/cross-check. A Thai institution appears and no second country is recorded, but OpenAlex metadata is not a national census. |
| [Europe PMC: Thai affiliation, in Europe PMC, OA](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=AFFILIATION:%22Thailand%22%20AND%20IN_EPMC:Y%20AND%20OPEN_ACCESS:Y&format=json&pageSize=1) | **3,823** | Metadata cross-check with different affiliation indexing semantics; not an independent corpus. |
| [DOAJ: author affiliation contains Thailand](https://doaj.org/api/v4/search/articles/bibjson.author.affiliation%3AThailand?pageSize=1) | **44,976** | CC0 article metadata and source links, not article-file permission. |
| [DOAJ: journal country is Thailand](https://doaj.org/api/v4/search/articles/bibjson.journal.country%3ATH?pageSize=1) | **14,095** | Useful Thai-local journal discovery set, not 14,095 rights-cleared PDFs. |

In the undated, otherwise identical single-country OpenAlex cohort, a
[`group_by=language` request](https://api.openalex.org/works?filter=authorships.institutions.country_code:TH,countries_distinct_count:1,has_content.pdf:true,best_oa_location.license:cc-by,best_oa_location.version:publishedVersion,is_retracted:false,type:article&group_by=language&per_page=100)
reported 31,176 total works, of which 29,610 were labelled English and only 26
Thai. Language classification can be noisy, but this is enough to show why the
fast global-OA cohort must not be represented as the Thailand-local corpus moat.

## Official delivery path

PMC expressly says automated retrieval may use its OAI-PMH API, E-Utilities,
BioC API, Cloud Service, and Article Datasets, while systematic download from
normal article web pages is prohibited
([PMC OA Subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/),
[PMC copyright notice](https://pmc.ncbi.nlm.nih.gov/about/copyright/)).

The implemented bounded path is:

1. Run the fixed CC-BY-only ESearch query with `retmax=1500` and persist the
   returned IDs as the resumable candidate cohort; never relax the rights gate.
2. Resolve every exact `PMCID.version` in the
   [PMC Open Data S3 service](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/), then
   fetch the small JSON manifest before fetching content.
3. Require the manifest and its version-bound JATS decisions below to agree.
   Download only the
   manifest-declared `pdf_url`/`xml_url`, verify the supplied MD5, calculate a
   Seedy SHA-256, and retain the source version.
4. Deduplicate against current native and catalog records by normalized DOI,
   PMCID, canonical title/author/year fingerprint, and file checksum.
5. Extract and promote through four idempotent windows (250, 250, 250, 147).

Production verification on 2 September 2026 reports 897 PMC assets, 897
canonical works, 13,380 pages, zero asset/page-count mismatches, and explicit
Thailand-affiliation evidence on all 897 catalog records. The accepted set is
896 CC-BY-4.0 papers and one CC-BY-3.0 paper; it contains 815 Research Articles,
74 Review Articles, seven Systematic Reviews, and one Methods Article.

The current [S3 README](https://pmc-oa-opendata.s3.amazonaws.com/README.txt)
documents the article-version layout and these JSON properties:

- `pmcid`, `version`, `pmid`, `doi`, `title`, and `citation`;
- `is_pmc_openaccess`, `is_manuscript`, `is_historical_ocr`, and `is_retracted`;
- `license_code`;
- `pdf_url`, `xml_url`, and `text_url`, each carrying an MD5 value;
- `media_urls` where the licence permits their inclusion.

The official [PMC13528635.1 metadata example](https://pmc-oa-opendata.s3.amazonaws.com/metadata/PMC13528635.1.json)
shows `is_pmc_openaccess=true`, `is_manuscript=false`,
`is_retracted=false`, `license_code="CC BY"`, and version-bound content URLs.
PMC cautions that a higher version number is not necessarily the preferred or
newer scholarly version, so the importer must inspect `is_manuscript`, exact
licence, and JATS version semantics instead of choosing the largest number.

## Fail-closed admission contract

A candidate becomes `native_verified` only when all gates pass:

- exact author affiliation in JATS contains a Thai institution or an address in
  Thailand; a keyword about Thailand is not sufficient;
- JATS `article/@article-type` is an accepted scholarly type such as
  `research-article` or `review-article`;
- S3 `license_code` is exactly `CC BY` and agrees with JATS
  `ali:license_ref` and the PDF's licence statement;
- `is_pmc_openaccess=true`, `is_manuscript=false`, `is_retracted=false`, and
  the JATS preprint property is false;
- a non-empty body and PDF exist, the manifest MD5 verifies, and an internal
  SHA-256 is stored;
- no current Seedy DOI, PMCID, canonical-work fingerprint, or checksum match;
- corrections, retractions, expressions of concern, editorials, news, letters,
  meeting abstracts, protocols without results, and front matter are excluded
  from the initial paper cohort;
- attribution, licence URL, source URL, article version, retrieval time,
  extraction notice, and takedown contact are stored;
- third-party figures, photographs, scales, questionnaires, maps, and other
  separately credited material are excluded from Seedy redistribution unless
  their own rights pass.

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits sharing and
adaptation for any purpose, including commercial use, with attribution, licence
link, and change notice. [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
waives copyright and related rights to the extent legally possible. The initial
cohort excludes `NC`, `ND`, custom/unknown, and `other-oa` terms. It also excludes
`CC BY-SA` until Seedy has a reviewed ShareAlike policy for extracted artifacts.

## Rate, runtime, and cost envelope

The [PMC OAI high-volume guidance](https://pmc.ncbi.nlm.nih.gov/tools/oai/)
sets a maximum of 3 requests/second, says not to make concurrent requests, asks
jobs over 100 calls to run outside Monday–Friday 05:00–21:00 U.S. Eastern time,
and asks clients to send `Accept-Encoding: gzip, deflate`. Use exponential
backoff and honor errors/retry guidance.

The official [NCBI E-Utilities usage policy](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
allows 3 requests/second without an API key and 10 requests/second with a key,
asks software to identify a registered `tool` and `email`, and directs large
jobs to weekends or 21:00–05:00 U.S. Eastern time. The one-time ESearch census
is cheap; version preflight and content transfer should remain resumable.

The S3 dataset is world-readable in `us-east-1`, accessible by HTTPS or anonymous
S3 without login, and its daily inventory supplies ETag/last-modified state.
PMC requires users redistributing the data to distribute only appropriately
licensed data and either keep it current or conspicuously disclose that it may
not be current ([S3 terms and inventory](https://pmc-oa-opendata.s3.amazonaws.com/README.txt)).

At 2 serial OAI calls/second, 1,300 JATS preflights have a theoretical request
floor of about 11 minutes. Network transfer, PDF extraction, retries, checksum
verification, and database promotion will dominate; plan an unattended,
resumable job rather than a synchronous deploy request.

OpenAlex is a valid fallback delivery channel. Its
[full-text documentation](https://help.openalex.org/access/fulltext/) provides
`content_urls.pdf` and `content_urls.grobid_xml`, an official resumable CLI, and
explicitly says that the PDFs retain their original copyright and OpenAlex adds
no rights. Its current pricing is $0.01 per content download, so 1,300 files
would cost about $13 before any rejects
([OpenAlex example costs](https://help.openalex.org/access/example-costs/)).
Its [authentication guidance](https://help.openalex.org/api/authentication/)
caps traffic at 100 requests/second, recommends `per_page=100` plus cursor
paging above 10,000 results, and returns `429` for either the rate or daily
budget. Use only a precise licence-bearing location and reverify the embedded
article licence before promotion.

## Why DOAJ and Thai repositories do not supply the immediate 897

[DOAJ's terms](https://doaj.org/terms/) place journal and article metadata under
CC0, but expressly do not grant rights to the paper described by the metadata.
The current article API exposes author affiliations and `fulltext` links, while
article results do not reliably bind a licence to the exact file. DOAJ also
removed `dc:rights` from article OAI records because a journal-level policy was
technically inaccurate for individual articles
([DOAJ OAI revision history](https://doaj.org/docs/oai-pmh/)). Treat DOAJ as a
discovery and reconciliation provider, then apply the upstream asset gate.
DOAJ's current public documentation publishes a 100-record maximum page size
but no contractual requests-per-second ceiling; clients should cache, paginate
serially, and honor `429` and `Retry-After` rather than treating missing limits
as unlimited permission.

Mahidol IR is a valuable partnership target. Its official
[OAI ListIdentifiers](https://repository.li.mahidol.ac.th/server/oai/request?verb=ListIdentifiers&metadataPrefix=oai_dc)
reported `completeListSize=91702` on the research date, but that is metadata,
not 91,702 reusable files. Its public DSpace API returned zero results for an
exact `dc.rights.uri` CC BY 4.0 query. A broader text search for the CC BY URL
returned 230 records, 211 with an original-bundle object, but an abstract that
mentions a licence is not a version-bound repository rights grant. Mahidol
therefore remains `source_hosted` unless the exact bitstream licence passes or
the university supplies a signed export/deposit agreement
([Mahidol DSpace API](https://repository.li.mahidol.ac.th/server/api)).

Chula DigiVerse reports more than 67,000 theses, more than 2,500 research
reports, and more than 2,000 articles, but its current policy applies
non-commercial terms to CUIR and prohibits redistribution/modification of
downloaded resources. It is not an automatic commercial-native source
([official Chula DigiVerse policy](https://digiverse.chula.ac.th/About/)).

OAI-PMH or a visible download button establishes transport/access, not reuse
rights. The fastest honest path to the local-invisible moat remains an
institution/publisher-supplied article-and-checksum manifest with explicit
permission for storage, display, extraction, embeddings, translation,
redistribution, commercial operation, and takedown.

## Product reporting boundary

Expose three separate counters and facets after this import:

1. **Thai-local native** — the 103 current ThaiJO/local rights-reviewed papers
   plus later permissioned Thai repository/journal assets.
2. **Thai-affiliated global native** — the 897 PMC/OpenAlex global OA papers
   added by this immediate route.
3. **Thai-local linked** — ThaiJO, TNRR, TCI, TDC, conference, and institutional
   records that are discoverable but not yet cleared for native storage.

The judge-safe claim is **“1,000 native full papers connected through Seedy, of
which 103 are the current Thai-local proof and 897 are Thai-affiliated global OA
papers; local-national completeness remains unproven.”** Any stronger statement
would collapse the exact distinction the product is designed to solve.
