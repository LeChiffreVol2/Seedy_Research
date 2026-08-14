# Thai Deep-Tech Expansion: Eight-Week Roadmap

## Outcome and operating constraints

In eight weeks, prove that CivilMCP can extend from a civil-engineering evidence
product into a Thai-first deep-tech learning and research platform without
weakening citation, rights, security, or rollback guarantees.

## Implementation snapshot — 13 August 2026

- 1,297 page-citable Thai civil-engineering papers remain the evidence layer.
- 780 allowlisted ThaiJO records are connected as non-citable discovery
  metadata; publisher links are complete and DOI coverage is 682 records.
- Explore labels evidence and Thai metadata separately and expands to OpenAlex
  only after an explicit user action. Global records remain external and
  non-citable.
- The source catalog now has bounded database search plus a versioned,
  default-deny rights manifest; the ThaiJO harvester enforces exact allowlist
  pairs, sanitizes malformed provider XML, and writes ingest-run audit state.
- Research Path includes a `Project brief` outcome that asks for Thai problem
  context, evidence, method, capability, uncertainty, and next experiment while
  prohibiting unsupported TRL, IP, and commercialization claims.

This completes the technical core of weeks 1–2, not the market proof. A named
cohort, completion baseline, rights partner, and adjacent-domain choice remain
required before the roadmap can advance to evidence promotion.

The deliverable is a limited university pilot of one coherent journey:

```text
Explore -> Learn -> Research -> Translate
```

Civil engineering remains the production vertical. One adjacent domain pack is
tested as discovery metadata and a curated learning/research pilot; it is not
promoted to citable evidence until every provider gate passes.

Role placeholders used below: **[Product]**, **[Data]**, **[Backend]**,
**[Frontend]**, **[Research/QA]**, **[Rights/Partnerships]**, and **[Operations]**.

## Database and source sequence

Use the existing database boundary before adding new entities:

1. **Current evidence baseline:** `civil_documents_v2`, sections, chunks, and
   embeddings remain the only page-citable substrate.
2. **Thai discovery expansion:** bounded official ThaiJO OAI metadata enters
   `civil_source_catalog` as non-citable `metadata_only`; no implicit PDF fetch.
3. **Global enrichment:** OpenAlex and Crossref enrich DOI, citation, author,
   institution, and related-work discovery. Their records remain non-citable
   unless separate full-text evidence is lawfully promoted.
4. **Partner full text:** only a written-permission or verified open-license pilot
   proceeds through extraction, page mapping, quality review, indexing, and
   monitoring.
5. **Adjacent domain pack:** ontology and UI labels launch against reviewed
   metadata first; evidence launch is a separate go/no-go decision.

Weeks 1–2 should require no breaking schema change. Any later migration must be
additive, preserve existing IDs and MCP contracts, include RLS/privilege review,
and be safe to ignore when its feature flag is off. Do not rename `ce_project`,
change the 768-dimension embedding contract, or write ingestion jobs into Vercel
request paths.

## Week-by-week plan

| Week | Build and decision | Owners | Acceptance gate |
| ---: | --- | --- | --- |
| **1 — Contract and baseline** | Freeze the product thesis, map Explore/Learn/Research/Translate to current surfaces, choose one adjacent-domain candidate, inventory tables/providers/rights states, and capture baseline activation and quality metrics. Define WVRO and its temporary proxy. | [Product], [Data], [Research/QA] | Source inventory reconciles with `civil_source_catalog`; every current result is classified citable or discovery-only; baseline quality reports match one corpus fingerprint; pilot problem and 10–20 target users are named. |
| **2 — Unified discovery** | Add a provider-aware unified search presentation over current evidence and bounded ThaiJO metadata. Show provider, language, rights/evidence status, and why a record is or is not citable. Refresh only an approved ThaiJO allowlist. | [Data], [Backend], [Frontend] | Metadata-only records cannot enter chat evidence or receive an `[E#]`; existing paper deep links still reopen the same packet/page; zero-result and provider/language slices are measurable; build and smoke pass. |
| **3 — Ontology and global bridge** | Create a versioned Thai-English ontology pack for civil engineering plus the selected adjacent domain. Enrich discovery with normalized DOI and conservative OpenAlex/Crossref links; retain merge confidence and review ambiguous identities. | [Data], [Research/QA] | Every expansion term has a domain, language, source/reviewer, and version; no low-confidence author/institution merge is silently accepted; global metadata is labelled non-citable; existing retrieval eval does not regress. |
| **4 — Learn** | Evolve Research Path into a diagnostic-to-checkpoint pilot: prerequisite level, four bounded stages, evidence opens, checkpoint completion, and one paper-to-project exercise. Keep progress local-first unless an additive, owner-scoped record is approved. | [Product], [Frontend], [Backend], [Research/QA] | A user can complete one full path with at least one exact-page verification; sparse goals fail recoverably instead of receiving generic papers; accessibility/mobile checks and deterministic fixtures pass; completion telemetry contains no raw query. |
| **5 — Research** | Add one domain-specific Research Workspace template and a living-review update contract. Preserve per-paper evidence allowlists, human review, coverage limitations, and current six-paper/six-column bounds. | [Product], [Backend], [Frontend], [Research/QA] | Every supported cell resolves to an allow-listed exact-page packet; unsupported cells are marked for review; exports retain sources and review state; the PRISMA-ScR claim stays limited to the selected candidate set. |
| **6 — Translate and rights pilot** | Produce a research-to-project brief containing problem, evidence, proposed method, capability needed, uncertainty, and next experiment. Run one partner-source rights review; ingest full text only if written permission or license covers the intended processing and display. | [Product], [Rights/Partnerships], [Data], [Research/QA] | Briefs distinguish reported findings from inference and do not invent TRL/IP/commercial claims; rights decision and permitted actions are recorded; promoted content passes page, OCR, dedupe, embedding, retrieval, and citation gates—or remains metadata-only. |
| **7 — Pilot readiness** | Run internal red-team and 5-user rehearsal across Thai/English prompts, weak coverage, identity ambiguity, provider outage, takedown, and mobile. Prepare facilitator script, consent/privacy notice, support owner, dashboard, and rollback drill. | [Research/QA], [Operations], [Rights/Partnerships], [Product] | Quality score is at least 90 with no failed gate; citation correctness is 100%; strict data quality has zero missing pages/embeddings, unknown disciplines, or weak titles for indexed evidence; rollback and quarantine drills succeed. |
| **8 — Limited university pilot** | Release to 10–20 students/researchers, review the funnel and qualitative outcomes daily, resolve evidence/rights incidents, and make a written expand/iterate/stop decision for the adjacent domain. | [Product], [Operations], [Research/QA], [Rights/Partnerships] | Launch-readiness gates pass against one source state; no confirmed fabricated citation or unresolved rights incident; pilot metrics and user evidence support the decision; the next domain is not promoted by schedule alone. |

