# WebMCP judge-host acceptance contract

**Question:** What exact host, browser/version, authentication state, tool-discovery semantics, permissions behavior, and reproducible evidence must SeedyMCP pass in real ChatGPT and Chrome WebMCP environments so the Challenge flow is proven beyond the Playwright shim?

**Research date:** 2026-09-01 (Asia/Bangkok)

**Source policy:** Challenge requirements come from the controlling Devpost rules and first-party OpenAI pages. Browser behavior comes from the current WebMCP Community Group draft and first-party Chrome documentation. No secondary source is used.

## Decision

Adopt a **dual-host frozen-candidate gate**:

1. **ChatGPT host pass:** the public production candidate is opened as the top-level page in the latest ChatGPT desktop app's built-in browser, from a fresh signed-out site session, using an account and selected model for which Site tools are visibly available. The address-bar Site tools UI must discover the exact six SeedyMCP tools and the browser agent must complete the golden flow through real tool calls that update the shared page.
2. **Chrome host pass:** the same immutable deployment is opened in Chrome with native WebMCP enabled. Use Chrome **150.0.7861.0 or later** for the reproducible inspector profile even though the Challenge minimum is Chrome 149+, because the current official Model Context Tool Inspector listing names 150.0.7861.0 as its minimum. Chrome DevTools must show the exact six tools and their schemas, and native invocation must complete all six without schema or lifecycle errors. A natural-language pass through the inspector then proves model selection and orchestration.
3. **Evidence pass:** preserve the candidate commit, deployment URL, exact host builds/settings, authentication state, discovered inventory, prompts, inputs, outputs, permissions/confirmations, timings, and visible before/after state. One successful manual run without those records is not reproducible proof.

The Challenge rules require a working live URL reachable in ChatGPT's in-app browser **or** Chrome 149+ with WebMCP enabled. Requiring both is Seedy Research's stronger internal release gate, not a rule imposed by the Challenge. The rules also allow judges to skip live testing and judge from the submitted description, images, repository, and video; therefore the `<3 minute` video must visibly contain a real host's tool discovery and tool calls, not only application UI or Playwright output. [Official Rules](https://webmcp.devpost.com/rules) · [Challenge resources](https://webmcp.devpost.com/resources)

Until the two host passes and their evidence bundle exist against one frozen deployment, the correct status is **actual-host compatibility not yet proven**.

## What the official material actually requires

| Area | Confirmed fact | Consequence for SeedyMCP |
| --- | --- | --- |
| Supported judge hosts | Entrants are told to use the ChatGPT desktop app's in-app browser, which supports WebMCP by default, or Chrome 149+ after enabling `chrome://flags/#enable-webmcp-testing` and restarting. Judges may use either. | Test the same URL in both. Do not substitute the Codex Chrome extension, a cloud browser, a normal Chrome session without WebMCP, or the Playwright shim for either pass. |
| Live access | A live URL must be reachable in one of those hosts. Authentication is allowed if credentials are supplied in the private submission field. The project must remain free and unrestricted for judging through the end of the judging period. | Prefer the current public guest flow. If authentication becomes necessary, test the credentials in the ChatGPT built-in browser's separate cookie jar and place them only in Devpost. |
| ChatGPT availability | Site tools are available only when the account and selected model support them, the page exposes them, and Site tools are enabled. OpenAI does not publish a minimum desktop build or an exhaustive account/plan/model matrix on the Challenge or Help pages. | Record the exact app build, account/workspace class, and selected model that passed. Do not present “Sol/Terra required” or “Luna unsupported” as an official requirement unless OpenAI publishes it; those can only be dated local observations. |
| ChatGPT discovery | A gray arrow appears in the built-in browser's address bar when Site tools are available; it turns blue during use. The menu shows the tools and whether they read or change information. ChatGPT can discover a matching tool automatically, and “recently used” plus conversation Sources show calls after execution. | The arrow, exact inventory, read/change classification, active-call state, recently-used list, and Sources trace are the host-native evidence. A console check of `document.modelContext` is insufficient. |
| Page and session scope | Site tools work on the open page, its current state, and that browser's signed-in session. They are available only while the page is open, do not carry to another page/tab, and tools supplied only by embedded content are not currently supported in ChatGPT. | Register from the top-level Seedy Research document. Open the exact judge route directly and keep it open throughout the flow. The current top-level approach is correct. |
| ChatGPT permissions | ChatGPT asks for website access before interaction and rechecks each call. It requires confirmation for sensitive data sharing or actions such as purchases, deletion, permission changes, or sending messages. Website/tool text cannot grant that permission. Site tools can be disabled in Browser settings → Permissions. | Capture the first website-access prompt and every additional confirmation. A confirmation is expected host behavior, not a failure. The pass fails if the action occurs after denial, the prompt cannot be completed, or the page and tool result disagree. |
| Chrome enablement | Chrome documents the testing flag and an origin trial beginning with Chrome 149. The current official inspector extension listing requires Chrome 150.0.7861.0+ with “WebMCP for testing” enabled. | Pin and record the full Chrome build, flag state, restart, and inspector version. Use 150.0.7861.0+ for repeatable inspector evidence while retaining 149+ as the Challenge's formal floor. |
| Chrome evidence surfaces | The DevTools Application → WebMCP pane lists available tools and records invocation status, exact input, output/error, and invocation counts. It can also run a tool manually. The official inspector can list, manually invoke, and use a model to select tools. | Use DevTools for deterministic native discovery/execution and the inspector for probabilistic natural-language selection. These prove different failure layers and both are needed for the Chrome pass. |
| Judging | Stage One is pass/fail for viability/theme/reasonable WebMCP use. Stage Two weights WebMCP Leverage, Execution, Potential Impact, and Creativity & Ambition equally; WebMCP Leverage is the first tie-break. | Host proof should show a coherent multi-call workflow sharing visible page state, not six disconnected API demos. |

