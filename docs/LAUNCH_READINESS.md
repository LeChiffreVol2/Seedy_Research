# Seedy Research Launch Readiness

## Decision

Seedy Research may launch as a **free Public Research Preview for a limited user
rollout** after the release gates in this document pass. It is not approved as
global GA or as a paid product on Vercel Hobby.

The launch promise is narrow and testable:

> Find Thai research that global indexes can miss, verify every
> supported claim at the page, and turn the evidence into reviews, learning
> paths, and research decisions.

The 2 September 2026 production snapshot contains 1,000 native full papers and
14,485 pages: 103 Thai-local/ThaiJO papers plus 897 Thai-affiliated global OA
PMC papers. This clears the bounded native-reader scale proof, but it does not
clear national-provider completeness; TCI, TNRR, TDC, Thai conferences, and
institutional repositories remain separately measured rollout tracks.

## Launch surfaces

- Explore: indexed Thai evidence plus clearly separated ThaiJO discovery
  metadata.
- Evidence detail: exact cited-packet highlighting and reopenable deep links,
  page-linked outline/chunks, related Thai evidence, OpenAlex comparison
  bridge, citation export, and personal library notes/labels.
- Chat: bounded Evidence Mission, Guided Learning, Quick Answer, and cited
  follow-ups, with a deterministic query-scope and citation-integrity audit.
- Research Path: four-stage adaptive learning path with checkpoints, explicit
  mastery/gap state, and local progress.
- Research Workspace: up-to-50-paper Verified Review Project, six-paper bounded
  server batches, Scientific Evidence Snapshot, private PDF/citation imports,
  human review, and PRISMA-ScR guided export. Reviewed exact-page findings can
  be sent to Notebook as a versioned Workspace Evidence Pack.
- Research Notebook: separate Sources–Chat–Studio surface within a Research
  Case, with bounded persistent threads, notes, and artifact versions. Light
  Mode uses model APIs and admitted sources. Public findings may continue to
  a review-gated Passport or Research Path; private findings remain non-shareable.
- Coverage Ledger: dated, provider-filterable counts that separate searchable
  metadata, page-citable evidence, native reader assets, source-hosted links,
  rights state, endpoint coverage, and providers not yet connected.
- Living Review and citation map: explicit, bounded Thai/OpenAlex discovery
  checks with metadata/evidence separation.
- Public paper records: indexable metadata, canonical URL, JSON-LD, page ranges,
  and rights-safe outline without raw full text.
- MCP: 14 public task-level tools over stateless Streamable HTTP, plus the
  19-tool first-party compatibility contract. OAuth and revocable owner-scoped
  personal keys share the same permission and distributed-quota boundary.
  Metadata-only records are never returned as citable evidence.
- WebMCP: eight top-level browser site tools for persistent Research Case
  start/resume, Thai discovery, dated global visibility audit, exact-page
  evidence, evidence-bounded Research Passport drafting, Research Path
  creation/adaptation, and privacy-bounded progress inspection. Tool calls
  must update the same visible page the person is reviewing.
- Research Passport: one to three visible exact-page Thai anchors, at most four
  OpenAlex metadata-only leads, an optional bounded English rendering that
  never replaces the source excerpt, one candidate validation gap, mandatory
  exact-page claim accept/reject review with at least one accepted claim, and a
  boundary-preserving Markdown export. It must not claim
  scientific correctness, novelty, transferability, or comprehensive review.
- Trust and support: public Privacy, Terms, Support/takedown, self-service
  account deletion, and first-party activation events without raw queries.

## Release gate

All of the following must pass against the same source state:

1. invariants and security contracts;
2. strict data quality with zero missing pages, embeddings, unknown
   disciplines, or weak effective titles;
3. production web build and desktop/mobile E2E;
4. strict smoke, retrieval eval, memory eval, and quality score;
5. incognito Explore → evidence → chat → feedback audit;
6. source status and citation boundary audit for NCCE, student projects, and
   ThaiJO metadata;
