# alphaXiv Full-Text Rights Model — What Seedy Can Safely Emulate

**Research date:** 2 September 2026 (ICT)
**Source policy:** Primary sources only: alphaXiv, arXiv, TCI/ThaiJO, and
Creative Commons. This is a product and evidence review, not legal advice.

## Decision

alphaXiv is a useful **product-pattern benchmark**, but it is not a public legal
precedent that Seedy Research can copy. Its observable product has an in-site
reader, extracted page text, and paper-grounded AI. Its public materials do not
explain the complete rights basis for every paper it processes or serves.

Seedy should therefore use two independent gates:

1. **Corpus scope:** use the current official TCI journal evaluation and ThaiJO
   provider records to decide which Thai journal papers belong in the core
   catalog.
2. **Asset rights:** decide separately, per paper version, whether Seedy may
   fetch, store, render, extract, translate, embed, or redistribute that asset.

TCI ranking is a quality/scope signal. It is not a full-text licence.

## What alphaXiv demonstrably does

These are verifiable product facts, not conclusions about its legal theory:

- alphaXiv exposes an in-site `/pdf/{arxiv-id}` reader. Its official MCP
  documentation can return raw paper text page by page and can return only the
  pages relevant to a query for citation construction
  ([alphaXiv MCP documentation](https://www.alphaxiv.org/docs/mcp)).
- The paper surface includes extracted or generated text and figures rather
  than only a bibliographic card; for example, the official paper page exposes
  a `View Paper` action and an extended web overview
  ([alphaXiv paper page](https://www.alphaxiv.org/abs/1706.03762)).
- alphaXiv's privacy policy says its assistant may process selected paper text,
  citations, and context, and may send that request content to named AI and
  infrastructure providers
  ([alphaXiv privacy policy](https://www.alphaxiv.org/privacy)).
- The reader can obtain PDF bytes from an alphaXiv-controlled asset hostname,
  not only from an `arxiv.org` URL. One directly observable example is
  [`pdfs.assets.alphaxiv.org/1807.01860v2.pdf`](https://pdfs.assets.alphaxiv.org/1807.01860v2.pdf).
  This proves first-party delivery at that URL; it does **not** prove whether
  alphaXiv permanently stores the file, uses a CDN/proxy, or obtained separate
  permission.
- alphaXiv is exposed as an integration on arXiv paper pages. arXiv describes
  arXivLabs as approved community integrations available from abstract pages
  ([arXivLabs](https://info.arxiv.org/labs/index.html)). This makes a separate
  operational arrangement possible, but the public arXivLabs page does not
  publish a redistribution grant to alphaXiv.

## The upstream arXiv model is narrower than “free to read”

arXiv makes every article freely viewable and downloadable, but its own licence
guide says the copyright holder usually keeps copyright. A submitter chooses the
licence for each version
([arXiv licence guide](https://info.arxiv.org/help/license/index.html)).

The default arXiv licence grants a perpetual, non-exclusive distribution right
specifically to arXiv; it is not a general Creative Commons grant to third
parties
([default arXiv licence](https://arxiv.org/licenses/nonexclusive-distrib/1.0/license.html)).
arXiv's API terms therefore tell third-party services to direct users back to
arXiv for paper content and prohibit storing and serving e-prints unless the
copyright holder or the paper's licence permits it
([arXiv API terms](https://info.arxiv.org/help/api/tou.html)). Its bulk-data
documentation repeats that tools based on default-licensed full text must link
back to arXiv for downloads
([arXiv S3 full-text terms](https://info.arxiv.org/help/bulk_data_s3.html)).

This creates an unresolved public-source observation: the arXiv record for
`1807.01860v2` links to the default arXiv licence
([official arXiv record](https://arxiv.org/abs/1807.01860)), while an alphaXiv
asset URL serves that PDF. Possible explanations include separate permission,
an agreement, a rights exception relied upon by alphaXiv, proxy architecture, or
a rights/data issue. No first-party public document reviewed here establishes
which explanation is correct. Seedy must not infer permission from alphaXiv's
implementation.

## Why ThaiJO and TCI are materially different

TCI's Round 5 evaluation for 2025–2029 classifies journals by publication
regularity, ISSN and website completeness, ethics, peer review, citations,
metadata/PDF consistency, and article quality. Groups 1 and 2 are quality-
certified at different thresholds; Group 3 is not certified
([official TCI evaluation criteria](https://tci-thailand.org/backend/download/Evaluation_5/EvaluationRound5.pdf)).
Those criteria do not grant Seedy a copyright licence.

ThaiJO's official OAI service is explicitly a **metadata** harvesting service,
with 36 endpoint families and a 10-requests-per-minute starting limit
([ThaiJO OAI guide](https://www.tci-thaijo.org/public/oai.html)). It does not
state that every linked PDF has one platform-wide reuse licence.

Licences are journal- or article-specific. For example, one ThaiJO journal's
official policy uses CC BY-NC-ND 4.0 and transfers copyright to its publisher
([Journal of Applied Informatics and Technology policy](https://ph01.tci-thaijo.org/index.php/jait/copyrightlicense)).
Creative Commons itself says CC BY permits commercial sharing and adaptation
with attribution, CC BY-SA adds ShareAlike, while CC BY-NC-ND prohibits
commercial use and distribution of modified material
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)).

Therefore:

- `TCI Group 1/2` answers **which journal corpus Seedy prioritizes**;
- `ThaiJO OAI` answers **how Seedy harvests bounded metadata**;
- the paper version's licence or a direct agreement answers **what Seedy may do
  with the full text**.

## Recommended Seedy rights-safe pattern

### 1. TCI-scoped discovery corpus

- Treat papers from current **TCI Group 1 and Group 2** journals as the core
  Thai-journal discovery scope; make Group 1 the default high-assurance filter.
- Store evaluation cycle, group, effective dates, journal identifier, and the
  official evidence URL. Never carry a stale rank forward without a dated
  snapshot.
- Keep Group 3 or unevaluated material in a separately labelled discovery lane;
  do not present it as currently TCI-certified.
- Preserve both TCI and ThaiJO provider records when they describe the same
  canonical work. TCI status must not overwrite the journal's rights evidence.

### 2. Two reader lanes

| Lane | Eligible evidence | Product behaviour |
| --- | --- | --- |
| `source_hosted` | Full text is publicly reachable but Seedy lacks complete action-level permission | Keep PDF/HTML at the journal or repository; show the licence state and open the official page. Embed only when the source explicitly permits it. Do not proxy the binary or promote extracted text into native RAG. |
| `native_verified` | CC0/public domain, CC BY, rights-compatible CC BY-SA, or a direct written grant covering the required actions | Store the checksum-bound version, render exact pages, extract/index text, and enable RAG only for actions explicitly allowed. Preserve attribution, licence URL, version, and change notices. |

For a commercial-capable product, automatically prioritize **CC0/public
domain, CC BY, and reviewed CC BY-SA** papers. Treat NC, ND, unknown, and
conflicting declarations as `source_hosted` until a specific permission or
qualified review clears the exact actions. A browser-visible download button or
the phrase “open access” is evidence of availability, not by itself evidence of
commercial reuse, transformation, or redistribution permission.

### 3. Build the missing Thai equivalent of arXiv's depositor grant

The fastest durable way to enlarge the native corpus is not uncontrolled PDF
copying. It is an author/journal/institution deposit path in which the depositor:

1. identifies the exact manuscript version and rightsholder;
2. certifies authority to grant the selected rights;
3. grants Seedy a non-exclusive right to store and display that version;
4. separately opts into text extraction, embeddings/RAG, translation, excerpt
   export, and preservation; and
5. accepts attribution, update, withdrawal, and takedown procedures.

This should be recorded as a machine-readable **Rights Passport**, not only a
checkbox or journal-level note:

```text
asset_id + version + checksum + rightsholder + evidence_url/agreement_id
+ licence_uri + licence_version + observed_at + reviewed_at
+ allow_store + allow_display + allow_extract + allow_embed
+ allow_translate + allow_export + allow_commercial + allow_training
+ attribution_text + embargo + takedown_contact + decision_status
```

Unknown or contradictory values fail closed. Software licensing for Seedy does
not grant rights in deposited papers.

## What Seedy can emulate from alphaXiv

Emulate the user experience and technical separation:

- one stable paper/version object;
- an exact-page reader and citation anchors;
- page-filtered retrieval rather than unsupported whole-paper answers;
- original text beside clearly labelled generated explanation or translation;
- source/version links, attribution, and AI-processing disclosure; and
- a first-party reader only for rights-cleared assets.

Do not emulate the unexplained part: serving a paper merely because another
platform serves it. Seedy's differentiator should be that every native page has
an auditable rights decision and every non-cleared paper still has a useful,
honest source-hosted path.

## Unknowns that require direct confirmation

- Whether alphaXiv has a private arXiv, author, publisher, or institutional
  redistribution agreement.
- Whether `pdfs.assets.alphaxiv.org` is permanent storage, CDN caching, or a
  controlled proxy, and which terms govern it.
- How alphaXiv validates per-version licences and handles conflicts or
  takedowns.
- Which rights basis alphaXiv relies on for generated overviews, extracted
  figures, full-text MCP output, and non-CC papers.
- Which TCI/ThaiJO journals will grant Seedy commercial display and text-
  processing rights beyond their public licence.

Until those facts are obtained from the relevant parties, they must remain
unknown rather than being filled with legal assumptions.
