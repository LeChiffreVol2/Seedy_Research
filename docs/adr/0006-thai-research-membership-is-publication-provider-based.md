# ADR 0006: Thai research membership is based on the Thai publication ecosystem

- Status: accepted
- Date: 2026-09-03

## Decision

Seedy Research will use **Thai-Published Research** as the primary operational
meaning of “Thai research.” A work qualifies when it is published or formally
deposited through a Thailand-based scholarly venue or provider and has a stable
provider record. Included document types may be journal articles, conference
papers, theses, dissertations, and research reports from sources such as
ThaiJO, TCI, TNRR, TDC, Thai conferences, and institutional repositories.

Thailand-context, Thai-language, and Thai-affiliation are independent facets,
not membership requirements. A work about another country may therefore belong
to the Thai-published corpus, while a Thai-affiliated paper published only in an
international venue belongs to the separately labelled global comparison
corpus. Search ranks semantic relevance to the research question before native
availability, visibility opportunity, recency, or popularity; provider
membership alone never makes a record topically relevant.

## Consequences

- Public labels and metrics must say Thai-published when they mean provider or
  venue membership; “Thai evidence” cannot silently imply Thailand context.
- Catalog records need explicit publication-provider membership, document type,
  Thailand-context, Thai-language, and Thai-affiliation fields rather than one
  overloaded Thai boolean.
- ThaiJO records concerning non-Thai topics remain valid corpus members but
  should not rank for a Thailand-specific query without matching topic signals.
- The 897 Thai-affiliated PMC works remain global comparison works and cannot be
  combined with Thai-published native-paper headline totals.
- Coverage can expand provider by provider without claiming that every included
  work studies Thailand or that every Thailand-related work was published in
  Thailand.
- Research Case discovery and evaluation must test both corpus membership and
  query relevance as separate conditions.
