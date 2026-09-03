# Repository readiness plan

Status: Q1–Q9 implemented; dated local evidence below and commit-specific results in GitHub Actions.

## Objective

Make the existing Seedy Research repository coherent, reproducible, and credible
to first-time evaluators. This is not a new feature expansion or a promise of
competition success.

## Accepted scope

- Retain the existing repository URL and Git history.
- Prioritize factual documentation, repository boundaries, release evidence,
  and fresh-clone verification. Change application code only where these reveal
  a correctness or reproducibility gap.
- Preserve a recoverable archive tag before removing the CityMCP application
  and its three manual workflows from the active tree. Do not create another
  repository, rewrite history, delete deployments, or delete database data.
- Preserve applied migrations and operational compatibility contracts, including
  civil_* identifiers and the remote MCP endpoint. A separate database baseline
  or identifier migration is outside this cleanup.
- Replace Seedy harness checks that require CityMCP files with isolation checks
  in the same change as the extraction.
- Retain the Production Preview maturity boundary and the whole-Thai,
  end-to-end research ambition. Correct demonstrably stale statements. When
  implementation and a product promise differ, report the evidence and ask
  before reducing scope, hiding a feature, or changing the promise.
- Separate implemented, verified, and planned capabilities. Link verification
  to a specific application revision, environment, date, and test scope.
- Make a fresh-clone fixture workflow a release gate. Fixture responses must be
  explicitly identified and cannot stand in for live retrieval evaluation.
- Keep source rights, privacy limits, and known issues visible in concise,
  linked documentation rather than deleting them for presentation purposes.

## Confirmed source discrepancies

Audit baseline: GitHub main ada8036a8674b61179344185c19e46a447517e0c.

- README describes the replaced Workspace-bound, non-persistent Notebook.
- Submission documentation presents an older candidate revision as frozen.
- Current and historical tool inventories disagree.
- CityMCP is excluded from web deployment but still required by Seedy invariants.
- Quick start assumes an already-populated database.
- Current product facts, historical test results, strategy, and operator notes
  are mixed in the public entry documents.

## Publication boundary

The organizer announced a 12-hour extension to September 4, 2026, 01:00 PDT
(08:00 UTC; 15:00 Asia/Bangkok):
https://webmcp.devpost.com/updates

The user confirms the same repository URL is already supplied. A stable URL
does not waive the submission freeze: complete permitted changes before the
extended deadline, and do not assume permission to modify the submitted
repository or live application afterward.

## Final accepted decisions

- English-first public entry documents; retain history through explicit links.
- A credential-free fresh-clone gate reuses existing fixtures and application
  code. Fixture passes never substitute for live or actual-host verification.
- Preserve features. Fix bounded correctness/reproducibility issues, and ask
  before interpreting an uncertain product mismatch as a scope reduction.
- Sequence archive isolation, public documentation, and reproducibility work
  as reviewable commits. Verify before pushing. Deploy only for runtime changes.

## Progress

- Published the annotated CityMCP archive tag at baseline `ada8036`.
- Removed 69 archived application files and three manual workflows from the
  active tree; retained applied migration history and all deployed data.
- Updated the Notebook description and public tool inventory to match source.
- Added linked dated coverage details and separate fixture/live test scopes.
- Source-only fresh-copy verification passed: 21 security, 74 Python unit,
  27 web unit, and 21 Chromium fixture checks, plus the production build.
- Reader UI tests now use a committed paper shell; previously they depended
  on a production-only NCCE record before browser mocks could run.
- CI and the release source-gate both enforce the credential-free contracts.
  [GitHub Actions](https://github.com/LeChiffreVol2/Seedy_Research/actions)
  is authoritative for the published revision's result; this plan is not a
  substitute for its status or a production deployment receipt.
