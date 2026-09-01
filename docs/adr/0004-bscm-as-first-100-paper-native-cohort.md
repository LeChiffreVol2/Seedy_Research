# Use BSCM as the first 100-paper native release cohort

Seedy Research will use 100 original and review articles from ten fixed issues of Biomedical Sciences and Clinical Medicine as its first scaled native release cohort because the current TCI portal identifies the journal as Group 1, the official journal policy applies CC BY 4.0 including commercial sharing and adaptation, sampled article records repeat that item-level licence, and the fixed issue denominator can be independently recounted. LEARN Journal remains a second 45-paper candidate cohort and is promoted only after every article passes the same item-level rights preflight.

## Consequences

- The release claim is “100 native-verified original and review articles from a current TCI Group 1 Thai journal,” not “100 Thailand-context studies” or national completeness.
- All 100 candidates must pass per-version licence, MIME, checksum, page-count, extraction, page-anchor, and third-party-content review; a conflict fails closed to `source_hosted` rather than shrinking the gate silently.
- Medical papers remain research evidence and must not be presented as clinical advice.
- Production ingestion is database-first and resumable; the existing three-paper pack remains a deterministic fixture rather than growing the web bundle.
