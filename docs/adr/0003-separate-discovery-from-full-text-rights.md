# Separate discovery scale from full-text rights

Seedy Research will scale the TCI-ranked Thai journal catalog independently from full-text delivery: metadata may enter `catalog_indexed`, public assets without complete action-level permission remain `source_hosted`, cleared assets enter `native_verified`, user-provided papers remain owner-scoped in `private_user_supplied`, and direct author, journal, or institutional grants enter `deposit_granted`. This preserves an alphaXiv-like research experience without treating public availability, TCI rank, or another platform's behavior as permission to mirror, transform, or redistribute a paper.

## Consequences

- Catalog size, source-hosted availability, native-reader coverage, and page-citable evidence are reported separately.
- Native reading, extraction, embeddings, translation, and export fail closed unless the exact asset version permits the requested action.
- Private uploads never increase public coverage or enter the public evidence graph without a separate promotion decision.
- The preferred path to a large native corpus is permissively licensed material plus non-exclusive author, journal, and institutional deposits.
