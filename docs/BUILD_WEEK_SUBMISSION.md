# Build Week Submission Runbook

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

## Human citation audit

Run five curated prompts and inspect four claims per answer. Record 20 rows with:

| Prompt | Claim | Evidence ID | Source/page exists | Claim supported | Collection correct | Pass/fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NCCE25 CEM14/CEM28/CEM04 risk comparison |  |  |  |  |  |  |  |
| Y2024 G01 vs NCCE29 TRL42 road safety |  |  |  |  |  |  |  |
| NCCE25 MAT06/MAT13/MAT18 methodology |  |  |  |  |  |  |  |
| Water/infrastructure synthesis |  |  |  |  |  |  |  |
| E1 follow-up continuity |  |  |  |  |  |  |  |

The candidate fails this manual gate if any cited page does not exist, a material claim is unsupported, a collection/source is misidentified, or an evidence marker is fabricated.

## Final release sequence

1. Run all source, security, data-quality, web, smoke, eval, memory, and score gates.
2. Deploy a preview from the exact candidate commit.
3. Verify desktop, mobile, incognito guest, error, quota, translation, and citation flows.
4. Stage production artifacts from the same commit and smoke the staged URLs.
5. Promote the tested MCP artifact, then the tested web artifact.
6. Confirm canonical aliases point to the tested deployment IDs and inspect production error logs.
7. Run `/feedback`, update the submission record, create/share the private repository, and submit Devpost.
