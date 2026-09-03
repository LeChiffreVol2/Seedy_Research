# WebMCP Product Win Strategy — Seedy Research

**Decision date:** 3 September 2026 (ICT)  
**Scope:** product, data, WebMCP, performance, and proof. Submission media is out
of scope.

**Status after implementation:** this decision record preserves the diagnosis
at the date above. Research Case entry/orchestration, relevance-first discovery,
and completion instrumentation are implemented; its pilot, retrieval-quality,
latency, and impact targets still require revision-specific verification.
Action wording below is the original plan, not an inventory of missing features.
Use [Architecture](../ARCHITECTURE.md) for current behavior and
[Verification](../HARNESS.md) for evidence scopes.

## Cold-start verdict

Seedy Research has a strong, non-trivial WebMCP implementation but is not yet a
winning product experience. Its exact-page evidence, dated identity matching,
rights-aware reader, human review boundary, and Thai-to-global path are
differentiated. The weakness is that these capabilities currently appear as a
feature collection and are most reliable under a prepared golden path.

An unscripted production query for `AI learning outcomes in Thai higher
education` took about 8.8 seconds, returned no citable Thai-published evidence,
and ranked several Ukraine-focused ThaiJO records. Those records legitimately
belong to the Thai-published corpus, but they are not relevant to a
Thailand-specific query. This reveals a ranking failure and an ambiguous UI
label, not a reason to redefine corpus membership around subject matter.

The winning product is therefore not a Thai OpenAlex clone and not a larger paper
counter. It is one inspectable action layer:

> **Seedy turns research published in Thailand—especially work global indexes
> represent incompletely—into page-verifiable evidence, global connections, and
> a reviewable next study.**

The official Stage Two criteria are equally weighted: WebMCP Leverage,
Execution, Potential Impact, and Creativity & Ambition. WebMCP Leverage is the
first tie-break. See the [OpenAI Challenge](https://openai.com/th-TH/webmcp-challenge/)
and [Official Rules](https://webmcp.devpost.com/rules).

## Product model

### Membership is not relevance

`Thai-Published Research` means work published or formally deposited through a
Thailand-based journal, conference, thesis system, national research system, or
institutional repository with a stable provider record. Thailand-context,
Thai-language, and Thai-affiliation remain separate facets.

Search must rank:

1. semantic relevance to the research question;
2. Thai-published membership;
3. lawful page-citable availability;
4. visibility opportunity; and
5. recency or popularity.

Provider membership alone must never outrank a better topical match.

### Research Case is the hero

One Research Case carries:

```text
question
  -> Thai-published discovery
  -> dated visibility triage
  -> lawful exact-page evidence
  -> bounded global connections
  -> claim-level human review
  -> candidate gap
  -> Next-Study Protocol
  -> reviewed Research Passport snapshot
```

Explore, Reader, Visibility Audit, Research Path, Workspace, Chat, and Passport
are stages or views over the same case. They are not separate promises on the
first screen.

### WebMCP is orchestration plus inspection

Keep the current atomic site tools for transparent inspection. Add one bounded
task-level operation, conceptually `start_research_case`, which starts or resumes
a case, runs discovery and visibility triage, and moves the shared browser to
the resulting evidence state. It may not silently approve evidence or identity
matches. A first useful state must require no more than three tool calls and
fifteen seconds.

## Priority plan

### P0 — required to become coherent

1. Implement Thai-published membership separately from Thailand-context,
   Thai-language, and Thai-affiliation facets.
2. Fix retrieval and ranking against natural research questions; remove
   provider-first or native-first behavior that suppresses relevance.
3. Make Research Case the default root journey; remove the prefilled `Urban road
   safety` Research Path as the first product state.
4. Persist one stable case identity across discovery, reader, visibility,
   Passport, Path, and Workspace state.
5. Replace page-open acknowledgement with attributed claim/evidence
   accept-or-reject decisions tied to stable page anchors.
6. Replace the combined native-paper headline with the non-overlapping Corpus
   Scoreboard.

### P1 — required to prove WebMCP and impact

1. Add bounded Research Case WebMCP orchestration while retaining atomic tools.
2. Build three Lighthouse Research Cases: engineering, education, and
   health/social science.
3. Run the 30-question Challenge Research Benchmark with negative controls.
4. Add internal `Suggest match/correction` and steward-review states without
   claiming that Seedy modifies OpenAlex.
5. Complete the resumable ThaiJO visibility audit toward all 2,681 records,
   preserving unavailable and unresolved states.
6. Make `under-indexed` explain the missing identifier, metadata, or scholarly
   relationship and the consequence for the current case.

### P2 — credibility and release closure

1. Produce one current Production Evidence Fingerprint. Historic 100/100 reports
   cannot be attached to a different release.
2. Reconcile page-linked section, page, passage, and native-paper metrics across
   production UI and documentation.
3. Label every source as connected, import validated, partner delivery required,
   planned, or blocked by rights/access. Count only connected records.
4. Report completed Research Cases and review completion rather than implying
   downstream citation or commercial impact.
5. Preserve visible degraded states for unavailable OpenAlex and Thai providers.

## Acceptance contract

The current candidate is winner-ready only when one production fingerprint
demonstrates:

| Gate | Required result |
| --- | --- |
| Natural-query relevance | At least 90% of 30 questions have a relevant result in the top three |
| Evidence success | At least 80% of 20 answerable questions reach page-citable Thai-published evidence |
| Negative controls | Sparse questions remain sparse; no unrelated filler |
| Visibility safety | Zero false `not_found_in_audit` classifications |
| Discovery latency | p95 at or below 5 seconds |
| First useful case | At or below 15 seconds and no more than three site-tool calls |
| Lighthouse breadth | Engineering, education, and health/social science cases replay end to end |
| Human boundary | Claim-level decision required before reviewed Passport export |
| Release provenance | Git, deployment, schema, corpus, tests, and measurements share one fingerprint |

## Do not spend the remaining product effort on

- increasing the combined `1,000 native papers` headline;
- adding another disconnected AI feature or navigation destination;
- cloning AlphaXiv community, follow, or social functionality;
- calling tracked TNRR, TCI, TDC, or repositories current coverage;
- treating every ThaiJO record as Thailand-related evidence;
- claiming a candidate gap is proven novelty;
- claiming Seedy submits corrections to OpenAlex; or
- polishing only the prepared exact-title golden path.

## Winning condition

A new user or agent can start with an unscripted research question, reach a
relevant Thai-published source, see exactly how global representation is complete
or incomplete, review a lawful source page, and leave with a bounded next-study
decision. The same case remains visible and resumable by the person, and every
important claim can be replayed from the production fingerprint.
