# Thai Research Full-Text System

## Decision

Seed Research needs a full-paper reading layer to become an end-to-end research
product. Search, exact-page evidence, Research Passport, and systematic-review
workflows are already valuable, but a user should not have to leave the research
loop between discovery and analysis whenever lawful full text exists.

That does **not** mean copying every PDF into CivilMCP. The winning product is a
rights-aware national research navigator with a first-class reader: it renders
full papers natively when the asset permits it, keeps publisher-hosted papers at
the publisher when redistribution is not permitted, guides authenticated users
to institution-restricted material without bypassing access controls, and states
clearly when no verified full text is available.

The promise is therefore:

> Discover the broadest measurable Thai research catalog, resolve the best lawful
> manifestation of each work, read and annotate it, compare exact-page evidence,
> conduct a bounded systematic review, draft with citations, and export or
> publish an auditable artifact.

“All Thai research” is a coverage objective, not a present-tense claim. Every
coverage statement must name a provider, denominator, access layer, and date.

## Live baseline and the missing link

As of 31 August 2026, production exposes **3,875 searchable records**:

- **1,297 page-citable evidence records**;
- **2,578 metadata-only discovery records**; and
- **2 of 36 official ThaiJO OAI endpoint families active** in the bounded live
  harvest.

These are real production counts, not national completeness. The deployed product
can discover, inspect page-linked evidence, build a Research Path, compare papers
in Research Workspace, create a Research Passport, and export review artifacts.
It now also has a durable paper object and reader that moves from a search result
to the best lawful full-text manifestation without weakening the existing
evidence boundary.

### Production native-reader slice

Production contains a deliberately small proof of that layer:
exactly **3 ThaiJO-hosted LEARN Journal papers and 68 page-addressable pages**.
Each version-of-record PDF is pinned by checksum and page count, and the journal's
official license statement is recorded as the CC BY 4.0 rights evidence. The
repository pack contains the reviewed manifest and checksum-bound page text, not
the source PDF binaries.

The reader supports native page reading, outline navigation, in-paper
search, stable page anchors, highlights, browser-local notes, and citation/source
export. Its access resolver fails closed across five modes: `native_verified`,
`source_hosted`, `restricted`, `metadata_only`, and `unavailable`. Only the first
mode receives full page text; every other mode exposes the appropriate official
link or access explanation without proxying the asset.

This is a production slice, not a national coverage claim. Migration
`20260831120000`, the three assets, and all 68 pages are applied to Supabase;
the matching MCP and web releases are live on Vercel. Post-apply checks report
zero page-checksum mismatches, RLS on every graph table, and no direct
`anon`/`authenticated` table reads. Three papers prove a lawful end-to-end slice; they do
not materially change the 2-of-36 ThaiJO harvest denominator or establish
coverage of TCI, TNRR, TDC, Thai conferences, or Thai research nationally.

OpenAlex and Scopus are not empty of Thai research. Some Thai journals,
Thai-affiliated international publications, DOI records, and repository copies
appear in global indexes. Their coverage is incomplete for Thailand and cannot
be used as a national denominator. CivilMCP should use them for identity,
citation, global discovery, and lawful-location enrichment after ingesting Thai
primary sources—not as substitutes for ThaiJO, TCI, TNRR, TDC, conference
proceedings, or institutional repositories.

## End-to-end research loop

```text
discover
  -> resolve canonical work and every provider record
  -> select the best lawful reader mode
  -> read with stable page/section anchors
  -> annotate and save evidence
  -> compare methods, findings, limitations, and contradictions
  -> screen and extract in a bounded systematic review
  -> produce a cited draft with evidence/inference boundaries
  -> export, share, submit, or publish an auditable artifact
```

The paper remains the shared state across the loop. A browser agent may navigate,
open a page, or organize annotations, but it may not turn a metadata record into
evidence, infer rights from availability, or cite a passage the user cannot
reopen.

## Canonical research object model

