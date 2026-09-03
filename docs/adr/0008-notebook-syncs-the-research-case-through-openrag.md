# Research Notebook synchronizes the Research Case in resource-bounded Light Mode

- Status: accepted
- Date: 2026-09-03
- Supersedes: ADR 0002

Seedy Research will make Research Notebook the continuous working surface over
one Research Case rather than a second navigation label for Research Workspace.
Notebook synchronizes the case's selected sources, grounded conversations,
notes, reviews, global leads, and derived Studio artifacts across the full
literature-to-next-study journey. Evidence Matrix, synthesis, candidate-gap,
protocol, and manuscript-support tools become Notebook artifacts or actions;
the Research Case remains the authoritative lifecycle aggregate and Research
Passport remains its human-reviewed portable checkpoint.

The free production release will run Seedy Notebook Light Mode: it reuses the
existing exact-page corpus and Supabase indexes for bounded retrieval, then uses
the same configured model APIs as other Seedy features for grounded synthesis.
It does not duplicate source text or embeddings and does not run OpenSearch,
Langflow, or Docling in Vercel request paths. A dormant, fail-closed OpenRAG port
remains available for a future persistent sidecar, but the product must not call
that port active until a real runtime passes retrieval, page-fidelity, latency,
owner-isolation, and cost gates.

This prioritizes a complete Sources–Chat–Studio workflow within the current
Vercel and Supabase resource envelope. It rejects both a status-only OpenRAG
label and an attempt to force a multi-service OpenRAG deployment into free
serverless infrastructure.

## Consequences

- Each Research Case has one Research Notebook with multiple persistent,
  independently source-scoped conversation threads.
- Notebook persistence is normalized but bounded: it stores compact messages,
  notes, source snapshots, Workspace Evidence Packs, and artifact versions, not
  duplicate paper bodies, chunks, or embeddings.
- Notebook adopts the familiar Sources–Chat–Studio interaction grammar while
  retaining Seedy Research's own visual identity, trust language, and
  Thai-to-global workflow; it is not a pixel or brand clone of NotebookLM.
- The Sources pane separates admitted Case Sources, Thai discovery suggestions,
  private uploads, and metadata-only global leads. Only selected Case Sources
  ground a Notebook answer.
- Discovery results enter the Notebook only through an explicit Add to Case
  action; global metadata leads do not silently become evidence.
- Source and review changes mark dependent Studio artifacts stale. Regeneration
  creates a traceable version rather than overwriting the prior artifact.
- The existing Workspace survives as a distinct Evidence Review Workspace for
  a Paradigm-inspired spreadsheet model, PRISMA-guided screening,
  literature-review relationships, structured extraction, and evidence
  matrices. It remains a top-level specialist surface; Notebook does not
  reproduce that interface. Notebook consumes selected reviewed outputs through
  a versioned Workspace Evidence Pack carrying source, screening, exact-page,
  exclusion, and review provenance.
- Reader evidence and global connections open in the Notebook context so the
  active thread, selected sources, and agent-visible case state are preserved.
- The supported end-to-end boundary reaches a submission-ready research package
  assembled from reviewed evidence and user-supplied study results. It does not
  claim autonomous data collection, scientific validation, or publication.
- The Challenge release is owner-scoped with read-only sharing and export. The
  ownership model must leave room for later institutional roles without exposing
  multi-user editing before its review and audit semantics are designed.
- The product labels this runtime `Seedy Light Retrieval · OpenRAG-ready` and
  reports the OpenRAG adapter as inactive. A future sidecar is an operational
  upgrade, not a prerequisite for the end-to-end Notebook workflow.
