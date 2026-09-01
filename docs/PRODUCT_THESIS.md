# Seedy Research Product Thesis

## Thesis

Seedy Research is a Thai-first, globally connected research evidence and
learning platform. It begins with the Civil Research Pack, where it already has
page-linked Thai evidence and bounded research workflows, then expands through
reviewed domain packs rather than becoming a generic paper search engine.

The product promise is:

> Discover Thai research that global indexes miss, learn from evidence that can
> be reopened at the source page, read every lawful manifestation available to
> the user, and turn verified findings into research and deep-tech project
> decisions.

Seedy Research is the user-facing product; SeedyMCP is its shared human-agent
layer; the Civil Research Pack is the first proof vertical. Existing CivilMCP
domains, routes, database objects, and storage identifiers remain compatibility
contracts until an additive migration can be rolled out and reversed safely.

## Users and jobs

| User | Primary job | Successful outcome |
| --- | --- | --- |
| Student | Understand an unfamiliar topic and find defensible sources | Completes a staged learning path and opens the evidence behind a conclusion |
| Researcher | Find, compare, and audit relevant Thai and global work | Produces a reusable review pack with claim-to-page provenance and human review state |
| Instructor or lab lead | Turn a corpus into guided coursework or a research starting point | Reuses an evidence-bounded path, reading list, or workspace with a cohort |
| University innovation or industry R&D team | Map a problem to credible research capability | Produces a source-bearing research-to-project brief and identifies evidence gaps |

The first three users are the initial product focus. Innovation and R&D teams
enter through bounded pilots; Seedy Research must not infer technology readiness,
intellectual-property status, or commercial viability without attributed data.

## Product layers

| Layer | User promise | Existing foundation | Next proof |
| --- | --- | --- | --- |
| **Explore** | Search Thai and global research without confusing discovery with evidence | `civil_source_catalog`, indexed Civil Research Pack evidence, ThaiJO metadata, OpenAlex bridge | Unified result ranking with visible provider, rights, and citable status |
| **Read** | Open the best lawful full-text manifestation without hiding access or reuse limits | Exact-page evidence drawer, source links, page provenance, private PDF extraction | Rights-aware native/source-hosted/institution-mediated reader with stable annotations |
| **Learn** | Build prerequisites and understanding from inspectable evidence | Four-stage Research Path and Tutor Mission | Diagnostic entry point, checkpoints, and a paper-to-project exercise |
| **Research** | Compare papers and export an auditable research artifact | Evidence Mission, Research Workspace, PRISMA-ScR guided pack | Living review updates, clearer coverage limits, and pilot templates |
| **Translate** | Move from findings to a testable deep-tech project question | Evidence matrices, Thailand-to-world transfer checks, and the Research Path `Project brief` outcome | Validate the brief with a named university or lab cohort and one bounded partner problem |

All four layers use one evidence contract. Global metadata can broaden discovery,
but only rights-reviewed, page-linked Seedy Research packets can support a
Seedy Research citation.

## The database is the product advantage

The defensible asset is not a model or chat interface. It is a governed research
graph assembled from seven connected records:

1. **Source and rights ledger** — provider identity, canonical record, access,
   license or permission, evidence status, hashes, freshness, and takedown state.
2. **Canonical work and asset graph** — one deduplicated intellectual work linked
   to every Thai/global provider record and every PDF/HTML/version asset, with a
   separate reader mode and action-level rights decision for each asset.
3. **Document provenance** — stable document, section, chunk, and original-page
   identity across extraction and re-indexing.
4. **Thai-English domain ontology** — concepts, synonyms, standards, methods,
   materials, hazards, and domain relationships reviewed per vertical.
5. **Research identity graph** — deduplicated authors, institutions, papers, and
   citations for provenance and filtering, with uncertainty retained rather than
   silently merged; this is not a social-network product surface.
6. **Claim-to-evidence graph** — answer or workspace claims linked to allow-listed
   evidence packets, exact pages, scope, and human-review state.
7. **Learning and workflow signals** — privacy-bounded saves, evidence opens,
   checkpoints, exports, corrections, and evaluation outcomes without storing raw
   research queries in product analytics.

The current Supabase substrate already separates `civil_source_catalog` from
the v2 evidence tables. Expansion should preserve that boundary and extend it
additively. Database size alone is not a moat; reviewed identities, rights,
provenance, bilingual semantics, and correction history are.

## North-star metric

**Weekly Verified Research Outcomes (WVRO)** is the number of distinct users who,
within a week, complete a meaningful learning or research artifact and verify at
least one supporting exact-page evidence packet.