The catalog needs to separate intellectual identity from where and how a copy is
served. The following are logical entities; they can be introduced behind the
current API before any public schema claim is made.

### `research_work`

One intellectual work independent of provider or file. It owns canonical title,
Thai and English titles, authors and affiliations, publication year, work type,
language, DOI and other durable identifiers, subject classifications, and a
merge/review state. It does not own a PDF URL.

### `provider_record`

One record as asserted by ThaiJO, TCI, TNRR, TDC, an institution, a conference,
OpenAlex, or Scopus. It retains provider ID, source URL, source timestamps, raw
metadata hash, deletion/tombstone state, harvest run, and the exact mapping
decision to a canonical work. Provider records are never discarded merely
because they describe the same work; they are the provenance and coverage audit.

### `research_asset`

One manifestation or file: publisher HTML, version-of-record PDF, accepted
manuscript, thesis PDF, abstract, supplementary file, OCR text, or repository
bitstream. It records host, media type, version, URL, checksum, byte/page counts,
language, access method, license evidence, embargo, rights decision, and reader
mode. A work can have many assets, and a provider record can resolve to more than
one asset.

### `research_page`

A stable page or section target derived from one rights-cleared asset. It records
the asset ID, source page label, physical page index, section path, text hash,
extraction method, OCR confidence, and bounding information where available.
Every citable excerpt resolves through `research_page` back to the exact asset and
provider record.

### `research_relation`

A typed, sourced edge such as cites, is-version-of, is-supplement-to, corrects,
retracts, translates, duplicates, extends, uses-dataset, or shares-conference.
The edge records who asserted it and whether it is source metadata, a deterministic
match, a model-suggested candidate, or human-reviewed. Candidate relations cannot
be presented as validated findings.

### `research_annotation`

An owner- or workspace-scoped highlight, note, tag, extraction value, screening
decision, or claim link. It targets a work and, when textual, an immutable asset
and page/text anchor. Annotation history retains source version, author, review
state, and timestamps so an updated provider file cannot silently move evidence.

### `source_coverage_run`

A dated provider snapshot recording its denominator, cursor window, sets,
records seen, active records, tombstones, errors, rights states, assets resolved,
reader eligibility, evidence promotion, and reconciliation overlaps. This entity
turns “coverage” from marketing copy into an auditable product capability.

## Identity and deduplication rules

Deduplication merges works; it does not erase source provenance or select rights.
Apply matches in this order:

1. **Exact durable identity:** normalized DOI, Handle, TNRR `bibid`, TDC record
   identifier, ThaiJO OAI identifier, conference paper code plus edition, or a
   provider-declared version link.
2. **Exact asset identity:** checksum or byte-identical source asset. One file can
   support multiple provider records but remains one manifestation.
3. **High-confidence bibliographic identity:** normalized Thai/English title,
   author set, publication year, venue, pages, and institution. Normalize Buddhist
   and Gregorian years before matching.
4. **Cross-language candidate:** Thai/English paired titles, transliterations, and
   author identities can propose a cluster, but require human review before merge
   when no durable identifier agrees.
5. **Version relation instead of merge:** preprint, accepted manuscript, thesis,
   conference paper, and journal extension remain separate works or manifestations
   when their intellectual content differs; connect them with a typed relation.
6. **Conflict rule:** incompatible DOI, author, year, or retraction facts block an
   automatic merge. The record enters review rather than choosing the richer row.

The canonical display record may prefer the most authoritative fields, but every
field keeps provenance. TCI and ThaiJO are distinct providers: a ThaiJO-hosted
article that also appears in TCI is one canonical work with two provider records,
not two papers and not one conflated provider.

## Reader contract

The product exposes four useful access modes plus an unavailable state. The mode
is calculated per asset, not per provider, and unknown or incomplete rights
always fall away from native display.

