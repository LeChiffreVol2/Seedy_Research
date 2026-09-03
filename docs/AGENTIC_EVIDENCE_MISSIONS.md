# Agentic Evidence Missions

## Product decision

Seedy Research's flagship is fully agentic only inside a bounded research workflow. It is allowed to plan retrieval, call read-only tools, compare sources, identify limitations, and publish a reusable artifact. It is not allowed to browse arbitrary sources, run destructive tools, hide provenance, or continue beyond the configured budgets.

This gives judges and public users a real agent loop while keeping latency, cost, and evidence risk understandable.

## User flow

1. Select `Quick Answer` (default), `Evidence Review`, `Guided Learning`, `Deep Research`, or `Automated Research`. Evidence Review produces the structured brief described here; quick answers retain the streaming path.
2. Ask a question or start from a paper.
3. Seedy Research plans and retrieves from the indexed Thai corpus.
4. The Evidence Brief shows:
   - a conservative verdict: Supported, Mixed, Conflicting, or Insufficient;
   - a matrix linking each finding to valid `[E#]` packets;
   - Thailand → World transfer signals, local conditions, and validation work;
   - learning checkpoints that continue as grounded follow-up turns;
   - evidence/source/page coverage and bounded run stages.
5. Open any evidence packet to inspect the paper detail and exact page metadata.
6. Save through normal history/share or export the brief as Markdown.

## Safety and trust contract

- Retrieval stays under `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS`, `MAX_CONTEXT_CHUNKS`, and `MAX_CONTEXT_TOKENS`.
- Tools remain read-only MCP calls.
- Mission generation receives only bounded evidence packets.
- Proposed evidence IDs are allow-listed against retrieval results before display.
- `Conflicting` requires at least two unique sources; no evidence always resolves to `Insufficient`.
- Structured-output failure returns a conservative deterministic brief rather than fabricated citations.
- The UI exposes stages and counts, not private reasoning or raw tool payloads.
- Artifacts carry the research-evidence disclaimer and are not professional engineering advice.

## Reference adaptation

[Tau](https://twotimespi.dev/) demonstrates that agent systems become teachable when their event flow, tools, and session state are inspectable. Seedy Research adapts that principle as a small run-stage trace plus evidence-linked tutor checkpoints.

[OpenWiki](https://github.com/langchain-ai/openwiki) demonstrates the value of agent-maintained, linked Markdown knowledge artifacts. Seedy Research adapts that principle as a versioned Evidence Brief stored in chat history/share and exportable as Markdown.

Seedy Research does not import either project, add an agent framework, or build a second persistence system. The Civil Research Pack is the first proof vertical. The broader differentiation connects Thai-published evidence, global comparison, and reviewed research artifacts through the same provenance boundary.
