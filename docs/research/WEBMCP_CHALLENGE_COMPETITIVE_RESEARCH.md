# WebMCP Challenge Competitive Research — Seedy Research

**Research date:** 1 September 2026 (ICT)
**Source policy:** Challenge facts come from OpenAI and the controlling Devpost
rules/resources. The AlphaXiv comparison uses AlphaXiv's own public pages and
documentation. Product-state claims come from this repository and are labelled
separately from external facts.

> **Product-state update — 2 September 2026:** the three-paper/68-page gap
> documented in this research snapshot has been closed. Production now has
> 1,000 native-verified papers and 14,485 pages: 103 Thai-local/ThaiJO papers
> (including the fixed 100-paper BSCM TCI Group 1 cohort) plus 897
> Thai-affiliated global OA PMC papers. The historical analysis below is
> retained to show why those release gates were chosen; national completeness
> remains unproven.

## Executive verdict

Seedy Research should **not** enter as “AlphaXiv for Thailand” or as a promise to
already contain all Thai research. That framing is both easy to dismiss as a
clone and contradicted by the current measured coverage. It should enter as:

> **The Thai-to-global research path: an agent can discover, inspect, and trace
> connections, but a person keeps the exact-page, match-review, and inference
> boundaries before exporting a Research Passport and Next-Study Protocol.**

This is a credible winning wedge because it makes WebMCP essential rather than
decorative. The agent operates on the same paper, page anchors, and visible
artifact as the person; the person owns the verification boundary. The current
flow therefore maps naturally to all four equally weighted criteria, while its
page-linked Thai evidence, rights-aware reader, and explicit separation of
evidence from metadata create real differentiation.

The project is not yet submission-complete. The highest-priority gaps are:

1. publish the required public YouTube demo under three minutes;
2. replace the unresolved build-period paragraph with exact baseline and
   competition-period commit evidence;
3. complete and record real ChatGPT in-app-browser and WebMCP-enabled Chrome
   tests against the frozen production URL;
4. capture one honest before/after workflow measurement and, ideally, a small
   piece of target-user evidence; and
5. freeze the repository and deployment after submission.

Adding a large quantity of unreviewed Thai metadata or PDFs before the deadline
would not fix any of those gaps. It would add rights, reliability, and demo risk
while contributing little to WebMCP Leverage, the first tie-break criterion.

## 1. What the competition actually rewards

### Controlling dates and eligibility-sensitive requirements