| Mode | User experience | Storage and delivery rule | Citation rule |
| --- | --- | --- | --- |
| **1. Native verified (`native_verified`)** | Full-page reader with outline, page sync, search, highlights, notes, citation copy, and exact-page anchors. | CivilMCP may store/process/display only when the asset's verified permissions allow every required action. | Page-citable only after provenance, page mapping, extraction, and quality gates pass. |
| **2. Source hosted (`source_hosted`)** | Open the official publisher/repository reader or deep link while preserving Research Workspace context. Embed only when origin policy and terms explicitly permit it. | Do not proxy or copy the full text. Cache only permitted metadata and short excerpts. | Metadata-only unless CivilMCP can create a stable, rights-cleared exact-page anchor. |
| **3. Restricted (`restricted`)** | Show availability, holding institution, access instructions, and the official resolver/login path. | Never bypass authentication, proxy member-only files, or retain credentials. | Metadata-only inside CivilMCP unless a separately cleared asset is deposited. |
| **4. Metadata only (`metadata_only`)** | Show the bibliographic record, DOI, and official source link without a read-paper claim. | Store and display only fields permitted by the provider agreement. | Discovery lead, not CivilMCP evidence. |
| **5. Unavailable (`unavailable`)** | Explain that no verified manifestation is available; offer DOI lookup, library request, or author-copy workflow when possible. | No full text and no invented fallback URL. | Not citable as CivilMCP evidence. |

A public PDF button is evidence of availability, not automatically permission to
store, transform, embed, translate, or redistribute. Conversely, a restrictive
reader mode does not remove the record from discovery.

## Asset-level rights gate

Each asset has an explicit allow/deny/unknown decision for every action below.
Unknown defaults to deny.

| Action | Required evidence | Product behavior when unknown or denied |
| --- | --- | --- |
| Index metadata | Provider terms or agreement | Do not ingest beyond a transient test. |
| Display abstract | License, provider terms, or permission | Show bibliographic metadata and official link only. |
| Fetch/store binary | License or explicit rightsholder/partner permission | Keep the file at the source. |
| Extract/OCR text | Transformation permission and lawful access | Do not process the asset. |
| Create embeddings/search index | Processing permission and approved model/data path | Do not send text or promote to evidence. |
| Display full pages | Display permission and stable provenance | Use publisher-hosted or institution-mediated mode. |
| Translate/explain full text | Transformation permission; generated output remains linked to source | Limit assistance to permitted excerpts or metadata. |
| Export/redistribute text or file | Explicit redistribution permission | Export citations, notes, and user-authored synthesis only. |
| Use for model training | Explicit training permission | Exclude from training. |

The rights record stores the evidence URL or agreement ID, decision maker,
decision date, scope, jurisdiction, embargo, and review date. Takedowns disable
the affected asset and page anchors without deleting unrelated work/provider
history. The repository's MIT license covers software only; it grants no rights
to research papers or derived text.

## Provider strategy

The machine-readable source of truth is
[`pipeline/thai_research_provider_registry.json`](../pipeline/thai_research_provider_registry.json).
The operating priorities are:

| Provider | Correct role | Safe path |
| --- | --- | --- |
| ThaiJO | Primary journal-host metadata plus per-article asset resolution. | Finish the official 36-family metadata registry and bounded harvest; inspect license and PDF/HTML rights at article level. Do not bulk-scrape PDFs. |
| TCI | Separate citation, journal-quality, and record-reconciliation source. | Obtain a partner export/API and usage terms. Dedupe against ThaiJO and retain both provider records. TCI membership never grants full-text rights. |
| TNRR | National research-output metadata and public resolver. | Use the documented bearer-token API only with an approved account. Treat `hasfullReport` as availability, not display/download permission; negotiate asset actions separately. |
| ThaiLIS/TDC | National network for theses, research, articles, and conference material. | Confirm its advertised OAI-PMH, Z39.50, or web-service path through a metadata-feed and denominator agreement. Preserve member/institution access; do not proxy restricted documents. |
| NCCE | Proven page-citable conference vertical. | Build an edition denominator and formalize long-term organizer rights before widening full-paper display. |
| Other Thai conferences | Multi-series registry and deposit network. | Recruit organizers that can supply accepted-paper counts, stable metadata, and asset permissions; never assume one national endpoint. |
| Institutional repositories | University/agency OAI, DSpace, EPrints, and deposits. | Inventory endpoints, embargoes, bitstream licenses, and TDC/TNRR overlap; prioritize rights-cleared author deposits. |
| OpenAlex and Scopus | Global enrichment, citation, identity, and gap reconciliation. | Match after Thai primary ingestion. Report overlap and missingness. Never use either as proof of Thai completeness or as automatic full-text permission. |

