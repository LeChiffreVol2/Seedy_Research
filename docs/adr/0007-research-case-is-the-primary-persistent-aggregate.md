# ADR 0007: Research Case is the primary persistent aggregate

- Status: accepted
- Date: 2026-09-03

## Decision

Seedy Research will organize its primary researcher journey around a persistent,
resumable Research Case rather than presenting Explore, Reader, Visibility
Audit, Research Passport, Research Path, Chat, and Workspace as independent
product promises. A stable case identity owns the question, selected works,
visibility receipts, exact-page evidence, global leads, review decisions,
candidate gap, and Next-Study Protocol. The existing surfaces become stages or
views over that aggregate. Research Passport is a reviewed portable snapshot of
case state, not the case itself.

WebMCP will expose one bounded task-level operation for starting or resuming the
case while retaining atomic tools for inspection and controlled continuation.
This trades a broader feature menu for a coherent first outcome and makes shared
browser state, claim-level human review, and provenance transitions explicit.
The task-level operation must not hide failed providers, approve evidence,
validate novelty, or turn unresolved identity matches into canonical links.

## Consequences

- The public entry starts from a real research question rather than a prefilled
  Civil Research Path.
- A useful first case state must be reachable within three site-tool calls and
  fifteen seconds under the recorded Challenge benchmark.
- Case state must survive navigation and be resumable by its owner.
- Search relevance, evidence admission, visibility review, and Passport export
  remain separate state transitions with explicit failure and review states.
- Secondary features remain available only where they advance the current case.
