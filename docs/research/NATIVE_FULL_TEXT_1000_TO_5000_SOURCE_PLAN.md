# Lawful Native Full-Text Expansion: 1,000 First, 5,000 by Agreement

**Research date:** 2 September 2026 (ICT)
**Source policy:** Primary and first-party sources only: TCI/ThaiJO, official
journal and repository pages, article records, and Creative Commons. Counts are
dated screening denominators, not a claim that every record is a rights-cleared
research paper. This is an operational rights review, not legal advice.

## Decision

Seedy can reach **1,000 native papers without changing the product architecture**,
but it should not turn a journal's public archive count into a native-paper count.
The fastest lawful path is:

1. harvest metadata through ThaiJO's official OAI-PMH service;
2. preflight the article landing page and exact PDF version for every candidate;
3. ingest only records with an exact, internally consistent item-level licence;
4. ask the strongest journals for a signed issue/article manifest and delivery
   permission so the same review does not have to be rediscovered page by page;
5. keep NC, ND, unknown, conflicting, and third-party-content cases
   `source_hosted` unless a direct written grant clears Seedy's exact actions.

The first bounded screening wave should be **Veterinary Integrative Sciences
(557 records), Area Based Development Research Journal (356), Engineering and
Technology Horizons (437), and the remaining BSCM archive (335 records beyond
the 100 already native)**. Their combined gross screening pool is **1,685
records**. Seedy needs 897 net-new papers, so this is a workable first buffer,
but only the number that passes item-level preflight may be called native.

A public-licence-only path to 5,000 is not yet evidenced. The fastest safe 5,000
path is a portfolio of journal/institution agreements backed by article manifests.
That is materially safer and faster than crawling thousands of PDFs whose current
policy pages may contradict their own article records.

## Rights rule: policy is discovery evidence, the article is the gate

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits sharing and
adaptation, including commercial use, subject to attribution and change notices.
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) adds a ShareAlike
obligation that must be reviewed against Seedy's outputs. By contrast,
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) bars
commercial use and distribution of adaptations. CC also warns that publicity,
privacy, moral, and other rights may still require additional permission.

Therefore a paper is automatically eligible for `native_verified` only when the
exact asset has one of these bases:

- item-level CC0/public domain;
- item-level CC BY 4.0;
- reviewed item-level CC BY-SA with ShareAlike compliance; or
- a written grant that expressly covers storage, display, extraction, embeddings,
  translation/adaptation, redistribution, commercial service use, and takedown.

`Open access`, a visible PDF button, TCI Tier 1/2, a journal-level licence, or a
repository-wide footer is not enough on its own. Third-party figures, maps,
photos, questionnaires, scales, logos, and reproduced tables can carry narrower
rights than the article.

## Official acquisition mechanism