The [Official Rules](https://webmcp.devpost.com/rules) control if another page
conflicts with them. They define:

| Event | Pacific time | Bangkok time |
| --- | --- | --- |
| Submission closes | 3 Sep 2026, 1:00 PM PDT | **4 Sep 2026, 03:00 ICT** |
| Judging | 4 Sep, 10:00 AM PT – 21 Sep, 5:00 PM PT | 5 Sep, 00:00 – 22 Sep, 07:00 ICT |
| Winners announced | Around 23 Sep, 2:00 PM PT | Around 24 Sep, 04:00 ICT |

The OpenAI landing page reports a noon opening time, while the Rules report
11:00 AM; this has no bearing on the deadline, on which they agree. The Rules
should be cited for eligibility and timing. Thailand does not appear in the
displayed exclusion list, but final eligibility still depends on age of majority,
OpenAI API supported-country status, and applicable law.

The most important eligibility clause for this repository is that an existing
project is eligible only if it was **meaningfully extended with WebMCP after the
submission period began on 25 August**. Judges evaluate only the new work, and
the entrant must distinguish the old product from the new WebMCP extension using
dated commits or equivalent evidence. This is not optional submission polish; it
defines what the judges are allowed to score. See the [Official Rules, Project
Requirements](https://webmcp.devpost.com/rules).

### Required submission package

The [Challenge overview](https://webmcp.devpost.com/) and
[Official Rules](https://webmcp.devpost.com/rules) require:

- a live app accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome;
- English text explaining WebMCP fit, the better user experience, what humans
  and agents can newly do together, and the implementation;
- a public GitHub/GitLab/Bitbucket repository containing the functional source,
  assets, setup instructions, and a detectable open-source licence;
- a **public YouTube video under three minutes**, with audio, that clearly shows
  the working product and how WebMCP is used; and
- testing instructions and credentials if authentication is required.

Judges need not build or test the app; the Rules allow them to judge only from
the description, images, and video. Consequently, a feature that is not legible
in the video or submission text may contribute no practical judging value even
if it exists in the repository. The Rules also require the app to remain freely
available for judging. The [Devpost resources and FAQ](https://webmcp.devpost.com/resources)
instruct entrants not to change the submission, repository, or live deployment
after the deadline and to continue separately in a fork if needed.

Third-party APIs and data must be used under their terms and licences. The video
must not contain copyrighted music or third-party marks/material without
permission. For Seedy Research this reinforces the existing rights-aware reader
and argues against showing competitor screenshots in the demo.

### Judging model

Stage One is pass/fail for theme fit, viability, and reasonable use of WebMCP.
Stage Two uses four **equally weighted** criteria:

| Criterion | Official question | Competitive implication for Seedy Research |
| --- | --- | --- |
| **WebMCP Leverage** | Is WebMCP used thoroughly and skillfully in a working, non-trivial implementation? | Show multiple tool calls sharing live browser state; prove the flow is impossible to reproduce safely by scraping cards or calling only a remote MCP endpoint. |
| **Execution** | Is this a complete, coherent, runnable experience rather than a proof of concept? | Show discovery through review and actual Markdown export, including one fail-closed state; do not tour disconnected features. |
| **Potential Impact** | Is there a credible, specific problem and real audience, and does the demonstrated solution address it? | Name Thai students/researchers as the first audience, use real corpus and page evidence, and quantify only measured coverage and workflow results. |
| **Creativity & Ambition** | Is the concept novel and differentiated? | Lead with the bilingual, evidence-bounded Research Passport and lawful access model—not “paper chat” or an AlphaXiv clone. |

The [Official Rules](https://webmcp.devpost.com/rules) say ties are broken in the
listed criterion order, which makes **WebMCP Leverage the first tie-break**.
There are ten equal overall winners rather than category tracks. The overview
currently shows roughly 4,900 registered participants; participants are not the
same as submitted entries, but the field is plainly crowded.

## 2. What AlphaXiv actually demonstrates

No first-party source reviewed here publishes enough current revenue, retention,
or verified active-user data to quantify AlphaXiv's commercial “success.” The
useful benchmark is its documented product shape, not an unsupported success
metric.

### Product pattern, from AlphaXiv's own surfaces

AlphaXiv's [homepage](https://www.alphaxiv.org/) positions the product around
questions across all research. It connects papers, researchers, and
organizations; presents community-curated discovery; surfaces people and
institutions behind a topic; and offers grounded literature-review answers with
inline paper citations. Its [About page](https://www.alphaxiv.org/about) describes
the mission more broadly as research tooling **and communication**.

Its [comment guidelines](https://www.alphaxiv.org/commentguidelines) show that
the paper is also a community object. Users discuss directly on top of paper
regions, classify posts as general clarification, research critique, resource,
or private note, and are told to write public comments themselves rather than
post generative-AI text. This creates a human knowledge and reputation loop on
top of the corpus, not merely an AI-review feature.

Its public [MCP documentation](https://www.alphaxiv.org/docs/mcp) describes 19
remote tools spanning:

- agentic paper discovery through keyword, embedding, and follow-up searches;
- structured reports or raw full paper text;
- page-filtered PDF answers designed for direct citation;
- paper-code repository inspection;
- researcher, affiliation, publication, and follow relationships; and
- personal libraries, folders, reading status, and user-uploaded papers.

The same documentation makes its intended workflows explicit: literature
review, deep research, code analysis, researcher discovery, and library
management. A current [paper page](https://www.alphaxiv.org/abs/2605.20668v1)
also demonstrates a paper rendered as a rich web object with a PDF link and
extracted content rather than just a bibliographic card.

### Strategic lesson—not a clone specification

AlphaXiv's first-party product shape suggests four compounding loops:

1. **Corpus loop:** more papers make search and grounded answers more useful.
2. **Identity loop:** papers connect to authors and organizations, enabling
   follow and discovery habits.
3. **Workflow loop:** reading, page Q&A, code, libraries, and status folders keep
   work inside the product.
4. **Community loop:** comments and resources improve a paper page for the next
   reader.

Seedy Research currently proves only a narrow part of these loops. It should not
attempt to reproduce all four during the Challenge. The competition rewards a
coherent WebMCP experience, while a national research platform requires years of
provider agreements, canonicalization, rights resolution, and user/community
development.

The first-party AlphaXiv sources reviewed do not document a Thai national-source
coverage contract, a per-asset lawful reader mode, or Seed's explicit
metadata-versus-evidence and human page-reopening gate. Absence from these pages
is not proof AlphaXiv has no related internal capability, but it is sufficient to
show that Seed can own a clearly different public narrative.

## 3. Seedy Research's current competitive position

The repository's current candidate already has a strong Challenge wedge. The
[submission package](../WEBMCP_CHALLENGE_SUBMISSION.md) documents six
browser-native tools, and the [full-text system](../THAI_RESEARCH_FULL_TEXT_SYSTEM.md)
records the bounded reader and national-coverage contract.

### Strengths that should be made visible to judges

| Existing strength | Why it matters to the Challenge | How to prove it in the demo |
| --- | --- | --- |
| Six narrow tools registered on the top-level page | Clears Stage One and shows a non-trivial contract rather than a chat wrapper. | Open the real Site tools list, then invoke discovery, evidence inspection, guarded connection tracing, Path building, and Passport drafting. |
| One shared visible state for person and agent | This is the strongest answer to “why WebMCP?” | Let the agent open the paper and exact evidence; then show the human page-review action changing export eligibility. |
| Exact-page Thai evidence plus optional bounded English rendering | Specific impact and differentiation from generic paper search. | Keep the Thai excerpt visible beside English; reopen the source page before export. |
| Global results labelled metadata-only | Demonstrates trust-aware execution and prevents a global discovery lead from becoming a false citation. | Show “global records used as evidence: 0” while still producing useful leads. |
| Candidate gap remains unvalidated | Shows that the agent expands a research question without pretending it proved novelty or transferability. | Say this boundary aloud and keep the label visible. |
| Rights-aware reader with stable page anchors | Moves the product beyond peer review or metadata search toward a lawful end-to-end research loop. | Open one of the three verified full papers, navigate/search a page, and return to the same evidence anchor. |
| Runnable production, public source, deterministic E2E | Strong Execution evidence. | Put the live URL, repository, candidate SHA, and test command in the final frame/description. |

### Honest gaps

| Gap | Current evidence | Competitive consequence |
| --- | --- | --- |
| Required video is missing | Marked `REQUIRED` in the submission package. | Submission is incomplete regardless of product quality. |
| Competition-period delta is not finalized | The submission doc still says to replace the paragraph with exact hashes/timestamps. Local history shows baseline `1179b09` on 20 Aug and the first large candidate commit `e9f8ed8` on 31 Aug, but the final entry must explicitly separate pre-existing capabilities from Challenge work. | Direct eligibility and score-scope risk. |
| Actual challenge-host verification is unresolved | The checklist still lacks deployed ChatGPT and Chrome passes. | A deterministic shim cannot prove the real judge host discovers and executes the tools. |
| No actual demo latency/tool-count measurement | The checklist explicitly forbids inventing it. | Weakens Execution and makes the video harder to pace honestly. |
| Target-user evidence is thin | The repository demonstrates technical quality but not a dated user pilot or quote. | Impact is credible in theory but less persuasive than a demonstrated researcher/student outcome. |
| National coverage is far from the stated ambition | Production documents 3,878 searchable records, 1,300 page-citable papers, 2,578 metadata-only records, 2 of 36 ThaiJO endpoint families, and only 3 rights-verified native-reader papers. | “All Thai research” would be an overclaim and an easy credibility failure. |
| Product identity is migrating | Public title is Seedy Research, while the stable domains and internal compatibility identifiers remain CivilMCP. | State the compatibility-first migration in one sentence so it reads as deliberate rather than unfinished. |
| AlphaXiv-like retention loops are incomplete | No comparable public researcher-follow graph, paper community, or mature library habit loop is claimed. | Important post-Challenge roadmap, not a reason to dilute the submission now. |

## 4. The winning submission thesis

### Positioning

Use this hierarchy consistently:

- **Product:** Seedy Research
- **Browser-agent layer:** SeedyMCP
- **Challenge promise:** a Thai-to-global Research Path with exact-page evidence,
  fail-closed connections, a Research Passport, and a Next-Study Protocol
- **Compatibility substrate / first vertical:** CivilMCP / Civil Research Pack
- **Long-term ambition:** a rights-aware research graph across Thai national and
  institutional sources, globally connected without erasing provenance

A good one-line pitch is:

> Seedy Research lets an AI agent turn overlooked Thai research into a global
> research path, while SeedyMCP keeps exact pages, connection confidence,
> evidence boundaries, and final review in the person's hands.

Avoid these claims:

- “the complete database of Thai research”;
- “the AlphaXiv of Thailand” as the primary identity;
- “AI validates novelty, scientific correctness, or transferability”;
- “3,878 full papers” or any conflation of catalog records, page-citable
  evidence, and native full text; and
- “the Challenge work built the whole product.”

### Why the Research Passport is the right hero

The Passport is more competitive than leading with generic discovery, chat, or
peer review because it has a WebMCP-shaped state transition:

```text
agent discovers
  -> agent opens exact evidence in the shared page
  -> agent drafts a bounded bilingual Passport
  -> person reopens every selected source page
  -> person acknowledges page access
  -> product unlocks export
```

The agent is useful because it can orchestrate structured research actions. The
person is necessary because the evidence must be inspected and the proposed
relationship remains unvalidated. The browser page is necessary because both
operate on the same visible state. Removing WebMCP collapses this into fragile UI
automation or a remote answer detached from the human review surface.

## 5. Priority plan before submission

### P0 — eligibility and submission blockers

1. **Freeze a candidate now.** Record the production URL, deployment IDs, public
   repository, final SHA, and exact database/reader state.
2. **Write the build-period delta.** Use `1179b09` (20 Aug) as the documented
   pre-Challenge baseline if repository history confirms it was the deployed
   baseline. Enumerate only work first added after 25 Aug: top-level WebMCP
   registration, seven schemas/handlers including the dated visibility receipt, visible shared-state updates, Passport
   review/export gate, WebMCP activity trace, actual-host testing, and
   Challenge-specific documentation. Link the dated commits. Do not count the
   pre-existing remote MCP, research UI, evidence corpus, Path, or Workspace as
   new Challenge work.
3. **Run the golden flow in the real hosts.** Record the exact model, browser
   version, URL, seven discovered tools, prompts, tool results, UI effects, and
   screenshots for ChatGPT's in-app browser and WebMCP-enabled Chrome.
4. **Record real performance.** One uninterrupted rehearsal should capture total
   elapsed time, tool-call count, any confirmation, and degraded-provider
   behavior. Use those numbers or omit numbers.
5. **Publish the YouTube video and complete every English Devpost field.** Verify
   public access in a signed-out browser. Keep it under three minutes; the rules
   say judges need not watch beyond that point.
6. **Submit before 4 Sep, 03:00 ICT and freeze.** Do not change the submitted
   repository or production deployment during judging; continue on a fork.

### P1 — raise the score without broadening scope

1. **Make one 90–120 second story self-sufficient.** Problem in 10 seconds;
   three real WebMCP calls in 55–70 seconds; human review/export in 20 seconds;
   verified full-paper anchor and impact/scale in the closing 20 seconds.
2. **Show one failure boundary.** For example, attempt export before page review
   or show an OpenAlex result remaining non-citable. One visible refusal is more
   persuasive than a slide listing many safety controls.
3. **Use a reproducible impact benchmark under the no-consent posture.** Record
   the actual host, task, tool count, duration, exact-page outcome, and review
   boundary. Do not turn internal use into a public pilot, endorsement, quote,
   or adoption result without explicit consent.
4. **Explain the compatibility-first rebrand.** “Seedy Research is the product;
   SeedyMCP is its shared human-agent layer; CivilMCP identifiers remain stable
   while the Civil Research Pack is the first proof vertical.” The production
   URL and database identifiers can remain stable through judging.
5. **Make the README judge path one screen long.** Live link, 30-second golden
   prompt, seven tool names, one architecture diagram, exact new-vs-existing
   delta, deterministic test, rights boundary, and licence should be reachable
   without searching.

### P2 — explicitly defer until after judging

- broad ThaiJO/TNRR/TCI/TDC/conference harvesting;
- additional native full-text assets without completed rights review;
- researcher and organization social graphs;
- comments, following, collaborative libraries, and public profiles;
- billing or a major dependency/framework upgrade; and
- a whole-product/domain rename that could break the frozen demo.

These are legitimate AlphaXiv-scale roadmap items, but they are not the shortest
path to a higher Challenge score.

## 6. Post-Challenge path toward the broader ambition

Winning the Challenge and building a national research platform are related but
different programs. After the candidate is frozen, the expansion sequence should
be:

1. **Coverage ledger before corpus claims:** provider denominators, endpoint and
   institution coverage, harvest windows, duplicates, tombstones, rights state,
   readable assets, and page-citable counts.
2. **Lawful full-paper loop:** grow `native_verified` assets only from explicit
   permissions; preserve source-hosted, restricted, metadata-only, and
   unavailable modes for everything else.
3. **Canonical Thai research graph:** reconcile works, provider records, assets,
   authors, institutions, versions, citations, and Thai/English identities
   without deleting provenance.
4. **Research habit loop:** saved libraries, reading status, durable annotations,
   alerts, and living reviews.
5. **Human knowledge loop:** verified researcher profiles, paper-linked
   corrections/resources, moderation, and clear separation between human and
   AI-authored contributions.
6. **Distribution loop:** university/provider partnerships and a remote MCP/API
   that makes Thai primary research available to global research agents within
   the same rights and evidence contract.

This path learns from AlphaXiv's connected corpus, identity, workflow, and
community loops while preserving Seed's distinct moat: Thai primary-source
coverage, bilingual semantics, rights decisions, and exact-page auditability.

## 7. Final go/no-go rubric

Do not submit until every **Go** item is true:

| Gate | Go condition |
| --- | --- |
| Eligibility | Entrant/team eligibility confirmed; baseline and after-25-Aug WebMCP commit delta linked and honest. |
| Live access | Production URL opens signed out or valid judge credentials are supplied. |
| Actual WebMCP | Exact seven tools discovered and the four-call visibility-to-Passport flow completed in both required real-browser paths. |
| Demo | Public YouTube, audio, English, under three minutes, no unlicensed media, actual product/tool calls visible. |
| Repository | Public, licence detected, setup/test instructions work, candidate SHA frozen. |
| Claims | Catalog, evidence, reader, and provider-coverage counts are distinct and dated; no completeness or scientific-validation claim. |
| Story | One coherent Passport flow proves WebMCP leverage, execution, specific impact, and differentiated ambition. |
| Freeze | Devpost, repository, deployment, and database candidate remain unchanged throughout judging; new work moves to a fork. |

## 8. Claim audit: international-index coverage and dated Git evidence

### The “more than 50% is missing” claim is not supported

No primary or official Thai source found in this review publishes the
record-level intersection needed to support the claim that more than 50% of
Thai papers—or of all Thai research outputs in a year—cannot be discovered in
international databases. **Do not use that percentage in the submission.**

The strongest current official comparison is NRCT's
[Thailand Science, Research and Innovation Index 2023](https://nrct.go.th/file/report-nrct/Index-report-2566.pdf),
which reports data for 2022 (B.E. 2565):

| Official 2022 series | Reported denominator | Count | Scope and snapshot |
| --- | --- | ---: | --- |
| TCI | Articles in **1,033 Thai journals** | **28,782** | Domestic-journal TCI series; 11,424 S&T and 17,358 social sciences/humanities; TCI data noted as of 6 Oct 2023. |
| Web of Science | Thailand-attributed articles in SCI-Expanded, SSCI, and AHCI | **15,427** | 13,865 S&T and 1,562 social sciences/humanities; Clarivate data as of 25 May 2023. |
| Scopus | Thailand-attributed articles | **22,796** | Scopus data as of 4 Aug 2023. |

The report's concise comparison is: “TCI มีจำนวน 28,782 บทความ ... Web of
Science จำนวน 15,427 บทความ ... Scopus จำนวน 22,796 บทความ.” It also reports a
40:60 S&T-to-social-sciences/humanities mix in TCI, compared with 90:10 in Web
of Science.

These are three **parallel source totals**, not a deduplicated union. The report
does not publish TCI–WoS–Scopus record overlap, identifier matching, or a common
denominator. For example, dividing 28,782 by `28,782 + 22,796` would produce
55.8%, but that calculation would double-count overlaps and wrongly treat the
two corpora as mutually exclusive and exhaustive. Subtracting one total from
another would be invalid for the same reason. The figures concern journal
articles, not all Thai projects, reports, theses, proceedings, datasets, or
other research outputs.

The official [TNRR homepage](https://tnrr.nriis.go.th/) currently displays
537,492 under its research-output overview and separately exposes projects,
research outputs, researchers, knowledge, and theses. That is a changing,
all-years repository dashboard—not an annual paper denominator—and TNRR does
not publish its record-level overlap with WoS or Scopus there. It therefore
cannot be divided by an annual international-index count.

A TCI-authored 2011 study in the
[KMUTT Research and Development Journal](https://digital.lib.kmutt.ac.th/journal/loadfile.php?A_ID=455)
provides a strong but **historical and much narrower** observation: for 2007 it
states that one Thailand-run journal appeared in SCI-Expanded while more than
100 other TCI-listed journals had not entered that database. This is about
journal titles, Thai science-and-technology journals, one index, and an old
snapshot—not papers, not all Thai research, and not all international indexes.
It must not be converted into a current missing-paper percentage.

Use this defensible wording instead:

> NRCT reports that in 2022 Thailand's domestic TCI corpus contained 28,782
> articles from 1,033 Thai journals, alongside 22,796 Thailand-attributed
> articles in Scopus and 15,427 in Web of Science. TCI was 60% social sciences
> and humanities, compared with 10% in Web of Science. These figures demonstrate
> materially different coverage profiles; NRCT does not publish the record-level
> overlap, so the share missing from international databases is not yet
> measurable.

For a shorter pitch:

> International indexes alone are not a national Thai research catalog. NRCT
> reports a large domestic-journal literature stream with a sharply different
> disciplinary profile, which must be reconciled with—not replaced by—global
> indexes.

### Present the after-25-August Git evidence without overclaiming

The [Official Rules](https://webmcp.devpost.com/rules) say that a pre-existing
project must be meaningfully extended with WebMCP after the Submission Period
starts and that the entrant must clearly distinguish old and new work using
dated commits or equivalent evidence. A commit timestamp is supporting evidence;
it is not permission to misstate when work occurred.

The repository currently provides a defensible evidence chain:

| Role | Commit and timestamp (ICT) | What it can safely establish |
| --- | --- | --- |
| Pre-Challenge baseline | [`1179b09`](https://github.com/LeChiffreVol2/Seedy_Research/commit/1179b09a35d98938207a3019e55bd320a0fe623c), 20 Aug 2026 03:22 | The product already had its research UI, remote MCP, corpus, and earlier research workflows before the Challenge window. |
| Challenge extension commit | [`e9f8ed8`](https://github.com/LeChiffreVol2/Seedy_Research/commit/e9f8ed8c8ec3746cf62b0309784cdac7afc5df78), 31 Aug 2026 23:30 | Repository history first records `web/lib/webmcp.ts`, the top-level page integration, focused WebMCP E2E, Passport submission package, and related visible reader/passport work after the window opened. |
| Verified application candidate | [`9523b7c`](https://github.com/LeChiffreVol2/Seedy_Research/commit/9523b7cbb6970190c5f792231769a6808dc7d209), 1 Sep 2026 00:00 | The application candidate and production deployment record used for verification. |

Link the full
[baseline-to-candidate comparison](https://github.com/LeChiffreVol2/Seedy_Research/compare/1179b09a35d98938207a3019e55bd320a0fe623c...9523b7cbb6970190c5f792231769a6808dc7d209),
then narrow the narrative to the relevant files and visible behavior. State the
evidence like this, provided it truthfully reflects the work history:

> Seedy Research was a pre-existing research product at baseline `1179b09`. The
> Challenge extension recorded after the submission window opened adds the
> browser-native WebMCP registration, seven bounded site tools, shared visible
> state, the Research Passport page-review/export gate, tool-run trace, and the
> focused browser contract. The remote MCP server, existing corpus, Research
> Path, and Research Workspace pre-date the Challenge and are not claimed as new.
> The current candidate adds the dated visibility-audit tool beside the fail-closed connection trace and
> carries human-visible metadata leads into a Path ending in a provisional
> Next-Study Protocol.

At freeze time, record the final submitted repository SHA separately from the
verified application/deployment SHA and explain any intervening documentation or
CI-only commits. Preserve both author and committer timestamps, do not rewrite
history to manufacture dates, and keep the submitted repository and deployment
unchanged throughout judging as directed by the
[Devpost FAQ](https://webmcp.devpost.com/resources).

## 9. Supplied-source audit: Thai journal indexing, scraping, and full text

### Verdict: the proposed percentages remain unsupported

None of the supplied sources defines a national Thai-journal article universe,
matches its records against both OpenAlex and Google Scholar, validates the
matches, and then separately tests lawful full-text access. They therefore do
**not** support either “50–60% of Thai-journal articles cannot be found or
scraped” or “only 30–40% are completely accessible.” Treat both numbers as
unmeasured hypotheses, not facts.

The terms in that claim are not interchangeable:

- **Indexed** means a database contains a record.
- **Discoverable** means a defined query retrieves that record.
- **Scrapeable** means automated collection is technically and contractually
  permitted; Google Scholar's lack of a public API and its usage limits do not
  prove that an article is absent from its search index.
- **Metadata-complete** means required fields such as DOI, title, authors,
  language, abstract, affiliation, and references are populated accurately.
- **Full-text accessible** means a user can lawfully retrieve the article text;
  a DOI or an indexed metadata record neither supplies nor licenses full text.

### Source-by-source claim audit

| Supplied source | What it actually measures | What it cannot establish |
| --- | --- | --- |
| Chavarro, Alperín, and Willinsky, [“On the Open Road to Universal Indexing”](https://doi.org/10.1162/qss.a.17) | Peer-reviewed global study of **47,625 active OJS journals**: 71% had at least one article in OpenAlex, and 96% of journals using Crossref DOI had an OpenAlex presence. The unit and success condition are journal-level, not article-level completeness. | It has no Thai article sample, Google Scholar comparison, scrape test, or full-text-access measure. The 29% without any OpenAlex presence must not be restated as 29% of Thai articles missing. |
| [ThaiJO journal announcement 2303](https://so03.tci-thaijo.org/index.php/JLGISRRU/announcement/view/2303) | One journal announced on 4 Dec 2025 that it would begin assigning Crossref DOIs from Vol. 9 No. 3 and described DOI as aiding traceability and discovery. | A one-journal adoption event demonstrates a plausible mechanism, not prevalence, coverage, or causality across Thai journals. |
| Schrier, [“Automated Bibliometrics with Google Scholar and OpenAlex”](https://jschrier.github.io/blog/2024/03/13/Automated-Bibliometrics-with-GoogleScholar-and-OpenAlex.html) | Personal technical tutorial: Google Scholar is not designed for programmatic access and can impose usage limits, while OpenAlex exposes an API. | It measures neither Thai search recall nor full-text access. Difficulty automating Google Scholar is not evidence that its users cannot discover a record. |
| Thesrien and Damrongsorn, [“Development Thai Journal by Google Scholar”](https://cloud-3001.lib.cmu.ac.th/knowledge/client/file/63708f1a03e707341c7bc233) | Thai journal case study using a 2016 snapshot: 685 TCI journal titles, of which 8 appeared in Web of Science and 28 in Scopus; its workflow case is the *Buffalo Bulletin*. | Those are old **journal-title** counts for two commercial indexes—not Thai article recall in OpenAlex or Google Scholar, and not an access-rate denominator. |
| [ThaiLibrary Crossref tag archive](https://www.thailibrary.in.th/tag/crossref/) and its [Thai DOI article](https://www.thailibrary.in.th/2014/03/24/thai-doi/) | Practitioner commentary documents Thailand's DOI-registration development and the importance of DOI implementation and use. A related [TCI workflow critique](https://www.thailibrary.in.th/2015/10/26/tci-comment/) describes manual data entry and an ISSN-lookup gap in 2015. | Blog/tag material has no record sample or contemporary coverage test. It supports a metadata-workflow risk, not a missing-rate estimate. |
| Borrego and Urbano, [OpenAlex review preprint](https://arxiv.org/html/2512.16434v1) | Global, secondary review of OpenAlex features and known metadata-quality limitations, including missing abstracts, affiliations, and references. | It has no Thailand sample. A missing abstract, affiliation, or reference list is metadata incompleteness—not a missing work or inaccessible full text. |
| Vaj, [“What Thailand Is Missing in AI”](https://vtiya.medium.com/what-thailand-is-missing-in-ai-8a1b9c53dad0) | Short personal essay arguing generally that Thailand has fragmented data and standardization gaps. | It supplies no bibliographic dataset, matching method, denominator, or result relevant to Thai-journal coverage. It is not quantitative evidence for this claim. |
| NIDA Library, [TCI database description](https://library.nida.ac.th/th/online_database/tci-thai-journal-citation-index-centre/) | Institutional service page describing TCI as an open-access research/citation database for articles in Thai academic journals and explaining its journal-quality groups. | It publishes no OpenAlex/Google Scholar overlap, scrapeability audit, metadata-completeness rate, or full-text percentage. A service-scope description is not a coverage census. |

The strongest quantitative evidence is therefore adjacent, not equivalent: the
global OJS study finds an association between Crossref DOI use and journal-level
OpenAlex representation, while the 2016 Thai case study shows that TCI journal
titles and two commercial indexes had very different footprints. Neither gives
the requested Thai article-level percentages or proves that DOI absence is the
cause of non-discovery.

Use this wording in judge materials:

> A 2025 global study of 47,625 active OJS journals found that 71% had at least
> one article represented in OpenAlex, rising to 96% among journals using
> Crossref DOI. Thai sources also document uneven DOI adoption and historically
> manual metadata workflows. No supplied study measures current Thai-article
> recall in OpenAlex or Google Scholar, or national full-text availability, so
> Seedy Research does not claim a 50–60% discovery gap or a 30–40% full-access
> rate. We treat those as hypotheses for a transparent national coverage audit.

To make a percentage claim later, freeze an annual TCI/ThaiJO article universe;
deduplicate it; stratify by discipline, language, journal, and year; match
OpenAlex by DOI and independently by normalized title/author/ISSN; test Google
Scholar through reproducible human queries rather than prohibited scraping;
and report record presence, query discovery, required metadata fields, lawful
full-text URL, licence, match confidence, denominator, and confidence interval
as separate outcomes.

## Primary sources

- OpenAI, [WebMCP Challenge](https://openai.com/th-TH/webmcp-challenge/)
- Devpost, [Challenge overview, requirements, prizes, and judging
  criteria](https://webmcp.devpost.com/)
- Devpost, [Official Rules](https://webmcp.devpost.com/rules)
- Devpost, [Resources and FAQ](https://webmcp.devpost.com/resources)
- AlphaXiv, [Explore / product positioning](https://www.alphaxiv.org/)
- AlphaXiv, [About](https://www.alphaxiv.org/about)
- AlphaXiv, [Comment Guidelines](https://www.alphaxiv.org/commentguidelines)
- AlphaXiv, [MCP Server Documentation](https://www.alphaxiv.org/docs/mcp)
- AlphaXiv, [Example rich paper page](https://www.alphaxiv.org/abs/2605.20668v1)
- NRCT, [Thailand Science, Research and Innovation Index 2023](https://nrct.go.th/file/report-nrct/Index-report-2566.pdf)
- NRCT, [Thai National Research Repository](https://tnrr.nriis.go.th/)
- Yochai et al., [Thai Journals Quality Evaluation against SCI-Expanded
  criteria](https://digital.lib.kmutt.ac.th/journal/loadfile.php?A_ID=455)
- Chavarro, Alperín, and Willinsky, [On the Open Road to Universal
  Indexing](https://doi.org/10.1162/qss.a.17)
- ThaiJO journal, [Crossref DOI adoption announcement](https://so03.tci-thaijo.org/index.php/JLGISRRU/announcement/view/2303)
- Thesrien and Damrongsorn, [Development Thai Journal by Google
  Scholar](https://cloud-3001.lib.cmu.ac.th/knowledge/client/file/63708f1a03e707341c7bc233)
- NIDA Library, [TCI database description](https://library.nida.ac.th/th/online_database/tci-thai-journal-citation-index-centre/)
