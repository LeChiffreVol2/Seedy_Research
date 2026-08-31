# WebMCP Challenge Submission — Seedy Research

## Candidate status

- Product: **Seedy Research**
- Browser-agent layer: **SeedyMCP**
- Compatibility substrate / first proof vertical: **CivilMCP / Civil Research Pack**
- Working app: <https://civil-mcp-web.vercel.app/>
- Deadline: **September 3, 2026 at 1:00 PM PDT** (**September 4 at 3:00 AM ICT**)
- Public source repository: <https://github.com/LeChiffreVol2/Seedy_Research>
- Public YouTube demo under three minutes: **REQUIRED — add the final URL before submission**
- Verified application candidate commit: [`e681d0c4362722e822784edf0ddb60cfb1a80afe`](https://github.com/LeChiffreVol2/Seedy_Research/commit/e681d0c4362722e822784edf0ddb60cfb1a80afe)
  (the following repository commit changes submission metadata only)
- Candidate deployment IDs: preview `dpl_3P4aH8ibQmgeQEqdfhaFY3BNpipr`; production `dpl_8tmCnMLRVtGEs27soKBJp6WpNhD3`

Do not submit while any `REQUIRED` field above is unresolved. The Devpost entry, video, repository, and supporting text must be public and in English. The repository must expose the MIT license in its About section and remain frozen during judging except for an organizer-approved correction.

## Release verification — September 1, 2026 ICT

- Production build: pass (all routes compiled and type-checked; 23 static pages generated).
- Browser suite: pass, 40/40 serial Chromium scenarios across desktop, mobile, accessibility, research workflows, the real reader-pack route, OpenAlex identity safety, and WebMCP.
- Focused WebMCP contract: pass, 8/8 scenarios including the production-seed three-call Passport Trust Gate, arbitrary-ID rejection, lawful reader enrichment, non-native fail-closed access, global-provider outage, stale-context cancellation, bounded Thai-to-English rendering, and missing-page rejection. The separate OpenAlex adapter contract passes 7/7 scenarios covering explicit bounded anonymous access, metadata-only discovery, exact-DOI verification, fail-soft optional relationship enrichment, title and fuzzy candidates, and ambiguity fail-closed behavior.
- Repository invariants: pass.
- GitHub Actions: CI run `33433688443` and Preview/source-gate run `33433688382` pass for candidate `e681d0c`; protected deploy jobs were not configured for this push, so the same clean candidate was deployed and inspected with the linked Vercel project.
- Security contracts: pass, 21/21.
- Supabase production data quality: pass on the clean candidate SHA; 1,297 indexed documents, zero missing document pages, zero missing chunk embeddings, and zero unknown disciplines. No schema or embedding migration is required by this release.
- Local corpus integrity: pass; 1,300 markdown paper files, 1,299 index-eligible papers, zero page-boundary violations, and zero unresolved probable duplicates. Production still serves the 1,297-document baseline until the reviewed 152-job embedding refresh and exact duplicate cleanup receive explicit approval.
- Production dependency audit: zero high or critical advisories. Five transitive low-severity AI SDK advisories remain; the project maintainer owns an isolated post-challenge major-upgrade test rather than forcing a breaking dependency change into the candidate freeze.
- Rights-reviewed reader slice: live for exactly 3 ThaiJO-hosted
  LEARN Journal papers and 68 checksum-bound pages under the journal's recorded
  CC BY 4.0 statement. Supabase migration `20260831120000` and the reader-pack
  ingest are applied; post-apply checks report zero checksum mismatches and no
  direct `anon`/`authenticated` table reads. Production build, rights/integrity units, repository
  invariants, and focused reader/WebMCP browser, mobile, and accessibility gates
  pass.
- Live deployments: web `dpl_8tmCnMLRVtGEs27soKBJp6WpNhD3` and unchanged MCP
  `dpl_5XJM8JRRNrZSbUF82TqxbehptYoi` are READY production releases. The canonical
  aliases are `https://civil-mcp-web.vercel.app` and
  `https://civil-mcp-server.vercel.app`. Vercel reports the web candidate at
  Git SHA `e681d0c4362722e822784edf0ddb60cfb1a80afe`, target `production`, region
  `sin1`; the stable web alias resolves to that deployment.

Judge expansion contract: [Thai Research Full-Text System](THAI_RESEARCH_FULL_TEXT_SYSTEM.md).

## Full-paper and national-coverage decision — 31 August 2026

The winning product direction includes a rights-aware full-paper reader and a
measured national provider graph. Current production now provides the native
reader for an explicitly bounded proof: exactly 3 rights-reviewed ThaiJO-hosted
LEARN Journal papers, 3 verified assets, and 68 checksum-bound pages under the
journal's recorded CC BY 4.0 statement. Every other paper continues through the
fail-closed access resolver and is never presented as native full text without an
asset-level rights decision.

The repository and production release now contain:

- a machine-readable provider registry covering ThaiJO, separate TCI citation
  data, TNRR, ThaiLIS/TDC, NCCE, broader Thai conferences, institutional
  repositories, OpenAlex, and Scopus;
- a bounded, fixture-tested TNRR `ResearchOutput` metadata connector that never
  downloads full reports or stores abstracts;
- the applied additive canonical work/asset/page/rights/annotation migration;
- a deterministic, rights-reviewed CC BY 4.0 reader pack of exactly 3 ThaiJO
  papers and 68 pages, with checksum and page-count verification and no committed
  PDF binaries;
- a native reader with outline, page search/navigation, stable anchors,
  highlights, browser-local notes, citation/source export, and fail-closed
  `native_verified`, `source_hosted`, `restricted`, `metadata_only`, and
  `unavailable` modes;
- an enrichment to the existing `inspect_paper_evidence` WebMCP flow that reports
  reader access state and a verified reopenable page anchor while keeping full page text out of the
  tool result; the browser contract now exposes exactly six site tools;
- provider-generic Thai discovery while retaining the legacy ThaiJO provider ID;
  and
- an explicit reader and completeness contract in
  [Thai Research Full-Text System](THAI_RESEARCH_FULL_TEXT_SYSTEM.md).

The full-paper reader may be described as **live for this 3-paper proof only**.
Do not describe the database as **complete Thai research**, and do not promote
any additional asset to native reading until it passes all of these gates:

1. each displayed asset has verified storage/display/transformation rights;
2. every reader page resolves to its original asset and stable page number;
3. source-hosted and institution-restricted papers are never proxied as native;
4. annotations reopen against the same asset checksum;
5. a dated provider dashboard separates catalog, readable, and page-citable
   coverage; and
6. desktop, mobile, accessibility, WebMCP, takedown, and rights-revocation tests
   pass on the deployed candidate.

Demo the live pack after the Passport flow: discover a Thai work, open the lawful
reader mode, navigate to an exact page, search within the paper, highlight a
passage, save a local note, and copy its citation. A verified 3-paper proof is
stronger than an unverified claim to host hundreds of thousands of PDFs. Do not
imply that browser-local notes are already workspace-synced or that this small
proof materially changes national provider coverage.

## Submission title

**Seedy Research — Thai-to-Global Research Paths with Exact-Page Evidence**

## One-line pitch

Seedy Research lets a person and browser agent turn a rights-reviewed Thai paper into an exact-page Research Passport that cannot be exported until the person reopens and reviews its evidence; global metadata and candidate gaps remain explicitly unvalidated.

## Devpost description

### The problem

Important Thai research is fragmented across conference proceedings, university collections, and local journals. Global indexes may expose only partial metadata, while generic AI search can blur discovery records, source text, and unsupported claims. Students and researchers lose time finding local work and still have to reconstruct which source page supports each conclusion.

### What Seedy Research does

Seedy Research is built for whole Thai research and begins with a production civil-engineering proof vertical plus a three-paper rights-reviewed ThaiJO reader: 1,300 page-citable records and 11,591 page-linked sections/pages. A separate 2,578-record ThaiJO-hosted catalog brings Explore to 3,878 searchable records without silently treating metadata as evidence. The latest bounded pilot added 198 net-new discovery records with zero full-text downloads or evidence links. This is measurable proof of the ingestion and trust architecture, not a claim of national completeness. OpenAlex adds bounded global research metadata while preserving the same boundary and degrading visibly when unavailable.

The Challenge hero is the Passport Trust Gate. The agent discovers a rights-reviewed ThaiJO paper, opens one exact page, and drafts a Research Passport from only that visible evidence. The page keeps global OpenAlex results non-citable, labels the validation gap unproven, and blocks export. The person—not the agent—must reopen the selected page and acknowledge review before the real Markdown artifact becomes available. The broader Research Path, verified connection mapping, and Next-Study Protocol remain available after the timed proof; they do not dilute its consequential human checkpoint. Reopening a page verifies access to the claimed provenance; it does not establish scientific correctness, novelty, transferability, or a comprehensive literature gap.

### Why WebMCP is essential

Before WebMCP, a browser agent had to infer the meaning of a large research interface, scrape rendered cards, and guess which controls represented citable evidence. Seedy Research now exposes six bounded site tools from the live top-level page. The agent can discover Thai research, open exact-page evidence, trace guarded global relationships, draft a Research Passport, create or adapt a Research Path, and inspect checkpoint progress. Each call updates the same page the person is viewing, so the person can verify, correct, review, and export the work.

This is not a chat wrapper and not merely a remote MCP endpoint. WebMCP is the collaboration layer between an agent and the existing evidence product: it gives the agent structured access to the paper and evidence state the person is already viewing, while the final review and export remain visible human actions.

### What people and agents can do together

1. A person asks the agent to inspect methodological limitations in a rights-reviewed Thai paper about AI-supported English teaching in Thailand.
2. `discover_research` updates Explore and returns `thaijo:learn:291631` as page-citable evidence, separate from discovery metadata.
3. `inspect_paper_evidence` opens `thaijo-learn-291631-page-2`, reports the CC BY 4.0 native-reader state, and returns no full-page text to the agent.
4. `draft_research_passport` uses that one visible anchor and a validation lens; global leads remain non-citable and the candidate inference remains unvalidated.
5. The person reopens page 2, acknowledges review, and only then exports the boundary-preserving Markdown artifact and inspects the immutable three-call run.

The result is a shared research loop: the agent handles structured navigation and bounded drafting; the person remains the source-verification, inference-review, and export boundary. WebMCP is essential because the active paper, visible evidence, and Passport all share live page state that the person can inspect.

## WebMCP implementation

The browser bridge is implemented in `web/lib/webmcp.ts` and wired from `web/app/page.tsx` after the application session is ready.

| Tool | Side effect | Safety and trust boundary |
| --- | --- | --- |
| `discover_research` | Updates the visible Explore query, filters, Thai results, and optional global panel. | `readOnlyHint: true`; external/paper output uses `untrustedContentHint: true`; query, scope, and collection are validated and bounded. |
| `inspect_paper_evidence` | Opens the visible paper drawer and a reopenable page/evidence deep link. | `readOnlyHint: true`; source/evidence/page inputs are bounded; returned excerpts are short and labelled untrusted. |
| `trace_research_connections` | Opens a bounded Thai-to-global connection map for the active citable paper. | `readOnlyHint: true`; structured DOI/title/year matching; only an exact DOI seed may return at most 12 metadata-only nodes; all title-based, conflicting, and ambiguous matches return no graph and require human review. |
| `draft_research_passport` | Creates a visible Thai → Global Research Passport from evidence already opened in the active paper; reopening every selected page and acknowledging page review unlocks Markdown export. | `readOnlyHint: false`; accepts one active public citable source, an 8–180 character focus, one to three visible exact-page evidence IDs, and one gap lens. Private, discovery-only, off-paper, and non-page-linked inputs fail closed. Translation is limited to the selected Thai excerpts and retains the original. OpenAlex leads return `citable: false`; novelty, evidence relation, and transferability remain unestablished. |
| `build_research_path` | Creates or adapts visible local Research Path state, carries selected verified-map leads into planning, and returns a structured provisional gap plus study protocol. | `readOnlyHint: false`; goal, level, outcome, collection, at most four gaps, and at most four exact OpenAlex work IDs are validated; stale or arbitrary lead IDs fail closed; selected global records are untrusted metadata targets, never evidence; `candidate_unvalidated` and `draft_framework` artifacts remain available under deterministic fallback. |
| `inspect_learning_progress` | Reads current stage status, scores, reviewed evidence count, and learning gaps. | `readOnlyHint: true`; raw learner answers are deliberately omitted. |

Implementation details:

- Imperative JavaScript registration through `document.modelContext.registerTool(...)` in the top-level document.
- Six non-overlapping tools with narrow JSON Schemas and `additionalProperties: false`.
- Strict application-code validation in addition to browser schema handling.
- `AbortController` cleanup for React lifecycle changes and execution cancellation support for network requests.
- Per-call request IDs and a research-context revision prevent late discovery, evidence, or Passport responses from replacing newer visible work; changing the query marks a completed Passport out of date.
- The Passport snapshots its own bounded WebMCP run steps, so later tool calls cannot rewrite the displayed provenance trace.
- Connected-zero, rate-limited, unavailable, link-only, and disabled OpenAlex states remain visibly distinct.
- Once an exact DOI seed is verified, optional relationship timeouts no longer erase that verified identity: available metadata-only nodes remain visible, while partial or unavailable enrichment is labelled and can be refreshed.
- Concise structured results; full evidence remains visible in the human interface rather than copied into oversized tool payloads.
- Research Path exports preserve the structured candidate-gap and Next-Study Protocol fields, including missing validation, evidence boundary, and falsification condition; novelty is always explicitly unestablished.
- Same-origin application APIs reuse existing identity, authorization, distributed rate limits, provider timeouts, and evidence-rights boundaries.
- The remote MCP server remains available for workflows that do not depend on an open page; it is distinct from this browser-native WebMCP layer.

## Judge testing instructions

### ChatGPT built-in browser

1. Update the ChatGPT desktop app to the latest version.
2. Use a current account/model configuration where the **Site tools** control is visibly available; record the exact app build, account class, and selected model rather than treating a locally observed model label as an official requirement.
3. Open <https://civil-mcp-web.vercel.app/?view=explore> in the built-in browser.
4. Open **Site tools** in the address bar and confirm these six tools:
   - `discover_research`
   - `inspect_paper_evidence`
   - `trace_research_connections`
   - `draft_research_passport`
   - `build_research_path`
   - `inspect_learning_progress`
5. Use the golden prompts below. No login should be needed for the public preview. If the final candidate requires authentication, add judge credentials to the private Devpost credential field, never to this repository.

### Chrome

1. Use a Chrome version that supports the challenge environment.
2. Enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome.
3. Open the same live URL and inspect/call the registered tools with the WebMCP inspector.

### Deterministic repository test

```bash
cd web
npm ci
npx playwright test tests/e2e/webmcp.spec.ts
```

The test provides a browser-side `document.modelContext` host and verifies all six schemas and annotations. Its focused production-seed scenario invokes discovery → evidence → Passport draft → exact-page reopening → page-review acknowledgment → export and requires an exact three-call run trace. The broader contract then exercises connection tracing, Path, progress, and negative controls separately. It proves that candidate/ambiguous connection matches expose no graph; arbitrary global IDs, discovery-only records, non-visible evidence, private sources, and non-page-linked anchors fail closed; global records remain non-citable; context changes cancel stale work; and Passport export stays disabled until every selected page is reopened and review is acknowledged.

## Golden judge prompt

> Using Seedy Research site tools, find the rights-reviewed ThaiJO paper “A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand.” Open the exact evidence on page 2, then draft a Research Passport for: “How should a longitudinal mixed-methods Thai ELT study test AI learning outcomes beyond novelty effects?” Use the validation gap lens. Keep global results metadata-only, do not claim novelty, and stop before export so I can review.

## Demo video script — 75-second Passport Trust Gate

| Time | Screen and action | Narration |
| --- | --- | --- |
| 0:00–0:05 | Live production URL; open the Site tools menu and show all six tools | Thai research needs more than a summary: people must be able to verify the exact source an agent used. |
| 0:05–0:09 | Send the single prepared prompt | One bounded instruction gives the agent a research goal while reserving review and export for the person. |
| 0:09–0:24 | `discover_research`; the rights-reviewed ThaiJO paper appears separately from discovery metadata | WebMCP gives the agent a typed discovery contract instead of asking it to scrape cards. |
| 0:24–0:36 | `inspect_paper_evidence`; show page 2 and `Read verified full paper` | This is a real CC BY 4.0 Thai paper with a reopenable exact page, not an abstract-only match. |
| 0:36–0:50 | `draft_research_passport`; show page evidence, `OpenAlex · metadata only`, unvalidated inference, and `global records used as evidence: 0` | The agent can organize the research context, but metadata cannot silently become evidence and a suggested gap cannot become proven novelty. |
| 0:50–0:55 | Show disabled Export and `Open every exact page first` | The agent cannot bypass the human checkpoint. |
| 0:55–1:04 | Person reopens page 2 from the Passport and closes the evidence drawer | The person verifies the provenance in the same shared page state. |
| 1:04–1:10 | Person marks pages reviewed; Export enables; download Markdown | Review changes what the product permits, producing a real portable artifact. |
| 1:10–1:15 | Expand `Inspect WebMCP run`; hold on the exact three calls | The result preserves how the evidence was discovered, opened, and drafted. |

Use English narration or complete English captions. Show the real Site tools menu and real tool calls. Do not accelerate away registration or error states. Use only source material and visuals that the team has permission to publish.

## Official judging-criteria alignment

The four Stage Two criteria are equally weighted in the
[official rules](https://webmcp.devpost.com/rules). The Passport sequence is
designed to provide direct evidence for each one:

| Criterion | What the judge sees in the 75-second flow |
| --- | --- |
| WebMCP Leverage | Three structured calls operate on one shared browser state; `draft_research_passport` accepts only evidence already opened in the active paper, creates visible UI state, records the run, and leaves review/export to the person. |
| Execution | A runnable flow fails closed on discovery-only or off-paper inputs, renders bounded fallback behavior, locks export before review, and downloads a real Markdown artifact after review. |
| Potential Impact | A local Thai finding becomes a portable research starting point that retains its exact-page source excerpt and adds a bounded English rendering when available, with explicit next verification work instead of an unsupported summary. |
| Creativity & Ambition | The Passport makes evidence, global metadata, and candidate inference first-class typed layers in one human-agent artifact instead of presenting another generic paper-search chat. |

WebMCP Leverage is also the first tie-break criterion, so the demo must show the
real Site tools menu, calls, shared page mutations, exact-page review gate, and run
trace rather than relying on narration alone.

## Evidence and data-rights statement

- Source code is MIT licensed.
- The MIT license does not grant rights to source papers, extracted text, previews, embeddings, or third-party datasets.
- The public repository contains a synthetic redistributable fixture, not the production paper corpus.
- Current production paper pages expose rights-safe metadata, page ranges, and source links without redistributing raw full text.
- ThaiJO and OpenAlex remain metadata-only by default. The local exception is the explicit 3-paper LEARN Journal pack whose asset actions, license evidence, checksums, and page provenance are recorded; it does not grant rights for any other ThaiJO asset.
- Submission copy must say “structured and curated evidence” rather than implying ownership of the underlying papers or official Thai-government endorsement.

## Meaningful competition-period extension

The pre-existing product already had a Next.js research UI, a remote MCP server, page-linked evidence, Research Path, and evaluation harness. The WebMCP Challenge extension is the browser-native collaboration layer added during the competition period:

- top-level WebMCP registration;
- six bounded, annotated site tools, including fail-closed Thai-to-global relationship tracing;
- the Evidence-bounded Research Passport with active-paper validation, exact-page anchors, metadata-only global leads, candidate-gap framing, human-review gating, and Markdown export;
- shared UI state transitions across discovery, evidence, Passport, learning path, and progress;
- strict browser-tool input validation and cancellation;
- a visible WebMCP readiness indicator;
- deterministic browser execution coverage;
- an official 36-family ThaiJO endpoint registry, duplicate-safe metadata harvesting, whole-issue filtering, and a live `sc01` pilot that adds 198 net-new discovery records without promoting full text;
- a deployed 3-paper/68-page rights-reviewed reader slice and
  fail-closed access resolver, plus reader-access enrichment inside the
  existing WebMCP contract without returning full page text;
- guarded OpenAlex seed resolution plus selected-lead carryover into a Research Path that ends in a candidate gap and Next-Study Protocol;
- this challenge-specific public submission and demo package.

Git history separates the pre-existing baseline from the Challenge work: `1179b09` is the August 20 baseline before the competition window, `e9f8ed8` is the August 31 challenge extension, `9523b7c` is the September 1 pre-release candidate, and `e681d0c` is the verified application candidate containing the final SeedyMCP connection trace and structured Research Path. Do not claim pre-existing product work as new Challenge work.

## Final freeze checklist

- [ ] Register on Devpost with the eligible team representative.
- [ ] Resolve the public repository URL and display the MIT license in repository About metadata.
- [ ] Remove secrets, private corpus files, copyrighted previews, local output, and generated harness reports from the public history.
- [ ] Record the baseline commit and every competition-period WebMCP commit with real timestamps.
- [x] Run `git diff --check` and `python3.10 harness/check_invariants.py`.
- [x] Run `python3.10 -m unittest pipeline.test_reader_pack`, the combined reader/feed units, and the focused `paper-reader.spec.ts` browser suite.
- [x] Run the focused WebMCP E2E with exact-six, fail-closed connection matching, and no-full-page-text assertions.
- [x] Run all 40 local desktop/mobile/reader/OpenAlex/WebMCP E2E scenarios serially.
- [ ] Rerun the judge flow against the frozen deployment candidate in a WebMCP-enabled browser.
- [ ] Run the web build, security checks, strict data quality, live smoke, retrieval eval, memory eval, and quality score against one candidate fingerprint.
- [ ] Test the deployed candidate in ChatGPT's built-in browser with Site tools visibly available; record the exact host/account/model configuration, all six visible tools, and the three-call Passport review/export flow.
- [ ] Test the deployed candidate in Chrome with WebMCP enabled.
- [x] Confirm the live deployment SHA matches the public candidate commit.
- [ ] Record actual demo latency and tool-call count; do not invent a before/after number.
- [ ] Upload a public English YouTube video shorter than three minutes.
- [ ] Complete every Devpost text field in English, add test credentials if needed, and submit before the deadline.
- [ ] Freeze the repository and live candidate during judging unless organizers approve a correction.
