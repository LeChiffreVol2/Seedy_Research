# Historical Build Week Submission Runbook

> This file records the earlier OpenAI Build Week package and is not the WebMCP Challenge submission. For the current public-repository requirements, browser-native tool implementation, judge flow, and video script, use [WEBMCP_CHALLENGE_SUBMISSION.md](WEBMCP_CHALLENGE_SUBMISSION.md). Do not copy the private-repository or 941-paper details below into the WebMCP entry.

## Devpost package

- Track: Education.
- Product label: Public Research Preview.
- Public app: `https://civil-mcp-web.vercel.app/`.
- Source repository: private; target not yet selected.
- Required judge collaborators: `testing@devpost.com`, `build-week-event@openai.com`.
- License: MIT for code; dataset rights excluded.
- Demo data: `fixtures/synthetic-civil-paper.json`.
- Primary Codex task: `019f7eb2-9fd5-7eb1-ba9e-3999c59189fe`.
- `/feedback` ID: capture from the final implementation task before submission.

Do not mark the submission ready until a clean clone passes the documented setup and both judge collaborators can access the private repository.

## Video script — maximum 3 minutes

| Time | Demonstration | Message |
| --- | --- | --- |
| 0:00 | Hero and corpus proof | Thai civil-engineering evidence is fragmented; CivilMCP structures 941 papers into page-linked evidence. |
| 0:20 | Search and collection filters | Show CE Project and NCCE coverage and open a real paper. |
| 0:45 | Cross-paper prompt with Luna | Ask for a transport or construction comparison with exact pages. |
| 1:25 | Evidence cards and paper drawer | Open E1 and verify source, section, and page range. |
| 1:50 | English paper mode and follow-up | Translate the paper surface, then ask a follow-up grounded in E1. |
| 2:10 | Build Week delta | Show Luna defaults, bounded retrieval, Codex provenance, and the Civil/City boundary. |
| 2:35 | Quality and public link | Show current gate results, research disclaimer, and public URL. |

Use English narration or English captions. Never claim exclusive ownership of the source papers; describe the corpus as uniquely structured and curated.

## Human citation audit — July 20, 2026

The final candidate `5de678b` was audited with GPT-5.6 Luna against five
curated prompts. The 20 sampled material claims below passed source, page,
support, collection, and evidence-ID checks. Comparative decision-use claims
were accepted only when the answer explicitly labelled them as inference.

| Prompt | Sampled claim | Evidence | Source/page exists | Claim supported | Collection correct | Result |
| --- | --- | --- | --- | --- | --- | --- |
| CEM14/CEM28/CEM04 risk comparison | Shop Drawing, owner, and staffing delays | E3 · NCCE25_CEM14 p.132 | Yes | Yes | Yes | Pass |
| CEM14/CEM28/CEM04 risk comparison | Fault-tree analysis links delay-risk causes | E1 · NCCE25_CEM28 p.246 | Yes | Yes | Yes | Pass |
| CEM14/CEM28/CEM04 risk comparison | Current-expense and budget monitoring addresses financial obstacles | E2 · NCCE25_CEM28 p.246 | Yes | Yes | Yes | Pass |
| CEM14/CEM28/CEM04 risk comparison | Planning deficiencies and PERT address activity-duration risk | E4/E6 · NCCE25_CEM04 p.50 | Yes | Yes | Yes | Pass |
| TRL40/TRL42 road-safety comparison | Heavy loads and high speed are linked to severe truck crashes | E2 · NCCE29_TRL40 p.2046 | Yes | Yes | Yes | Pass |
| TRL40/TRL42 road-safety comparison | Sharp curves and steep slopes are site-specific risk context | E1 · NCCE29_TRL40 p.2047 | Yes | Yes | Yes | Pass |
| TRL40/TRL42 road-safety comparison | TRL42 groups factors as human, vehicle, and road/environment | E3 · NCCE29_TRL42 p.2067 | Yes | Yes | Yes | Pass |
| TRL40/TRL42 road-safety comparison | Vehicle-related factor share declined; cross-paper contrast is marked inference | E4 · NCCE29_TRL42 p.2067 | Yes | Yes | Yes | Pass |
| MAT06/MAT13/MAT18 materials comparison | MAT06 tests strength, density, flow, and reports 313–432 kg/cm² | E1 · NCCE25_MAT06 p.1613 | Yes | Yes | Yes | Pass |
| MAT06/MAT13/MAT18 materials comparison | MAT06 uses recycled asphaltic concrete aggregate | E4 · NCCE25_MAT06 p.1613 | Yes | Yes | Yes | Pass |
| MAT06/MAT13/MAT18 materials comparison | MAT13 uses W/C 0.30 and 10 × 20 cm cylinders | E5 · NCCE25_MAT13 p.1656 | Yes | Yes | Yes | Pass |
| MAT06/MAT13/MAT18 materials comparison | MAT18 tests steel-fibre concrete compression and permeability | E2/E3 · NCCE25_MAT18 p.1690 | Yes | Yes | Yes | Pass |
| WRE04/WRE28 water comparison | WRE04 uses short-range WRF-ROMS rainfall inputs | E3 · NCCE29_WRE04 p.2181 | Yes | Yes | Yes | Pass |
| WRE04/WRE28 water comparison | WRE04 reports RMSE below 0.20 m as acceptable | E4 · NCCE29_WRE04 p.2181 | Yes | Yes | Yes | Pass |
| WRE04/WRE28 water comparison | WRE28 uses SWAT, GFDL-ESM4, SSP126, and SSP585 | E2 · NCCE29_WRE28 p.2370 | Yes | Yes | Yes | Pass |
| WRE04/WRE28 water comparison | WRE28 produces WSI scores/maps; planning use is marked inference | E1 · NCCE29_WRE28 p.2370 | Yes | Yes | Yes | Pass |
| INF03/EEC02 infrastructure comparison | INF03 models a three-span prestressed bridge with finite elements | E3 · NCCE25_INF03 p.1537 | Yes | Yes | Yes | Pass |
| INF03/EEC02 infrastructure comparison | INF03 compares Thai DOH and AASHTO truck-load standards | E4 · NCCE25_INF03 p.1537 | Yes | Yes | Yes | Pass |
| INF03/EEC02 infrastructure comparison | EEC02 applies the UIC 406 capacity method | E2 · NCCE25_EEC02 p.10 | Yes | Yes | Yes | Pass |
| INF03/EEC02 infrastructure comparison | EEC02 reports 100% TPLS and 49% single-track capacity use | E1 · NCCE25_EEC02 p.17 | Yes | Yes | Yes | Pass |

Gate result: **20/20 pass**. No cited page was missing, no cited marker
pointed outside the returned evidence set, and no collection/source was
misidentified. The mixed CE Project/NCCE audit also exposed and led to the
cross-collection exact-source routing fix in `5de678b`; unpaged CE evidence is
now disclosed rather than represented as an exact-page citation.

## Final release sequence

1. Run all source, security, data-quality, web, smoke, eval, memory, and score gates.
2. Deploy a preview from the exact candidate commit.
3. Verify desktop, mobile, incognito guest, error, quota, translation, and citation flows.
4. Stage production artifacts from the same commit and smoke the staged URLs.
5. Promote the tested MCP artifact, then the tested web artifact.
6. Confirm canonical aliases point to the tested deployment IDs and inspect production error logs.
7. Run `/feedback`, update the submission record, create/share the private repository, and submit Devpost.