ThaiJO documents OAI-PMH as its public **metadata** service. It exposes
`Identify`, `ListSets`, `ListRecords`, and `GetRecord`; lists 36 endpoint families;
and limits a client to 10 requests per minute before throttling to 3 per minute
and eventually temporarily blocking it
([official ThaiJO OAI guide](https://www.tci-thaijo.org/public/oai.html)). Use OAI
for discovery, identifiers, dates, DOI, and tombstones. It is not a platform-wide
full-text licence.

The OJS OAI endpoint is useful for more than titles: an official
[`Identify`](https://ph01.tci-thaijo.org/index.php/index/oai?verb=Identify)
response declares persistent deleted records, and journal OAI records can carry
the article URL, PDF relation, MIME, language, DOI, and `dc:rights`. Those fields
are candidates for the rights preflight, not a grant to fetch the linked file.
The controlling shard
[`robots.txt`](https://ph01.tci-thaijo.org/robots.txt) disallows automated access
to article and issue download paths. Seedy must therefore **not crawl ThaiJO PDF
download URLs**, even for a CC-BY candidate. Full-text bytes need a written
publisher/ThaiJO delivery approval, an official bulk export, or another host and
delivery channel that permits the automation.

For a shortlisted OJS journal, the lawful acquisition sequence is:

```text
OAI ListSets/ListRecords at <=10 requests/minute
  -> official issue/article URL
  -> allowed paper type only
  -> exact DC.Rights + rel="license" agreement
  -> official citation_pdf_url recorded, not crawled
  -> publisher/ThaiJO-approved asset delivery channel
  -> PDF licence/footer and third-party permission scan
  -> checksum, MIME, page count, extraction and page hashes
  -> rights manifest + attribution + observed_at
  -> native_verified
```

Do not enumerate or crawl PDF URLs, bypass authentication, proxy restricted
assets, or run an unbounded crawler. Prefer a publisher-supplied CSV/JSON
manifest and approved bulk delivery. Where that does not exist, OAI and
permitted issue/article page checks must be bounded, cache-aware, and at a rate
agreed with the journal; the paper remains `source_hosted` until there is a
permitted way to obtain its bytes.

## Prioritized source portfolio

The `official total` values below come from the current TCI preview pages. They
include non-research front matter and historical records, so they are screening
ceilings. `Verified eligible now` is deliberately conservative.

| Priority | Thai-hosted source | Official total / screening ceiling | Verified eligible now | Why it is useful | Fastest safe acquisition | Main risk |
| --- | --- | ---: | ---: | --- | --- | --- |
| 0 | [Biomedical Sciences and Clinical Medicine (BSCM)](https://www.tci-thaijo.org/journals/CMMJ-MedCMJ) | 435 total; 335 gross beyond the 100 already native | 100 already in Seedy | Current journal policy expressly says CC BY 4.0 permits commercial sharing and adaptation. Current original/review records expose official PDFs. | Extend the existing fixed-issue cohort, newest issues first, with the same exact `DC.Rights` and `rel=license` gate. Ask the Faculty of Medicine, Chiang Mai University for a signed article manifest and permission to use a bounded delivery job. | Historical item licences vary. A [2022 example is CC BY](https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/247658), while a [2021 example is CC BY-NC-ND](https://he01.tci-thaijo.org/index.php/CMMJ-MedCMJ/article/view/247131). Never back-propagate today's policy. |
| 1 | [Veterinary Integrative Sciences (VIS)](https://www.tci-thaijo.org/en/journals/vis) | 557 records / 40 issues | 0 until cohort preflight | The official policy explicitly permits copying, distribution, derivatives, and commercial use under CC BY 4.0 and requires authors to clear third-party material. Article pages repeat CC BY, including [2021](https://he02.tci-thaijo.org/index.php/vis/article/view/246619), [2023/24](https://he02.tci-thaijo.org/index.php/vis/article/view/263026), and [2025/26](https://he02.tci-thaijo.org/index.php/vis/article/view/275273). | Harvest `he02` OAI metadata, enumerate the 40 official issues, accept research/review/short communication/case-report types only, then run exact article/PDF rights preflight. Request a manifest from Chiang Mai University's Faculty of Veterinary Medicine. | The total includes the predecessor title and non-paper content. The journal says the current web adaptation began in 2018; earlier items need separate evidence. Veterinary/medical material also needs safety labelling. |
| 2 | [Area Based Development Research Journal](https://www.tci-thaijo.org/en/journals/abcjournal) | 356 records / 59 issues | 0 until cohort preflight | The official journal says all material is CC BY unless otherwise stated, authors retain rights, and the journal is owned/commissioned by TSRI/PMUA. A [2026 article page](https://so01.tci-thaijo.org/index.php/abcjournal/article/view/285181) repeats CC BY 4.0. Its Thai community-development focus is especially aligned with Seedy. | Harvest `so01` OAI, filter to original research articles, verify every `unless otherwise stated` exception, then ask TSRI/PMUA and the Walailak editorial office for an article manifest and bulk-delivery permission. | The exception phrase prevents journal-wide automatic promotion. Community photos, maps, local knowledge, and participant material need heightened third-party/privacy review. |
| 3 | [Engineering and Technology Horizons](https://ph01.tci-thaijo.org/index.php/lej/about) | 437 OAI records observed | 0 until cohort preflight and delivery permission | The current official journal page states CC BY, permits sharing/adaptation with attribution, and leaves copyright with authors. Its engineering scope is directly useful to the Civil Research Pack. | Use the official [journal OAI endpoint](https://ph01.tci-thaijo.org/index.php/lej/oai?verb=ListIdentifiers&metadataPrefix=oai_dc) for the denominator and rights candidates, then request a fixed article/checksum manifest and approved file delivery from the publisher. | Older OAI records include copyright-only or CC BY-NC-ND statements. Do not apply the current policy retroactively, and do not crawl the shard's disallowed PDF paths. |
| 4 | [LEARN Journal](https://www.tci-thaijo.org/journals/LEARN) | 654 records / 36 issues | 3 are already deterministic fixtures; the remainder is unverified | The official TCI/ThaiJO page states CC BY 4.0, author ownership, open access, and 654 articles. | Use `so04` OAI and issue-level original/academic-article filters; promote only exact CC BY article records. Ask Thammasat's Language Institute for a dated licence-effective-from statement, manifest, and delivery channel. | A current journal footer does not establish that all 654 historical assets use CC BY. Book reviews and front matter are not native-paper targets. |
| 5 | [Journal of Health Research (JHR)](https://www.tci-thaijo.org/en/journals/jhealthres) | 1,038 records / 110 issues | 0 until asset-resolution review | The official policy grants third-party reuse under CC BY 4.0 and reports a large, current Tier 1 public-health archive. | Use `he01` OAI for identity, but resolve each version and host. Ask Chulalongkorn's College of Public Health Sciences for a licence-effective-date, article/PDF manifest, and approved delivery channel before bulk work. | The policy references ScienceDirect and the archive includes supplements/proceedings; publisher-hosted and migrated versions may differ. Do not assume every ThaiJO record has a reusable ThaiJO PDF. |
| 6 | [Journal of Arts and Thai Studies](https://www.tci-thaijo.org/en/journals/artssu) | 261 records / 14 issues | 0 until cohort preflight | The official page says authors retain copyright and articles use CC BY, with a strong Thai-studies focus. | Start with the renamed 2022-present journal, not its predecessor; use `so01` OAI, exact article licence checks, and a Silpakorn Faculty of Arts manifest/delivery agreement. | The total includes the former Journal of the Faculty of Arts and book reviews. Images, artworks, music, and archival reproductions are high-risk third-party content. |
| 7 | [Science and Technology for Emerging Innovations in Praxis](https://www.tci-thaijo.org/en/journals/vrurdistjournal) | 395 records / 31 issues | 0 until cohort preflight | Its official policy expressly describes CC BY 4.0 as permitting unrestricted reuse, adaptation, and commercial use. | Verify item-level licence on the renamed/current issues, then request a manifest and delivery channel from Valaya Alongkorn Rajabhat University's Research and Development Institute. | Current policy may post-date some of the 395 records; the title/history boundary and article types must be fixed before counting. |
| 8 | [Mahidol University Institutional Repository](https://repository.li.mahidol.ac.th/) | More than 50,000 items; the thesis/thematic-paper collection alone lists 12,024 records | 0 at repository level | A first-party DSpace repository with stable item/bitstream APIs, Dublin Core metadata, clear ownership fields, and a direct repository contact. Some deposited publisher PDFs contain their own CC BY 4.0 notices, e.g. this [repository-served article](https://repository.li.mahidol.ac.th/server/api/core/bitstreams/e6f90ed0-61cf-4787-9621-929d16adb294/content). | Ask Mahidol Library's Repository Division for an OAI/API collection map, an export of bitstream-level licences/access states, and a direct deposit agreement. Only individually CC BY/CC0 assets or agreement-cleared deposits enter native reading. | The site footer is CC BY-NC-ND, many records are metadata-only or Mahidol-only, and publisher rights vary. A repository-held copy is not proof that Seedy may redistribute or transform it. |

### Screening denominator for the first 1,000

```text
VIS official total                                      557
Area Based Development official total                  356
Engineering and Technology Horizons OAI total          437
BSCM records beyond the 100 already native             335
----------------------------------------------------------
gross first-wave screening pool                      1,685
net-new papers required (1,000 - current 103)           897
required first-wave pass rate                         53.2%
```

The 53.2% is a planning threshold, not an observed eligibility rate. If the
first wave falls below it, add recent, item-verified LEARN or JHR issues; do not
relax the rights gate.

### Civil/engineering discovery universe is large, but not yet eligible

A dated OAI census across 13 ThaiJO engineering, built-environment, geotechnical,
and related journals returned **5,678 metadata records**. The largest observed
denominators were [Engineering and Applied Science Research (EASR)](https://ph01.tci-thaijo.org/index.php/easr/oai?verb=ListIdentifiers&metadataPrefix=oai_dc)
(1,559), [EIT Research and Development Journal](https://ph02.tci-thaijo.org/index.php/eit-researchjournal/oai?verb=ListIdentifiers&metadataPrefix=oai_dc)
(1,048), [SEAGS/AGSSEA Journal](https://ph01.tci-thaijo.org/index.php/SEAGS_AGSSEA_Journal/oai?verb=ListIdentifiers&metadataPrefix=oai_dc)
(718), Frontiers in Engineering Innovation Research (468), Engineering and
Technology Horizons (437), and [Nakhara](https://ph01.tci-thaijo.org/index.php/nakhara/oai?verb=ListIdentifiers&metadataPrefix=oai_dc)
(298). The other seven journals supplied 1,150 records.

This **5,678 is a discovery denominator, not an eligible-paper estimate**. It
still includes English-only and out-of-scope papers, front matter, whole-issue
containers, missing PDFs, duplicates, and records with NC-ND, copyright-only,
unknown, or contradictory rights. For example, [EASR's official policy](https://ph01.tci-thaijo.org/index.php/easr/about)
is CC BY-NC-ND, [SEAGS's submission terms](https://ph01.tci-thaijo.org/index.php/SEAGS_AGSSEA_Journal/about/submissions)
describe exclusive copyright transfer, and [Nakhara's submission page](https://ph01.tci-thaijo.org/index.php/nakhara/about/submissions)
uses a `CC BY` label while describing NC-ND conditions. Use this census to
prioritize permission outreach, never as a public native count.

## What can plausibly reach 5,000

The publicly described CC-BY candidate ceilings above sum to thousands, but
their historical and item-level coverage is unknown and they overlap with
front matter, migrated versions, and non-paper content. The 5,000 target should
therefore be a **contracted denominator**, not a crawler target:

1. **Journal manifest programme:** sign BSCM, VIS, Area Based Development,
   LEARN, JHR, and two to four additional journal owners. Each manifest names
   article ID, exact PDF checksum/version, licence, effective date, paper type,
   third-party exceptions, takedown contact, and every allowed Seedy action.
2. **Institutional deposit programme:** ask Mahidol and other universities for
   author/institution-deposited versions with a Seedy grant or CC BY/CC0,
   delivered via their official repository export rather than member-login
   access.
3. **Permission conversion programme:** negotiate coherent rights for large
   archives whose public declarations conflict. Count them only after the
   signed manifest is received.

The official ThaiJO OAI `Identify` response publishes `admin@tci-thaijo.org` as
the repository administrator. For civil-specific negotiations, EASR publishes
`kku.enjournal@gmail.com` on its [official contact page](https://ph01.tci-thaijo.org/index.php/easr/about/contact),
and EIT publishes its office route and telephone on its [official contact page](https://ph02.tci-thaijo.org/index.php/eit-researchjournal/about/contact).
A permission request should name the exact article/checksum cohort and separately
cover bulk delivery, PDF storage, extracted page text, embeddings/search index,
display/export, commercial status, attribution, historical backfiles,
revocation, and takedown.

One high-leverage example is the Ministry of Public Health's
[Weekly Epidemiological Surveillance Report](https://www.tci-thaijo.org/en/journals/WESR),
which reports 4,482 articles but simultaneously says CC BY 4.0 **and** that
permission is required outside personal or educational use. It is not eligible
for automatic native ingest. A written clarification/grant from the Division of
Epidemiology could, however, turn a large, Thai-first government archive into a
well-defined cohort after research-paper and third-party-content filtering.

Likewise, [Applied Science and Engineering Progress](https://www.tci-thaijo.org/en/journals/ijast)
reports 837 articles and a current page that says CC BY, while its official
[author information](https://ph02.tci-thaijo.org/index.php/ijast/information/authors)
states CC BY-NC-SA 3.0 and requires written permission for third-party
republication. The [ASEAN Journal of Scientific and Technological Reports](https://www.tci-thaijo.org/en/journals/tsujournal)
reports 1,103 articles and a current policy saying CC BY, but a
[2026 article record](https://ph02.tci-thaijo.org/index.php/tsujournal/article/view/265021)
is CC BY-NC-ND. These are agreement targets, not automatic CC-BY pools.

Mahidol IR is another high-leverage agreement target: the official home page
says it presents more than 50,000 digital items and identifies the repository
office and contact, but its site-wide default is CC BY-NC-ND and it visibly
separates metadata-only, open-access, and restricted records. A signed export
and deposit grant can make it fast; public availability alone cannot.

### Permission-only high-volume queue

These denominators are useful for partnership sizing but contribute **zero** to
the public-licence native count until a written grant and article manifest are
accepted.

| Source | Official gross denominator | Why it is permission-only | Fastest safe route |
| --- | ---: | --- | --- |
| [Weekly Epidemiological Surveillance Report](https://www.tci-thaijo.org/en/journals/WESR) | 4,482 | Its official page both labels the archive CC BY and requires permission beyond personal/educational use. The total also includes surveillance-report material, not only research papers. | Ask the Department of Disease Control's Division of Epidemiology for a written grant, paper-type list, exact file manifest, and third-party exceptions. |
| [ASEAN Journal of Scientific and Technological Reports](https://www.tci-thaijo.org/en/journals/tsujournal) | 1,103 | The journal page says CC BY, but the current article cited above is CC BY-NC-ND. | Ask the publisher to identify the authoritative licence per article/checksum or grant Seedy the missing commercial/derivative rights. |
| [Current Applied Science and Technology](https://www.tci-thaijo.org/en/journals/cast) | 1,084 | The official page identifies CC BY-NC-ND and publishes KMITL editorial contacts. | Negotiate one KMITL grant covering a fixed issue/article manifest; retain source-hosted mode until signed. |
| [Applied Science and Engineering Progress](https://www.tci-thaijo.org/en/journals/ijast) | 837 | Current public statements conflict between CC BY and CC BY-NC-SA/written-permission requirements. | Obtain a KMUTNB-signed controlling statement, licence-effective dates, and per-asset manifest. |
| [Journal of Health Science and Medical Research](https://www.tci-thaijo.org/en/journals/jhsmr) | 709 | The official page states CC BY-NC-ND and journal-held copyright. | Request a Prince of Songkla University grant for the exact intended Seedy actions and versions. |
| [Mahidol University Institutional Repository](https://repository.li.mahidol.ac.th/) | More than 50,000 items | Site default is CC BY-NC-ND; access and asset rights vary, and many records are metadata-only. | Use the published repository-office contact to request an official API/OAI export plus a depositor/rightsholder grant for a bounded open subset. |

## Fail-closed preflight

Every promoted asset should satisfy all of the following:

- stable provider, journal, issue, article, DOI/Handle, and exact asset identity;
- accepted paper type; exclude full-issue containers, covers, contents,
  editorials, corrections, retractions, book reviews, and announcements unless
  the product explicitly supports them as separate work types;
- exact licence URI on the article record and no contradictory rights text;
- licence statement inside the PDF or a signed manifest binding that checksum;
- official publisher/repository PDF URL, expected MIME, size, checksum, and page
  count;
- no authentication bypass, session-cookie replay, or member-only asset;
- no incompatible third-party permission signal; otherwise quarantine or redact
  only if the licence/agreement permits that derivative;
- attribution text, licence link, modification/extraction notice, source URL,
  observed date, reviewer, and takedown contact;
- explicit action flags for store, display, extract, embed, translate, export,
  redistribute, commercial use, and model training; unspecified means false;
- page extraction, per-page hash, stable anchors, and non-empty quality checks;
- provider tombstone/retraction monitoring and repeatable takedown.

Suggested machine-readable permission record:

```text
provider_record_id + article_id + asset_url + asset_checksum + version
+ rightsholder + licence_uri + evidence_url/agreement_id + effective_from
+ allow_store + allow_display + allow_extract + allow_embed
+ allow_translate + allow_export + allow_redistribute + allow_commercial
+ allow_training + third_party_status + attribution + observed_at
+ reviewed_at + reviewer + takedown_contact + decision
```

## Explicit exclusions and escalation rules

- **NC:** source-hosted unless a written commercial-use grant covers Seedy.
- **ND:** source-hosted unless a written grant covers extraction, translation,
  searchable text, page rendering, and distributed derivatives. Merely changing
  format may not itself create a derivative under CC's deed, but Seedy should
  not assume all of its processing/output is only format shifting.
- **Unknown licence:** metadata-only/source-hosted.
- **Journal policy and article licence disagree:** quarantine and ask the journal;
  the more permissive statement never wins automatically.
- **Article page and PDF disagree:** quarantine the exact asset.
- **Third-party content unclear:** quarantine; do not infer that the article's CC
  licence covers excluded material.
- **Public-domain claim:** record the legal basis and jurisdiction; government
  authorship does not automatically make a Thai work public domain.
- **Repository copy:** follow the asset's licence and depositor grant, not the
  repository's ability to serve the file.

## Recommended execution order

1. Ask VIS, Area Based Development, Engineering and Technology Horizons, and
   BSCM for manifests and approved bulk-delivery channels while running OAI-only
   denominator snapshots.
2. Build fixed issue plans for those four sources and run article-level rights
   preflight without downloading failed candidates.
3. Promote in 100- to 250-paper database-first batches; publish the verified
   count after every batch, never the planned count.
4. Add recent LEARN and JHR issues only if the first-wave verified yield is below
   897.
5. In parallel, negotiate the 5,000-paper manifest programme, prioritizing one
   high-volume government/institutional owner such as WESR or Mahidol IR and
   resolving high-volume contradictory journals in writing.
6. Deduplicate DOI, Handle, title/author/year, and checksum before adding provider
   totals. Report provider denominator, unique-work denominator, rights-cleared
   assets, and native papers separately.

The launch claim should remain: **“1,000 (later 5,000) rights-verified native
papers from named Thai providers, as of a stated date.”** It should never become
“all Thai research” or “all open-access ThaiJO papers.”
