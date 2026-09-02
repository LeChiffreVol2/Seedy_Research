# ThaiJO–OpenAlex Visibility Audit — 2 September 2026

## Published bounded result

- ThaiJO source cohort denominator: 2,681 active Seedy catalog records.
- Exact-DOI records attempted: 836.
- Exact identities with no recorded local metadata gap: 27.
- Exact identities whose Seedy local record contains metadata/access signals not represented in the selected OpenAlex fields: 805.
- Exact DOI not resolved by the OpenAlex singleton work endpoint in this dated run: 4.
- Provider-unavailable attempts: 0.
- Run state: partial, because 1,845 records without a usable DOI still require the title/author/year candidate pass.
- Method: `seedy-openalex-visibility-v2-singleton-doi`.

These counts are not a national-coverage percentage and do not prove permanent
absence from OpenAlex, Google Scholar, Scopus, or any other system. “No exact
match” means only that the DOI did not resolve through the OpenAlex singleton
work endpoint during this dated run. Candidate title matches will remain review
queues rather than automatic identities.

## Quality incident caught before release

An earlier unpublished method used OpenAlex's documented DOI OR-filter. Manual
cross-checking found that several Thai DOI records resolved through the singleton
endpoint but did not appear in the filter result. Seedy retained that run as
audit history but superseded it with the singleton method before exposing the
summary. Three sampled DOI records moved correctly from false not-found to
`under_indexed` in the replacement run.

## Golden-demo records

The dated no-exact-match set contains four metadata-only ThaiJO records. They may
demonstrate local discovery plus a visibility receipt and source-record handoff,
but they cannot be used as page evidence until rights and page provenance pass
the normal promotion gate. The end-to-end exact-page and relationship control
must therefore use a separate rights-reviewed native paper with an exact DOI.

This deliberate two-paper demo prevents a metadata-only record from being
presented as evidence and prevents an exact-match control from masquerading as
the globally overlooked hero.
