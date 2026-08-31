# Official-Criteria Proof Gap — WebMCP Challenge

**Decision date:** 1 September 2026 (ICT)
**Question:** Against the official judging criteria and first tie-break, which
judge-visible facts distinguish Seedy Research from a generic research wrapper,
which claims still lack proof, and what is the minimum proof that closes the
highest-scoring gap before the deadline?

## Decision

Seedy Research's strongest competitive fact is **not** search, paper chat,
citation chaining, cited synthesis, a research-gap suggestion, or remote MCP.
Current research products already advertise those capabilities. The defensible
WebMCP distinction is a stateful handoff on one live page:

> An agent can only draft a Research Passport from exact-page evidence it has
> already opened in the active Thai paper; the same page then blocks export
> until the person reopens every selected page and acknowledges review, while
> global records remain visibly metadata-only and the candidate gap remains
> unvalidated.

The repository contains strong code and deterministic browser-test evidence for
that behavior. It does **not** yet contain judge-visible proof that the deployed
site tools are discovered and complete the flow in an actual Challenge host.
The required public YouTube URL is also still missing. Because Devpost permits
judges to score only the submitted text, images, and video, the minimum
highest-value action is one uninterrupted, English-audio, sub-three-minute
recording in ChatGPT's built-in browser that shows real site-tool discovery,
real agent calls, visible page mutations, the human-only review gate, and the
real Markdown export. This single proof also completes a mandatory submission
component and directly targets **WebMCP Leverage**, the first tie-break.

Do not broaden the product, add more papers, or run a general scale program
before this proof exists. Those actions do not close the present judging gap.

## What the rules reward

