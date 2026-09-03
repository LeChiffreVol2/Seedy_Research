# Seedy Research — WebMCP evaluator guide

[Public application](https://seedresearch.vercel.app/) ·
[Repository](https://github.com/LeChiffreVol2/Seedy_Research) ·
[Agent connection guide](https://seedresearch.vercel.app/developers)

## The problem and product

Research published in Thailand can be difficult to connect to the global
literature and reuse in a study. Seedy brings Thai discovery, lawful full-paper
reading, evidence review, and next-study planning into one Research Case.

The distinctive workflow is not a smaller global search engine. It is a
traceable route from Thai-provider evidence through a dated global-visibility
comparison to human-reviewed research artifacts. Seedy does not submit records
to OpenAlex, and it does not infer national invisibility from a failed lookup.

The product serves researchers, universities, and research institutes.
Workspace is a literature-review and PRISMA-guided workbench. Its reviewed
findings flow into a separate Sources–Chat–Studio Notebook for synthesis,
notes, and research artifacts. Notebook uses the resource-bounded Light Mode;
the optional OpenRAG runtime is not enabled by default.

## Evaluate the shared human–agent workflow

Use a browser host that exposes `document.modelContext` and Site tools.
Without that capability, the human interface still works; it is not native
WebMCP proof. Feature access may require sign-in according to deployment policy.

1. Start a Research Case from a specific question about research published in
   Thailand. Inspect relevant results and any sparse-coverage warning.
2. Ask the agent to inspect a dated visibility receipt. Distinguish an exact
   identity, an under-indexed identity, a candidate, a dated no-exact-match,
   not audited, and provider unavailable.
3. Open an inspectable Thai paper at its exact evidence page. Inspect its source,
   version, and lawful full-text access mode. Metadata-only records must not
   open as evidence.
4. Trace global relationships only where the DOI identity is exact. Candidate
   identities expose no verified graph; relationships remain metadata leads.
5. Draft a Research Passport from pages already inspected on the shared page.
   The researcher reopens those pages and accepts or rejects each claim.
   Export must stay locked until every claim has a decision and at least one
   is accepted.
6. Continue into a Research Path and inspect the candidate gap and Next-Study
   Protocol. Novelty and transferability remain unvalidated.
7. For the broader workflow, review selected papers in Workspace, send reviewed
   evidence to Notebook, and inspect source-linked chat and Studio artifacts.
   Private findings must remain owner-scoped and non-shareable.

A visibility example and a full-text control may be different papers. If so,
show the transition explicitly: reading the control does not validate a claim
about an inaccessible paper. The committed LEARN reader source
`thaijo:learn:291631` is a lawful reader control, not proof of global absence.

## Eight site tools

| Tool | Observable result |
| --- | --- |
| `start_research_case` | A started or resumed case and bounded discovery |
| `discover_research` | Thai sources separated from global comparison metadata |
| `audit_global_visibility` | A dated receipt, including uncertainty and unavailable states |
| `inspect_paper_evidence` | The selected evidence page and lawful reader state |
| `trace_research_connections` | An exact-DOI connection trace or an explicit unresolved state |
| `draft_research_passport` | An evidence-bounded draft with human review controls |
| `build_research_path` | A visible study path, candidate gap, and next-study framework |
| `inspect_learning_progress` | Checkpoint status without private free-text answers |

The implementation lives in [web/lib/webmcp.ts](../web/lib/webmcp.ts).
Tool calls reuse the signed-in session and same-origin APIs. They are bounded,
validated, cancellable, and annotated for read/write and untrusted content.
The human and agent work on the same visible state. No browser tool returns
the entire full-paper text.

## What the evidence establishes

- **Implementation:** source and contract tests show the workflow and boundaries.
- **Fixture verification:** a deterministic browser host exercises tool calls and
  visible UI; provider/session responses are mocked. The reader-control case
  uses the committed three-paper pack through the real reader route.
- **Live verification:** requires the exact deployed revision, authenticated
  workflows, provider/database checks, and an actual WebMCP host receipt.
  Fixture success is not evidence of these.
- **Coverage:** the September 2 snapshot has 103 Thai-local native papers and
  897 Thai-affiliated global comparison papers, not national completeness.
  [Corpus status](CORPUS_STATUS.md) retains the denominator and integrity limits.
- **Quality and performance:** older scores, timings, and host recordings apply
  only to their recorded revisions. Current source checks do not renew them.

[Reproduction and verification](HARNESS.md) ·
[Rollout gates](LAUNCH_READINESS.md) · [Rights](../DATA_SOURCES.md)

## Provenance and submission boundaries

The earlier MCP/RAG product predates this Challenge. The browser-native tools,
visibility workflow, Research Case continuity, page-review Passport, and
Notebook evolution can be inspected in Git history; do not attribute the
entire existing codebase to the competition window.

The pre-cleanup documentation, including dated earlier release receipts, is
preserved at the [September 4 archive tag](https://github.com/LeChiffreVol2/Seedy_Research/blob/archive/citymcp-before-seedy-cleanup-2026-09-04/docs/WEBMCP_CHALLENGE_SUBMISSION.md).
Those receipts are historical, not a current frozen-candidate declaration.

The organizer's [extension announcement](https://webmcp.devpost.com/updates)
sets the extended deadline to September 4, 2026, 01:00 PDT (08:00 UTC).
Use the [official rules](https://webmcp.devpost.com/rules) for eligibility and
freeze requirements. Keeping the same repository URL does not waive those
requirements. This guide does not assert that submission prerequisites or
actual-host verification have been completed.
