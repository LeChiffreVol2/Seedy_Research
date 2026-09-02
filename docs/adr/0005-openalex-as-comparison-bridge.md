# ADR 0005: OpenAlex is a comparison bridge, not Seedy's destination

- Status: accepted
- Date: 2026-09-02

## Decision

Seedy Research will use OpenAlex as a dated external comparison and relationship source. It will not position itself as an OpenAlex submission, repair, or synchronization pipeline. The primary object is the Thai-local source record and its lawful evidence manifestation. A visibility audit may report an exact identity, richer local metadata than the global record, a review-only candidate, no exact match in that dated bounded audit, or an unavailable/not-yet-audited state. Only exact DOI or steward-reviewed identity may anchor a global relationship trace.

The product sequence is Thai-local discovery → dated visibility receipt → exact-page or lawful full-paper inspection → verified global connections when available → Research Passport human review → Research Path and Next-Study Protocol. Generic topical OpenAlex search remains an optional comparison surface after Thai results and cannot be carried into a Passport as a verified relationship.

## Consequences

- ThaiJO, the Civil Research Pack, and future TNRR/TCI/TDC/conference/repository sources remain first-class records even when OpenAlex has no match.
- `not_found_in_audit` is scoped to one provider, method, and date; provider failure never becomes an absence claim.
- The 897 PMC records are a global comparison/control corpus and are excluded from Thai-local native-paper headline metrics.
- Institutions can use the same receipt ledger as a Repository Visibility Observatory without granting Seedy authority to modify an external index.
- Candidate gaps and global transfer remain unvalidated until a person reviews the cited Thai pages and the required external evidence.
