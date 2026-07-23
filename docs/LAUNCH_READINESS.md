# CivilMCP Launch Readiness

## Decision

CivilMCP may launch as a **free Public Research Preview for a limited user
rollout** after the release gates in this document pass. It is not approved as
global GA or as a paid product on Vercel Hobby.

The launch promise is narrow and testable:

> Find Thai civil-engineering research that global indexes miss, verify every
> supported claim at the page, and turn the evidence into reviews, learning
> paths, and research decisions.

## Launch surfaces

- Explore: indexed Thai evidence plus clearly separated ThaiJO discovery
  metadata.
- Evidence detail: page-linked outline/chunks, related Thai evidence, OpenAlex
  comparison bridge, citation export, and personal library notes/labels.
- Chat: bounded Evidence Mission, Guided Learning, Quick Answer, and cited
  follow-ups.
- Research Path: four-stage personalized learning path with local progress.
- Research Workspace: bounded PRISMA-oriented evidence matrix; Pro execution
  remains unavailable until paid hosting and Stripe are deliberately enabled.
- MCP: 11 authenticated, read-only tools. Metadata-only catalog results are
  never returned as citable evidence.

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
7. rollback drill using the previous Vercel deployment.

## Limited-rollout success criteria

Review after the first 10–20 researchers or students have completed real tasks:

- at least 70% reach an exact-page evidence view;
- at least 40% save, export, or continue a paper into a research workflow;
- at least 60% of rated answers are marked Helpful;
- zero confirmed fabricated citations;
- zero unresolved source-rights or takedown incidents;
- qualitative evidence that CivilMCP surfaced local work users could not find
  through their usual global search tools.

## Explicitly not launch-complete

The following require additional data, infrastructure, or external
coordination and must not be represented as shipped:

- unattended async Autoresearch with durable resume/cancel/retry;
- author–institution–citation graph and alerts;
- real-time collaboration;
- OAuth-based public MCP authorization;
- commercial full-text ingestion without provider-level rights review;
- paid subscriptions while the deployment remains on Vercel Hobby.

These are post-preview milestones, not blockers for the free limited rollout.