7. rollback drill using the previous Vercel deployment;
8. semantic retrieval is healthy, or the UI and traces explicitly report the
   bounded lexical fallback; `retrieval_unavailable` must never generate an answer.
9. support request, account deletion, privacy, and terms routes pass a clean
   incognito/authenticated audit.
10. every cited-answer fixture resolves its evidence IDs, opens the targeted
    packet/page, and exports a provenance audit without claiming scientific
    validation;
11. private-library ownership, Living Review ownership, personal MCP key
    create/use/revoke/delete, OAuth grant revoke, and public MCP v2
    initialize/list/call pass authenticated isolation tests;
12. `npm audit --omit=dev` has no high or critical production advisory, and any
    deferred low advisory has an owner and migration plan.
13. the focused WebMCP browser test executes all eight tools and verifies visible
    Explore, evidence-drawer, Research Passport, Research Path, and progress
    state; Passport claim decisions remain locked until the selected exact-page
    anchors are reopened, export remains locked until every claim is decided and
    at least one is accepted, and OpenAlex leads
    remain non-citable. The deployed candidate is also checked manually in
    ChatGPT's built-in browser using a configuration where Site tools are
    visibly available and in Chrome with native WebMCP testing enabled. Record
    the exact host build, account class, selected model, permissions, and calls.
14. Research Notebook ownership and saved-source membership fail closed;
    citations resolve only to supplied exact-page packets; private answers are
    non-shareable and persisted only in owner-scoped state; public promotion returns to the Passport
    page-review gate.
15. Passport-to-Path continuity rejects stale or off-paper evidence and carries
    the reviewed Passport ID, source, exact evidence locators, gap lens, and
    selected metadata-only global leads into the visible path.
16. the default Thai feed starts independently of session and history
    hydration; natural-language Thai-published search joins ThaiJO discovery
    with bounded local conference/university evidence without admitting the PMC
    global-comparison cohort; initial cards do not trigger translation until
    requested; and the visibility audit distinguishes provider failure from a
    dated no-exact-match result without exposing a partial-run percentage.
17. the 30-question Research Case benchmark passes across engineering,
    education, health, and sparse controls, and its feed request p95 is no more
    than five seconds against the exact staged candidate.

The August 31, 2026 production dependency audit found no high or critical
advisories and five transitive low-severity advisories in the current AI SDK
chain. The project maintainer owns the follow-up: test the available breaking
AI SDK major upgrade on an isolated branch after the challenge candidate is
frozen, then rerun build, E2E, memory, citation, and audit gates before merging.

## Limited-rollout success criteria

Review after the first 10–20 researchers or students have completed real tasks:

- at least 70% reach an exact-page evidence view;
- at least 40% save, export, or continue a paper into a research workflow;
- a page-reviewed Research Passport export counts as an evidence-bearing research
  outcome only when it retains at least one exact-page Thai anchor;
- at least 60% of rated answers are marked Helpful;
- less than 10% zero-result rate for the launch prompt set;
- median time-to-first exact-page evidence under 10 minutes;
- zero confirmed fabricated citations;
- zero unresolved source-rights or takedown incidents;
- qualitative evidence that Seedy Research surfaced local work users could not find
  through their usual global search tools.

## Explicitly not launch-complete

The following require additional data, infrastructure, or external
coordination and must not be represented as shipped:

- unattended async Autoresearch with durable resume/cancel/retry;
- author–institution graph and researcher social network;
- weekly email digest for Living Reviews;
- real-time collaboration;
- commercial full-text ingestion without provider-level rights review;
- paid subscriptions while the deployment remains on Vercel Hobby.
- unattended support SLA or legal-response automation; the preview queue is
  operator-reviewed.
- automated proof of novelty, global transferability, or comprehensive
  literature gaps from OpenAlex metadata.

These are post-preview milestones, not blockers for the free limited rollout.