The [Official Rules](https://webmcp.devpost.com/rules) are controlling. Stage
One is pass/fail for theme fit, viability, and reasonable use of the required
technology. Stage Two gives equal weight to:

1. **WebMCP Leverage:** thorough, skillful, genuine, working, non-trivial use;
2. **Execution:** a complete and coherent runnable product experience;
3. **Potential Impact:** a credible, specific problem and real audience,
   addressed by what is demonstrated; and
4. **Creativity & Ambition:** novelty and difference from existing concepts.

Ties are resolved in that listed order, so WebMCP Leverage is the first
tie-break. The same rules also say judges are not required to test the project
and may judge solely from the submission's description, images, and video.
Accordingly, committed code and local test results are enabling evidence, not a
substitute for a legible judge-facing demonstration.

The required package includes a working live URL, an English description of why
WebMCP improves the experience and what people and agents can newly do together,
a public repository with a visible open-source licence, and a public YouTube
demo with audio that is shorter than three minutes and clearly shows the
functioning project and its use of WebMCP. See the
[Challenge overview](https://webmcp.devpost.com/) and
[Official Rules, Submission Requirements](https://webmcp.devpost.com/rules).

OpenAI describes the target as an application that becomes meaningfully better
when people and agents use it together. Its current
[site-tools documentation](https://learn.chatgpt.com/docs/webmcp) says the agent
and person work with the same live page and signed-in session; the browser lets
people inspect available tools, see what changed, and review recently used
calls. Chrome's first-party
[WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp) likewise
emphasizes explicit schemas, shared current-page state, visible execution, and
human trust. These sources make a stateful human-agent handoff stronger evidence
of WebMCP leverage than a narrated tool list.

## Competitive baseline: what is no longer distinctive

The comparison is intentionally limited to first-party product pages and
documentation. It establishes what Seedy must not present as novel; it does not
claim that another product lacks an undocumented capability.

| Capability | Current first-party comparison evidence | Implication for Seedy |
| --- | --- | --- |
| Broad research search and cited synthesis | [Consensus Research Agent](https://consensus.app/home/features/research-agent/) advertises multi-step search, DOI lookup, citation crawling and gap matrices over more than 220 million papers. [Consensus's MCP documentation](https://docs.consensus.app/docs/mcp) exposes paper search to ChatGPT and other MCP clients. | “AI research search,” a cited answer, a research agent, or an MCP endpoint is category parity, not the hero. |
| Full-text or page-filtered paper answers | [AlphaXiv's MCP documentation](https://www.alphaxiv.org/docs/mcp) documents 19 remote tools, including raw full-text retrieval and page-filtered PDF answers for citation. | Exact pages matter, but exact-page retrieval alone is not a novelty claim. The differentiator must be the visible provenance-and-review transition. |
| Citation graph, libraries, and research workflows | [Consensus's product changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog) documents a citation graph, libraries, collection chat and citation export. AlphaXiv documents discovery, paper/code reading, people, affiliations and library tools in its MCP surface. | Do not spend scarce demo time touring generic library, graph, or workflow breadth. |
| Shared editable artifact | OpenAI's [WebMCP showcase](https://developers.openai.com/showcase) features agent-collaborative notes, editable itineraries, crosswords, 3D models, image editing and shared carts. | Shared-state collaboration is the Challenge baseline. Seedy must show why its human checkpoint is consequential, not merely that the UI changes. |

Seedy's judge-facing distinction is therefore the **combination** of five facts:

1. the tools act on the same live research page and session the person sees;
2. later tools depend on earlier visible state, rather than accepting arbitrary
   paper, evidence, or global IDs;
3. the person performs a consequential action the agent cannot silently bypass:
   reopening exact pages and acknowledging review before export;
4. the exported artifact preserves typed boundaries between Thai page evidence,
   global metadata leads, and an unvalidated candidate inference; and
5. the use case operates on measured Thai evidence and lawful reader modes,
   rather than presenting a generic global-paper chat with Thai branding.

## Proof audit

The distinction below is essential:

- **Implemented proof** means it is inspectable in committed source or a
  deterministic test.
- **Operational proof** means the public deployment or repository can be checked
  independently now.
- **Judge-visible proof** means it is already present in the material a judge is
  guaranteed to receive.

| Fact or claim | Proof present now | Proof gap | Criterion at risk |
| --- | --- | --- | --- |
| Six browser-native tools are registered with bounded schemas and annotations. | [`web/lib/webmcp.ts`](../../../web/lib/webmcp.ts) registers exactly six tools through `document.modelContext.registerTool`. [`web/tests/e2e/webmcp.spec.ts`](../../../web/tests/e2e/webmcp.spec.ts) asserts the names, schemas, read/write hints and untrusted-content hints. | The test injects a deterministic browser-side host. There is no recorded actual-host discovery/pass in ChatGPT or WebMCP-enabled Chrome. | WebMCP Leverage; Stage One viability. |
| Tool calls mutate one shared visible research state. | The focused E2E invokes discovery, evidence inspection, connection tracing and Passport drafting, then asserts corresponding visible UI. The implementation stores the tool-run steps in the rendered Passport. | No judge-visible real-agent call sequence currently proves that the deployed host discovers and invokes those tools rather than a test harness calling JavaScript directly. | WebMCP Leverage; Execution. |
| The Research Passport enforces a human review/export boundary. | The focused E2E proves arbitrary or non-visible evidence fails, export starts disabled, every exact page must be reopened, review acknowledgment then unlocks a real Markdown download, and the run trace remains visible. | This is the most important behavior and is currently only described in text/tests. It must be shown, including the blocked state, in the actual-host video. | WebMCP Leverage; Execution; Creativity. |
| Thai evidence, OpenAlex metadata, and candidate inference remain separate. | The UI/test visibly asserts exact-page Thai evidence, `OpenAlex · metadata only`, `global records used as evidence: 0`, and that novelty/transferability are not established. The exported Markdown retains those sections. | A judge may read this as safety narration unless the video shows the three layers and exported result. | Execution; Creativity; trust component of Impact. |
| The project is a meaningfully extended pre-existing product. | Git history provides a pre-window baseline `1179b09` (20 Aug), a Challenge-period extension `e9f8ed8` (31 Aug), and verified application candidate `e681d0c` (1 Sep). The [submission package](../../WEBMCP_CHALLENGE_SUBMISSION.md) now separates pre-existing UI, corpus, remote MCP, Path and Workspace from the browser-native Challenge work. | The dated delta is documented in-repo but still needs to be copied exactly into the Devpost entry/final video description. A commit timestamp supports the history; it does not excuse an inaccurate development claim. | Eligibility and score scope. |
| The public app and repository are reachable. | A 1 Sep read-only check returned HTTP 200 for `https://civil-mcp-web.vercel.app/`; its response included `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. GitHub reported [`Seedy_Research`](https://github.com/LeChiffreVol2/Seedy_Research) public with an [MIT licence](https://github.com/LeChiffreVol2/Seedy_Research/blob/main/LICENSE). | The freeze checklist still marks repository URL/licence resolution incomplete and should be reconciled. HTTP and headers do not prove real host tool discovery or a completed flow. | Execution; submission compliance. |
| The application is coherent and production-like. | The [submission package](../../WEBMCP_CHALLENGE_SUBMISSION.md) records a deployed candidate, passing build, focused WebMCP scenarios, broader browser suite, security checks and bounded reader proof. | The remaining checklist still lacks one frozen-candidate release run, actual-host passes, actual demo timing/tool count, final Devpost submission and freeze. Generated local claims should not be the video's main evidence. | Execution. |
| The product solves a real problem for Thai researchers and students. | The repo measures 3,875 searchable records, 1,297 page-citable papers, 11,523 page-linked sections, and a deliberately bounded 3-paper/68-page native reader. The problem and audience are specific. | No dated target-user task, attributable quote, before/after time, or verified task-completion result is recorded. The corpus establishes supply, not user impact. | Potential Impact. |
| “Whole Thai research” or broad full-paper coverage is live. | The repository correctly labels this as an ambition and separates discovery, evidence and lawful reader coverage. | National completeness and broad full-paper availability are unproven. Current native full-paper proof is exactly 3 papers/68 pages. Do not imply otherwise. | Credibility across Impact and Execution. |
| The flow is fast and reliable under judge conditions. | Deterministic tests exercise cancellation, provider degradation and fail-closed behavior. | Actual real-host elapsed time, tool count, confirmation interruptions and failure rate remain unrecorded. Capacity and 100-user traffic targets are not Challenge proof. | Execution, but secondary to real-host completion. |
| Required demo and final submission exist. | The demo script and English copy are drafted. | The submission package still says `REQUIRED — add the final URL`; Devpost completion is unchecked. This is a hard submission gap, not a polish item. | Eligibility/submission completeness and every scored criterion. |

## Ranked minimum judge-visible proof

### P0 — One real-host proof film

Record and publish one continuous run in **ChatGPT's built-in browser using a
site-tools-capable model**, not the deterministic shim and not only the Chrome
inspector. Keep the video comfortably below three minutes and use English audio
or complete English narration/captions. The
[OpenAI site-tools documentation](https://learn.chatgpt.com/docs/webmcp)
currently directs users to GPT-5.6 Sol or Terra and says Luna has site tools
disabled; verify the current host immediately before recording.

The shortest sufficient sequence is:

| Time | Visible proof | Why it earns score |
| --- | --- | --- |
| 0:00–0:10 | Production URL, one-sentence Thai-research problem, Site tools menu showing the six tools. | Establishes a live WebMCP app and specific audience. |
| 0:10–0:30 | Agent calls `discover_research` then `inspect_paper_evidence`; Explore and the paper drawer visibly change to an exact page. | Proves structured calls and shared state rather than browser scraping or a remote-only answer. |
| 0:30–0:50 | Agent calls `trace_research_connections`; show exact-DOI match and a relation labelled metadata-only/non-citable. | Proves the next tool depends on the active verified seed and exposes a useful trust boundary. |
| 0:50–1:10 | Agent calls `draft_research_passport` from the evidence already open; show Thai evidence, global leads and unvalidated candidate gap together. | Shows a non-trivial stateful composition unavailable to an arbitrary chat wrapper. |
| 1:10–1:30 | Attempt export while locked; the person reopens the exact page, acknowledges review, then exports Markdown. | This is the decisive human-agent handoff and complete product outcome. Do not cut away from the blocked state. |
| 1:30–1:45 | Open the WebMCP run trace and the downloaded Markdown boundary; show `global records used as evidence: 0`. | Makes tool use and the durable result independently legible. |
| 1:45–2:00 | Final card: live URL, public repo, candidate SHA, baseline→Challenge commit comparison, and bounded corpus/full-paper figures. | Supports execution, eligibility scope and impact without overclaiming. |

If the real host cannot reliably complete this sequence, that is a release
blocker. Recording a scripted local browser or inspector call would complete the
video format but would leave the first-tie-break proof gap open.

### P0 — Attach a compact host-verification record

Alongside the video, record the date, host/app version, model, production URL,
candidate SHA, six discovered tool names, exact prompt, call sequence, total
elapsed time, confirmations, result, and exported filename. Repeat once in
Chrome 149+ with `chrome://flags/#enable-webmcp-testing` if time permits, because
the official rules name both testing routes. ChatGPT is the recording priority
because it proves actual agent selection and invocation, whereas an inspector
can prove registration/schema parsing but not the whole agent experience.

### P0 — Reconcile the submission packet

Before submission:

1. put the public YouTube URL into Devpost and the submission package;
2. put the exact pre-existing-versus-new commit statement in the Devpost text;
3. update stale checklist items whose public repo and MIT licence are now
   independently visible;
4. test the live URL signed out and ensure any credentials/instructions are in
   the correct Devpost field;
5. submit before the official deadline; and
6. freeze the submission, repository and live deployment through judging, as
   directed by the [Devpost FAQ](https://webmcp.devpost.com/resources).

### P1 — Add one honest user outcome only if P0 is complete

A single moderated run with a Thai graduate student/researcher can strengthen
Potential Impact. Record the task, whether they reached the exact page, whether
the exported citation matched it, elapsed time, and one consented quote. Label
the sample as `n=1`; do not turn it into a population claim. This is valuable,
but it must not delay the mandatory video or actual-host verification.

## What not to do before submission

- Do not add a large metadata harvest or more full papers merely to raise a
  corpus number.
- Do not present generic search, paper chat, citation graphs, research gaps,
  summaries or remote MCP as the novel contribution.
- Do not claim national completeness, proven novelty, scientific validation,
  transferability, or impact percentages without evidence.
- Do not make a broad architecture, schema, dependency or product-identity
  migration that risks the frozen candidate.
- Do not prioritize load testing, billing or the post-Challenge institution
  business model over the actual-host judge flow. They belong on later maps.

## Completion test for this decision

The highest-scoring gap is closed when an unfamiliar reviewer can watch the
submitted video and answer **yes**, without reading source code, to all five:

1. Did a real agent discover and call the site's WebMCP tools?
2. Did those calls visibly operate on one shared browser state?
3. Did a later tool depend on evidence opened by an earlier tool?
4. Did the person perform a review action the agent could not bypass before a
   real artifact was exported?
5. Could the reviewer distinguish page evidence, global metadata and candidate
   inference in both the UI and export?

If those answers are visible, Seedy Research reads as a non-trivial WebMCP
collaboration product. If they are only narrated or documented, it can still be
mistaken for a generic research wrapper with a tool registry.

## Primary sources

- OpenAI, [WebMCP Challenge](https://openai.com/webmcp-challenge/)
- Devpost, [Challenge overview and submission requirements](https://webmcp.devpost.com/)
- Devpost, [Official Rules](https://webmcp.devpost.com/rules)
- Devpost, [Resources and FAQ](https://webmcp.devpost.com/resources)
- OpenAI, [Site tools](https://learn.chatgpt.com/docs/webmcp)
- OpenAI, [WebMCP showcase](https://developers.openai.com/showcase)
- Google Chrome, [WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- AlphaXiv, [MCP Server Documentation](https://www.alphaxiv.org/docs/mcp)
- AlphaXiv, [Explore / product positioning](https://www.alphaxiv.org/)
- Consensus, [Research Agent](https://consensus.app/home/features/research-agent/)
- Consensus, [MCP documentation](https://docs.consensus.app/docs/mcp)
- Consensus, [Product changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog)