## Metrics and acceptance dashboard

### North star

- **WVRO:** distinct weekly users completing a qualifying learning, research, or
  translation artifact with at least one exact-page evidence verification.
- Week 1 establishes the baseline. For the pilot, use **40% of activated users
  completing a WVRO** as an initial decision target, not as a market claim.
- Until dedicated completion events ship, report the proxy separately: users
  with `evidence_open` plus `paper_save`, `research_path_created`,
  `session_export`, or `evidence_export` in the same bounded journey.

### Product and trust guardrails

| Metric | Pilot gate |
| --- | ---: |
| Users reaching an exact-page evidence view | >= 70% |
| Users saving, exporting, or continuing into a research workflow | >= 40% |
| Rated answers marked Helpful | >= 60% |
| Zero-result rate on the launch prompt set | < 10% |
| Median time to first exact-page evidence | < 10 minutes |
| Citation correctness on release evaluation | 100% |
| Confirmed fabricated citations | 0 |
| Unresolved source-rights/takedown incidents | 0 |
| Metadata-only records used as citable evidence | 0 |

Report every retrieval metric by provider, language, discipline/domain, and
semantic versus lexical-fallback mode. Volume metrics such as records harvested
or chats sent are operational context, not success by themselves.

## Data promotion gates

Each provider/domain candidate must move through:

```text
discovered -> metadata_only -> rights_verified -> extracted
           -> quality_reviewed -> indexed -> monitored
```

Promotion requires deterministic IDs; DOI/source/version deduplication; recorded
license and permitted actions; stable canonical URL; source timestamp and hash;
original page mapping; acceptable OCR/text; normalized title, discipline,
language, author, and institution data; reviewed embedding cost; resumable jobs;
provider/language retrieval and citation evaluation; source-health monitoring;
and a tested quarantine/takedown path. Failure moves the record to
`quarantined` or leaves it metadata-only—it does not lower the gate.

## Release, rollout, and rollback

### Rollout

1. Develop behind off-by-default flags for unified discovery, learning-path
   changes, translation briefs, and each new provider/domain pack.
2. Run local and preview gates against the same corpus fingerprint and additive
   migrations.
3. Enable for the internal team, then 5 rehearsal users, then the 10–20-person
   university pilot.
4. Promote the same verified deployment artifact; do not rebuild between staging
   and production promotion.
5. Review activation, source health, retrieval degradation, support, rights, and
   negative feedback daily during the pilot.

### Stop conditions

Immediately disable the affected surface or provider for any fabricated
citation, metadata-only citation leak, source-rights incident, account ownership
or deletion failure, unlabelled retrieval outage, evidence deep-link breakage,
or unsupported TRL/IP claim represented as fact.

### Rollback order

1. Turn off the new surface/provider/domain feature flag.
2. Mark affected catalog/evidence records `quarantined` or `removed` and exclude
   the collection/provider from retrieval; preserve audit and takedown history.
3. Use `AGENTIC_CONTEXT_ENABLED=false` for orchestration regressions or
   `RETRIEVAL_VERSION=v1` for retrieval regressions.
4. Promote the previous verified Vercel deployment for application regressions.
5. Do not destructively reverse an additive database migration during an
   incident. Keep the new objects unused, investigate, and schedule a reviewed
   cleanup later.

Operational commands and release bars remain defined in
[Operations](OPERATIONS.md), [Quality Score](QUALITY_SCORE.md), and
[Launch Readiness](LAUNCH_READINESS.md).

## Week-eight decision

Choose **expand** only if the adjacent domain passes rights and evidence gates,
users complete WVROs, and the work creates value beyond generic discovery.
Choose **iterate** when the workflow is useful but ontology, coverage, or
completion is weak. Choose **stop/quarantine** when trust, rights, or
provenance cannot be made reliable within the bounded product. A successful
metadata pilot does not automatically authorize full-text ingestion or a new
public brand.