### Partnership path for gated national sources

For TCI, TNRR, and TDC, the first deliverable is not a scraper. It is a short data
agreement covering identifiers and fields, denominator or total-count method,
authentication, rate limits, update/deletion cadence, permitted metadata and
abstract display, asset-resolution behavior, display/transformation/embedding
rights, attribution, retention, takedown, and audit contacts.

Start with a metadata-only sample and publish a reconciliation report back to the
partner: duplicate clusters, missing DOI/author/department fields, broken links,
and access-state counts. Promote only mutually approved assets. This gives each
national provider a data-quality benefit and makes CivilMCP a partner rather than
an uncontrolled mirror.

## Coverage completeness contract

Every provider dashboard and public claim must publish a dated tuple:

```text
provider + official denominator + harvest window + active/tombstone counts
+ unique canonical works + overlap + metadata quality + rights-resolved assets
+ full-text-accessible assets + native-reader assets + page-citable evidence
```

At minimum, record:

- endpoint families, repositories, institutions, conference series/editions, or
  export rows expected and observed;
- harvested, active, deleted, excluded, quarantined, failed, and stale records;
- identifier, title, author, institution, year, DOI, abstract, and source-link
  completeness;
- exact and probable duplicate clusters within and across providers;
- assets discovered by access state and rights resolution;
- native-reader, publisher-hosted, institution-mediated, unavailable, and
  page-citable counts; and
- last successful incremental cursor, errors, rate-limit state, and next review.

“Complete” is allowed only for the named denominator and snapshot when every
expected unit was attempted, cursor/deletion handling is proven, duplicate and
quality audits pass, and unresolved failures are zero. It never means “all Thai
research ever produced.” If the official denominator is unavailable, label the
result **measured coverage, denominator unknown**.

Catalog coverage, readable coverage, and evidence coverage are separate metrics.
A large metadata catalog should never visually inflate the number of full papers
or page-citable sources.

## Phased implementation

### Phase 0 — Contract and identity foundation

- Adopt the provider registry and canonical work/provider record/asset model.
- Add asset-level rights decisions and reader-mode derivation with unknown-deny.
- Preserve current collection IDs and APIs through adapters; no silent provider
  fallback is permitted.
- Instrument the completeness contract before adding more counts.

**Exit gate:** every current record maps to a known provider; every citable page
maps to one asset; every asset has a rights state and source provenance.

### Phase 1 — Reader on an explicitly rights-cleared vertical

- Build the reader shell against explicitly rights-cleared assets; extend it to
  NCCE only after the relevant manifest grants the required reader actions.
- Add page/outline sync, in-paper search, stable anchors, highlights, notes,
  translation/explanation within allowed actions, and citation copy.
- Preserve the exact-page review gate used by Research Passport.

**Production status:** the 3-paper/68-page CC BY 4.0 ThaiJO pack implements native
reading, outline/search, stable anchors, highlights, browser-local notes, and
citation/source export. Supabase apply and Vercel deployment are complete;
workspace-scoped annotation sync and the manual Passport-to-reader host demo
remain later release gates.

**Exit gate:** a user can discover, read, annotate, reopen, compare, and export a
page-cited note without losing source identity or rights status.

### Phase 2 — ThaiJO breadth and asset resolution

- Harvest all 36 official endpoint families as bounded metadata-only sources,
  recording sets, tombstones, rate limits, and denominators.