A qualifying outcome is one of:

- a learning path checkpoint or paper-to-project exercise completed;
- an evidence-bearing review, comparison matrix, or research pack exported;
- a research-to-project brief completed and marked reviewed.

An `evidence_open` alone is activation, not an outcome. WVRO should be reported
with guardrails: exact-page coverage, citation correctness, zero-result rate,
helpfulness, provider/language slice, rights incidents, and fabricated citations.
The application now emits a dedicated `verified_research_outcome` event only
after reviewed exact-page evidence reaches an eligible artifact boundary. That
event definition is instrumentation, not adoption evidence: report a WVRO only
with a dated denominator, traffic class, release/deployment fingerprint, and
clearly labelled sample. Historical evidence-open plus save/export/path-created
funnels remain activation proxies rather than verified outcomes.

## Moat and compounding loop

```text
more rights-cleared Thai evidence
  -> better bilingual discovery and page-level answers
  -> more verified learning/research work
  -> more review and correction signals
  -> stronger ontology, identity resolution, and evaluations
  -> trusted university and data partnerships
  -> more rights-cleared Thai evidence
```

The durable moat is the combination of data rights, provenance quality,
Thai-domain semantics, workflow integration, evaluation fixtures, and partner
distribution. Models remain replaceable behind the bounded evidence contract.

## Policy posture

Seedy Research is **policy-aligned, not government-endorsed**. It can support Thai
priorities around research utilization, deep-tech capability, AI talent, and
university-industry collaboration, while remaining useful across policy cycles.
Product copy and partnership material must not imply ministry approval,
national-repository status, or official assessment authority.

Policy alignment should be reviewed against primary sources such as Thailand's
[National AI Strategy 2022–2027](https://www.ai.in.th/en/about-ai-thailand/)
and [NXPO's innovation-led economy work](https://www.nxpo.or.th/th/en/47618/).
These references guide prioritization; they do not prove demand or endorsement.

## Rights and evidence boundary

- A publicly reachable PDF is not automatically licensed for redistribution,
  commercial AI processing, translation, or embedding.
- ThaiJO/TCI and other external sources enter as metadata-only discovery unless
  article/journal terms or written permission authorize the intended use.
- Every promoted source needs a stable URL, recorded rights/access status,
  page-preserving extraction, OCR/text quality, deduplication, and embedding and
  citation evaluation.
- Discovery records must remain visibly non-citable. OpenAlex and Crossref are
  enrichment bridges, not page-level evidence providers by default.
- Restricted user uploads, if introduced, must remain private to their workspace
  and must not train or enrich the public corpus without separate authorization.
- Takedown must quarantine or remove affected evidence without deleting unrelated
  catalog metadata or breaking the audit history.

Provider-specific implementation follows [Data Expansion](DATA_EXPANSION.md)
and [Data Sources and Rights](../DATA_SOURCES.md). Relevant primary interfaces
include the [ThaiJO OAI service](https://www.tci-thaijo.org/public/oai.html),
[OpenAlex API](https://developers.openalex.org/), and
[Crossref metadata API](https://www.crossref.org/documentation/retrieve-metadata/).

## Non-goals for this phase

- replacing TNRR, ThaiJO, university repositories, or global scholarly indexes;
- building researcher/organization profile networks, public following, or social discussion;
- reproducing paper code, provisioning cloud compute, or operating experiment sandboxes;
- claiming national or disciplinary completeness before provider denominators,
  deduplication, access states, and dated coverage audits are measurable;
- claiming a comprehensive systematic review from the current candidate set;
- unattended autonomous research, scientific validation, or professional
  engineering advice;
- asserting TRL, IP freedom-to-operate, commercialization readiness, or researcher
  identity when the supporting source is absent or ambiguous;
- exposing publisher content beyond recorded rights or presenting metadata-only
  records as evidence;
- changing the existing `ce_project` collection ID, embedding dimensions, MCP
  read-only contract, or bounded retrieval limits to create the new positioning;
- launching paid commercial use before hosting, data rights, support, and release
  gates explicitly permit it.

## Expansion decision rule

A new deep-tech vertical is eligible only when it has a named user cohort, a
bounded ontology, a lawful source plan, at least one end-to-end learning and
research workflow, provider/language evaluation fixtures, an operator and
takedown path, and evidence that users complete verified outcomes. Candidate
packs may include climate-resilient infrastructure, advanced materials and
energy, mobility/EV/robotics, and AI/advanced electronics. Biotechnology,
health, and future food should wait for appropriate domain review and data
partnerships.