Sources: [Official Rules](https://webmcp.devpost.com/rules), [OpenAI Challenge page](https://openai.com/webmcp-challenge/), [OpenAI: Using site tools](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app), [OpenAI: Built-in browser](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app), [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp), [Chrome WebMCP DevTools pane](https://developer.chrome.com/docs/devtools/application/webmcp), [official inspector listing](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd).

## Native browser contract the shim does not prove

The current draft is a W3C Web Machine Learning Community Group report, not a W3C Standard, and it is explicitly still evolving. Its current producer API is `document.modelContext.registerTool(...)` in a secure context. Registration requires a fully active, origin-keyed document allowed to use the `tools` Permissions Policy; the default allowlist is `'self'`. Duplicate names, empty/invalid names or descriptions, non-serializable schemas, a pre-aborted registration signal, or denied policy must reject registration. The registration `AbortSignal` unregisters the tool. A separate execution signal tells the callback that an invocation has been cancelled. [WebMCP draft](https://webmachinelearning.github.io/webmcp/) · [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

The browser agent does **not** discover tools by calling the public `getTools()` API. The specification says that method is for in-page JavaScript agents and that the user agent's browser agent uses a separate internal mechanism. The shape of the browser-agent observation is implementation-defined. Therefore all of the following can pass while the judge host still fails:

- source contains `registerTool`;
- the Playwright initializer injects a compatible `document.modelContext` object;
- six callbacks are present in the shim's `Map`;
- direct callback calls pass deterministic assertions; or
- an in-page script can enumerate tools.

Only native host discovery plus native invocation proves that registration survived the real browser's security, schema serialization, lifecycle, observation, and agent bridge. [WebMCP draft: ModelContext and browser-agent observations](https://webmachinelearning.github.io/webmcp/)

Chrome's current producer guidance also recommends `readOnlyHint` for non-mutating tools, `untrustedContentHint` for external/user content, and tight text budgets: about 500 characters per tool description, 150 per parameter description, 30 per name, and 1.5K per tool output. These are current Chrome recommendations rather than Challenge pass/fail limits. [Chrome tool-security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

## Exact internal acceptance matrix

The frozen candidate passes only when every mandatory row is evidenced.

| Check | ChatGPT built-in browser | Chrome native WebMCP |
| --- | --- | --- |
| Host identity | Record macOS/Windows version, ChatGPT app full build, chat surface (`Work` or `Codex`), account/workspace class, selected model, and Site tools setting. | Record OS, Chrome full build (reproducible profile: `>=150.0.7861.0`), `#enable-webmcp-testing=Enabled`, restart time, DevTools version, and inspector version if used. |
| Candidate identity | Same HTTPS URL, query route, immutable Git SHA, deployment identifier, and timestamp as Chrome. | Same candidate identity as ChatGPT. No later alias drift. |
| Authentication | Start signed out of Seedy Research and complete the guest flow. Record that the ChatGPT built-in browser has its own fresh browser state. If auth is unavoidable, use only Devpost-supplied credentials. | Start signed out in a clean profile/incognito-compatible test profile; complete the same guest flow. |
| Permissions and platform preflight | Site tools enabled; approve the fresh website-access prompt; record any later confirmation and its reason. | HTTPS secure context; top-level document; origin isolation enabled; `Permissions-Policy: tools=(self)` or an equivalent policy that permits the top-level page; no registration error. |
| Discovery | Address-bar arrow appears; menu lists exactly the six names below after app/session readiness; read/change classifications agree with annotations. | DevTools Available Tools lists exactly the same six names with descriptions and parseable schemas; no duplicate or rejected registration. |
| Execution | The browser agent, from the fixed prompts, invokes tools rather than falling back to clicks/DOM actuation. Site-tool activity appears in order in conversation Sources and Recently used. | Manually invoke every tool once in the DevTools WebMCP pane, then run the fixed prompts with the inspector/compatible agent. Every call is `Completed`; logs retain exact inputs and outputs. |
| Shared state | Each result updates the visible page expected by that tool. Late/cancelled work cannot overwrite newer context. Human page review and export gating still operate in the shared page. | Identical visible state transitions and final artifact from the same starting state. |
| Error boundary | Invalid/stale IDs and non-visible evidence fail closed without corrupting state. A denied permission or cancelled call does not complete the protected action. | DevTools log shows an intelligible Error/Canceled status for the selected negative control and a healthy subsequent valid call. |
| Repeatability | Three consecutive fresh-page golden runs complete without manual tool selection, repair prompt, reload, or retry. Record each call and total duration. | Three consecutive fresh-page model runs do the same after the deterministic all-six manual pass. |

The exact product inventory is:

1. `discover_research` — read-only, untrusted output
2. `inspect_paper_evidence` — read-only, untrusted output
3. `trace_research_connections` — read-only, untrusted output
4. `build_research_path` — changes visible local workflow state, untrusted output
5. `draft_research_passport` — changes visible local workflow state, untrusted output
6. `inspect_learning_progress` — read-only, untrusted output

The all-six host run should follow that order. After the tool calls, the human reopens each selected page, acknowledges review, and exports the Passport. This last step proves the human-agent boundary even though review/export themselves are deliberately human actions.

## Reproducible evidence bundle

Create one run manifest for the frozen SHA and link the media rather than relying on prose recollection. It should contain:

```yaml
candidate:
  git_sha: <40 characters>
  deployment_url: https://...
  deployment_id: <provider identifier>
  tested_at_utc: <ISO-8601>
host:
  kind: chatgpt_desktop | chrome_native
  os: <name and version>
  app_or_browser_build: <full build>
  surface: <Work/Codex or DevTools/Inspector>
  selected_model: <exact label or manual>
  extension_version: <if applicable>
  webmcp_setting: <enabled mechanism>
session:
  site_auth_state: signed_out_guest | judge_credentials
  clean_browser_state: true
  website_access_decision: approved
inventory:
  names: [discover_research, inspect_paper_evidence, trace_research_connections, build_research_path, draft_research_passport, inspect_learning_progress]
  schema_sha256: <canonical inventory hash from the candidate>
runs:
  - prompt: <verbatim prompt>
    selected_tool: <name>
    input: <redacted structured input>
    status: completed | canceled | error
    duration_ms: <measured>
    output_sha256: <hash of preserved bounded output>
    confirmation: none | <what the host asked and decision>
    visible_state: <concise assertion and screenshot/timecode>
result: pass | fail
```

Required attachments/links:

- one continuous screen recording showing host identity, native tool inventory, exact golden prompts, native tool-call indicators/logs, visible state transitions, human review/export, and the frozen URL;
- ChatGPT screenshots of the gray/blue address-bar tool state, exact inventory/read-change labels, and Recently used/Sources;
- Chrome screenshots or capture of DevTools Available Tools and Invoked Tools with statuses, inputs, and outputs;
- a response-header capture for the tested URL and a repository link to the exact SHA;
- the three-run result table for each host, including failures rather than deleting them.

The Challenge video can be a concise edit, but the uncut acceptance recording and manifest are the engineering evidence. Redact account identifiers, credentials, private cookies, and secrets.

## Pass/fail rules

Fail the candidate when any of these occurs:

- the top-level live URL is inaccessible, requires undisclosed credentials, or differs from the recorded SHA/deployment;
- the ChatGPT Site tools arrow or Chrome native inventory does not appear after application readiness;
- the inventory differs from the exact six tools, any schema is rejected, or annotations/read-change labels materially disagree;
- the host uses ordinary UI actuation for the golden prompt instead of recording a site-tool call;
- a valid call errors, stalls, requires a repair prompt/reload/retry, returns a non-serializable result, or updates the wrong visible context;
- a stale/private/metadata-only/non-visible input crosses the evidence boundary;
- denial or cancellation is ignored;
- the final visible Passport/path disagrees with the tool trace or enables export before human page review; or
- the proof is only a Playwright run, source screenshot, demo narration, or manual UI sequence without native discovery and invocation evidence.

A host-generated website access or action confirmation is not a failure by itself. Record it, approve only the intended action, and fail only if the flow cannot resume or the permission boundary behaves incorrectly.

## Confirmed current state and remaining gap

Repository inspection confirms that [`web/lib/webmcp.ts`](../../../web/lib/webmcp.ts) uses the current top-level `document.modelContext.registerTool` producer API, registers the exact six tools with registration cleanup through `AbortController`, accepts the execution cancellation signal, and assigns read-only/untrusted annotations consistently with the inventory above. The deterministic test in [`web/tests/e2e/webmcp.spec.ts`](../../../web/tests/e2e/webmcp.spec.ts) injects its own `Document.prototype.modelContext`; it is valuable application-contract coverage but, by design, does not exercise a native host.

A direct `HEAD` request to the current production route on 2026-09-01 returned HTTPS `200`, `Origin-Agent-Cluster: ?1`, and `Permissions-Policy: tools=(self)`. Those headers satisfy the documented top-level origin-isolation and policy preconditions for this route at that moment. They do not prove native registration or agent invocation and must be recaptured against the frozen candidate.

The repository's own [`docs/HARNESS.md`](../../HARNESS.md) and [`docs/WEBMCP_CHALLENGE_SUBMISSION.md`](../../WEBMCP_CHALLENGE_SUBMISSION.md) still identify real ChatGPT and Chrome passes as manual release work. No committed run manifest, native inventory capture, or native invocation trace was found in this research branch. Accordingly, the real-host acceptance gate remains open.

## Explicit unknowns

These are not safe to invent or convert into requirements:

- the minimum ChatGPT desktop app build that judges will run;
- the complete account, plan, workspace, region, and selected-model availability matrix for Site tools;
- which of ChatGPT or Chrome an individual judge will use, or whether the judge will execute the app at all;
- the judge's permission-history, cookie state, extensions, machine performance, or model sampling behavior;
- a Challenge-mandated timeout, retry count, exact number of tools, payload-size limit, or required confirmation pattern—none is specified in the rules;
- the exact proprietary representation ChatGPT uses to convey registered WebMCP tools to its model; the WebMCP draft intentionally leaves the browser-agent bridge implementation-defined; and
- whether the current Chrome documentation/spec input-shape differences around in-page `executeTool()` affect a particular build. SeedyMCP does not call that consumer API itself, so native discovery and invocation are the decisive compatibility test.

The mitigation for these unknowns is the recorded dual-host run against one frozen candidate, not more shim assertions.

## Primary sources

- OpenAI/Devpost, [OpenAI WebMCP Challenge Official Rules](https://webmcp.devpost.com/rules)
- OpenAI/Devpost, [WebMCP Challenge resources and FAQ](https://webmcp.devpost.com/resources)
- OpenAI, [WebMCP Challenge](https://openai.com/webmcp-challenge/)
- OpenAI Help Center, [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- OpenAI Help Center, [Using the built-in browser in the ChatGPT desktop app](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app)
- W3C Web Machine Learning Community Group, [WebMCP Draft Community Group Report, 26 August 2026](https://webmachinelearning.github.io/webmcp/)
- Chrome for Developers, [WebMCP](https://developer.chrome.com/docs/ai/webmcp)
- Chrome for Developers, [WebMCP Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- Chrome for Developers, [WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- Chrome for Developers, [Debug WebMCP tools](https://developer.chrome.com/docs/devtools/application/webmcp)
- Chrome for Developers, [Evals for WebMCP](https://developer.chrome.com/docs/ai/webmcp/evals)
- Chrome Web Store (Google), [WebMCP – Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd)