- Resolve article landing pages, DOI, license evidence, and PDF/HTML assets.
- Route each asset to native verified, publisher-hosted, or unavailable mode; no
  implicit evidence promotion.

**Exit gate:** all 36 families have dated attempt status, while every reader count
is explicitly smaller than or equal to its rights-resolved count.

### Phase 3 — TNRR and TCI partnerships

- Connect TNRR with an approved bearer-token account and metadata agreement.
- Connect TCI as a separate partner provider for citation and journal records.
- Reconcile TNRR `bibid`, DOI, TCI, ThaiJO, and existing work identities.

**Exit gate:** partner-approved sample, stable incremental sync, deletion policy,
and published overlap report; no full report or publisher file is copied merely
because it is discoverable.

### Phase 4 — TDC and institutional repositories

- Agree a TDC metadata denominator and member-access contract.
- Inventory university/agency repositories and ingest OAI/API metadata by set.
- Prefer open-license or explicit author/institution deposits for native reading;
  keep restricted theses institution-mediated.

**Exit gate:** institution-level coverage and embargo/access metrics are visible,
with no authentication bypass or double count across TDC, TNRR, and repositories.

### Phase 5 — Thai conference network

- Expand from NCCE through a ranked conference-series registry.
- Offer organizers a deposit package: canonical metadata CSV/JSON, accepted-paper
  denominator, rights manifest, stable files, checksum, and takedown contact.
- Provide a conference landing page and citation export in return.

**Exit gate:** each live series has edition and accepted-paper denominators plus
an explicit asset permission; “Thai conferences” is never represented by a
convenience sample.

### Phase 6 — Global reconciliation and research production

- Enrich canonical works with OpenAlex and, if licensed, Scopus identities and
  citation relations.
- Surface Thai-to-global discovery leads separately from page-citable evidence.
- Connect annotations and reviewed extraction cells into cited drafting,
  BibTeX/RIS/Markdown/CSV export, and an author-controlled publish/share flow.

**Exit gate:** the complete demo runs discover → read → annotate → compare →
systematic review → cited draft → export/publish while every statement retains
its work, asset, page, provider, rights, and review state.

## Judge-facing product proof

The competitive story is not “we scraped the most PDFs.” It is that Seed Research
turns fragmented Thai research infrastructure into one human-agent research loop
without flattening discovery, rights, and evidence:

1. Search returns one canonical work assembled from Thai provider records and a
   visibly measured coverage snapshot.
2. The reader selects the lawful mode and opens the strongest available asset.
3. The person and browser agent navigate the same full paper and exact page.
4. A highlight becomes a provenance-locked annotation, then a comparison or
   systematic-review extraction cell.
5. A cited draft uses reviewed Thai evidence while OpenAlex/Scopus remain typed
   global leads and citation enrichment.
6. Export carries the evidence, inference, rights, and coverage boundaries.

This is a larger and more defensible ambition than a peer-review wrapper: a Thai
research operating system whose breadth is measurable, whose reader is lawful,
and whose outputs can be independently reopened.

## Official references

- [LEARN Journal license statement](https://so04.tci-thaijo.org/index.php/LEARN/about)
- [ThaiJO OAI service and 36 endpoint families](https://www.tci-thaijo.org/public/oai.html)
- [ThaiJO journal directory](https://www.tci-thaijo.org/en/journals)
- [Thai-Journal Citation Index journal list](https://tci-thailand.org/journal_list)
- [TNRR portal](https://tnrr.nriis.go.th/)
- [TNRR API manual](https://app.nriis.go.th/cdn/tnrr/files/API_TNRR.pdf)
- [ThaiLIS Digital Collection](https://tdc.thailis.or.th/)
- [NCCE official conference archive](https://conference.thaince.org/)
- [OpenAlex country fields](https://help.openalex.org/data/countries/)
- [OpenAlex full-text products](https://help.openalex.org/access/fulltext/)
- [OpenAlex license data](https://help.openalex.org/data/licenses/)
- [Elsevier Scopus APIs](https://dev.elsevier.com/sc_apis.html)
