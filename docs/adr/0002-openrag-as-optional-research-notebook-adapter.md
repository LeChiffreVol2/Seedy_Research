# Keep OpenRAG behind the Research Notebook boundary

Status: superseded by ADR 0008

Seedy Research will ship the Research Notebook as a separate researcher-facing feature on its existing Supabase identity, canonical graph, rights ledger, and exact-page evidence contract. OpenRAG may provide optional ingestion or agentic-retrieval capabilities through a benchmarked adapter, but it will not replace the Seedy Research system of record or promote its citations directly into evidence; this preserves owner isolation and the Passport trust boundary while allowing the notebook pipeline to adopt OpenRAG when its Thai retrieval, page fidelity, latency, security, and operating cost pass release gates.

## Consequences

The Challenge MVP reuses the existing Research Workspace and selected-source retrieval rather than deploying OpenSearch, Langflow, and Docling in Vercel. A later OpenRAG sidecar must fail closed, remain feature-flagged, and return candidate locators that Seedy Research resolves against its own rights and evidence records.
