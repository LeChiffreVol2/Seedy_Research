import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const researchCard = {
  id: "webmcp-road-safety",
  source: "NCCE29_TRL42.md",
  sourcePdf: "https://example.org/NCCE29_TRL42.pdf",
  collection: "ncce",
  paperCode: "NCCE29_TRL42",
  pageStart: 2067,
  pageEnd: 2074,
  discipline: "Transportation Engineering",
  title: "Factors associated with severe road crashes in Thailand",
  date: "2024",
  sourceLabel: "NCCE",
  summary: "A Thai road-safety study with page-linked evidence.",
  tags: ["road safety", "Thailand"],
  filters: ["hot", "evidence", "ncce"],
  evidenceCount: 4,
  pages: 8,
  pageLabel: "pp.2067–2074",
  preview: "traffic",
  prompt: "Explain the road-safety findings with exact-page evidence.",
  provider: "civilmcp",
  evidenceStatus: "indexed",
  citable: true,
  canonicalUrl: "https://example.org/NCCE29_TRL42",
  doi: "10.1000/thai-road",
  authors: ["Demo Researcher"],
  discoveryLayer: "evidence",
};

const goldenPassportCard = {
  id: "reader-pack:thaijo:learn:291631",
  source: "thaijo:learn:291631",
  collection: "",
  sourceType: "journal_article",
  paperCode: "10.70730/JFOW3489",
  pageStart: 1,
  pageEnd: 17,
  discipline: "education",
  language: "en",
  publishedAt: "2026-07-31",
  title: "A Critical Analysis of Research on the Use of Artificial Intelligence in English Language Teaching in Thailand: Conflicting Results and Methodological Limitations",
  date: "31 Jul 2026",
  sourceLabel: "ThaiJO · LEARN Journal · Native reader",
  summary: "Rights-verified CC-BY-4.0 full paper with 17 page-addressable pages.",
  tags: ["Native reader", "CC BY 4.0", "ThaiJO"],
  filters: ["hot", "recent", "evidence", "thai", "tci"],
  evidenceCount: 17,
  pages: 17,
  pageLabel: "17 verified pages",
  preview: "beam",
  prompt: "",
  provider: "tci_thaijo",
  evidenceStatus: "extracted",
  citable: true,
  canonicalUrl: "https://so04.tci-thaijo.org/index.php/LEARN/article/view/291631",
  journalTitle: "LEARN Journal: Language Education and Acquisition Research Network",
  authors: ["Supong Tangkiengsirisin", "Le Van Canh", "Sethawut Techasan"],
  doi: "10.70730/JFOW3489",
  rightsStatus: "open_license_verified",
  accessLevel: "full_text_licensed",
  licenseExpression: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  discoveryLayer: "evidence",
};

const readerFullPageText = "FULL VERIFIED PAGE TEXT MUST STAY OUT OF THE WEBMCP TOOL RESULT";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type RegisteredTool = {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
    };
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(window, "__seedResearchWebMcpTools", { value: tools, configurable: true });
    Object.defineProperty(Document.prototype, "modelContext", {
      configurable: true,
      get() {
        return {
          registerTool: async (tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
            tools.set(tool.name, tool);
            options?.signal?.addEventListener("abort", () => {
              if (tools.get(tool.name) === tool) tools.delete(tool.name);
            }, { once: true });
          },
        };
      },
    });
  });

  await page.route("**/api/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessionId: "webmcp-session" }) });
  });
  await page.route("**/api/history**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "webmcp-session",
        title: "WebMCP test",
        mode: "mcp",
        model: "gpt-5.6-luna",
        collection: "",
        messages: [],
        user: { userId: "guest-webmcp", displayName: "Guest researcher", isGuest: true },
        authenticated: false,
      }),
    });
  });
  await page.route("**/api/chat-sessions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [], user: { userId: "guest-webmcp", displayName: "Guest researcher", isGuest: true }, authenticated: false }),
    });
  });
  await page.route("**/api/billing", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: "guest",
        status: "preview",
        creditsIncluded: null,
        creditsUsed: null,
        creditsRemaining: null,
        resetAt: null,
        premiumModels: true,
        openAccess: true,
        billingConfigured: false,
        priceThb: 299,
        hasStripeCustomer: false,
      }),
    });
  });
  await page.route("**/api/events", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/research-feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: [researchCard],
        facets: {
          total: 1,
          catalogTotal: 3677,
          citableTotal: 1297,
          metadataOnlyTotal: 2380,
          totalSections: 11523,
          totalChunks: 68614,
          filters: { hot: 1, evidence: 1, ncce: 1 },
        },
        nextCursor: null,
        generatedAt: "2026-08-31T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/global-discovery", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-08-31T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=road%20safety",
        works: [{
          id: "https://openalex.org/W123",
          doi: null,
          title: "Global evidence on road-system safety",
          year: 2025,
          citedByCount: 18,
          topic: "Road safety",
          url: "https://openalex.org/W123",
          citable: false,
        }],
      }),
    });
  });
  await page.route("**/api/citation-map", async (route) => {
    const body = route.request().postDataJSON() as { doi?: string | null; title?: string; year?: number | null };
    expect(body).toMatchObject({ title: researchCard.title, year: 2024 });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-09-01T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=road%20safety",
        match: {
          status: "verified",
          basis: "doi",
          requiresHumanReview: false,
          titleSimilarity: 1,
          yearDelta: 0,
          matchedOpenAlexId: "https://openalex.org/W123",
        },
        seed: {
          id: "https://openalex.org/W123",
          title: researchCard.title,
          year: 2024,
          citedByCount: 18,
          url: "https://openalex.org/W123",
          relation: "seed",
          topic: "Road safety",
          authors: ["Global Researcher"],
          institutions: ["Global Road Safety Lab"],
          citable: false,
        },
        nodes: [{
          id: "https://openalex.org/W456",
          title: "Global evidence on road-system safety",
          year: 2025,
          citedByCount: 9,
          url: "https://openalex.org/W456",
          relation: "cited_by",
          topic: "Road safety",
          authors: ["Second Researcher"],
          institutions: ["Global Road Safety Lab"],
          citable: false,
        }],
      }),
    });
  });
  await page.route("**/api/papers/**", async (route) => {
    const isDiscoveryOnly = route.request().url().includes("THAIJO-demo");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: isDiscoveryOnly ? {
          ...researchCard,
          id: "metadata-only",
          source: "THAIJO-demo",
          citable: false,
          evidenceStatus: "metadata_only",
          discoveryLayer: "thai_discovery",
        } : researchCard,
        sections: [{ id: "section-1", sectionIndex: 0, title: "Results", pageStart: 2067, pageEnd: 2068, snippet: "Results section." }],
        evidence: [{
          id: "evidence-road-1",
          sectionIndex: 0,
          chunkIndex: 0,
          sectionTitle: "Results",
          pageStart: 2067,
          pageEnd: 2067,
          readerPageNumber: 2067,
          readerAnchor: "asset:webmcp-native:page:2067",
          snippet: "The study groups crash factors into human, vehicle, and road-environment categories.",
        }],
        counts: { sections: 1, chunks: 1 },
        related: [],
        generatedAt: "2026-08-31T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/papers/**/reader**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "civilmcp.reader.v1",
        source: researchCard.source,
        access: {
          mode: "native_verified",
          statusLabel: "Native full text verified",
          sourceUrl: researchCard.canonicalUrl,
        },
        pages: [{
          id: "webmcp-reader-page-2067",
          pageNumber: 2067,
          anchor: "asset:webmcp-native:page:2067",
          text: readerFullPageText,
        }],
      }),
    });
  });
  await page.route("**/api/paper-translation", async (route) => {
    const body = route.request().postDataJSON() as { segments?: Array<{ id: string; text: string }> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceLanguage: "th",
        targetLanguage: "en",
        translations: (body.segments ?? []).map((segment) => ({ id: segment.id, text: segment.text })),
        translatedAt: "2026-08-31T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/research-path", async (route) => {
    const body = route.request().postDataJSON() as {
      goal?: string;
      level?: string;
      outcome?: string;
      knowledgeGaps?: string[];
      globalLeads?: Array<{ id?: string; title?: string; relation?: string; citable?: boolean }>;
    };
    if (body.globalLeads?.length) {
      expect(body.globalLeads).toEqual([expect.objectContaining({
        id: "https://openalex.org/W456",
        title: "Global evidence on road-system safety",
        relation: "cited_by",
        citable: false,
      })]);
    }
    const stages = ["Map the Thai field", "Inspect full-paper evidence", "Connect Thai and global leads", "Frame the gap and next study"].map((title, index) => ({
      id: `stage-${index + 1}`,
      title,
      objective: `Use Thai exact-page evidence to complete ${title.toLowerCase()}.`,
      checkpointQuestion: `What did you learn in ${title.toLowerCase()}?`,
      concepts: ["evidence", "scope"],
      prompt: `Study ${title.toLowerCase()}.`,
      papers: [{
        id: researchCard.id,
        source: researchCard.source,
        paperCode: researchCard.paperCode,
        collection: researchCard.collection,
        title: researchCard.title,
        summary: researchCard.summary,
        discipline: researchCard.discipline,
        pageLabel: researchCard.pageLabel,
        evidenceCount: researchCard.evidenceCount,
      }],
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "civilmcp-research-path-v2",
        goal: body.goal,
        level: body.level ?? "foundation",
        outcome: body.outcome ?? "study_plan",
        sourceCodes: [researchCard.paperCode],
        adaptedFromGaps: body.knowledgeGaps ?? [],
        coverage: { status: "strong", paperCount: 1, message: "One relevant Thai paper." },
        planningMode: "model",
        model: "gpt-5.6-luna",
        candidateGap: {
          status: "candidate_unvalidated",
          statement: "Whether the Thai road-safety finding transfers across urban contexts remains unvalidated.",
          basis: "Bounded Thai evidence plus one metadata-only OpenAlex comparison lead.",
          missingValidation: ["Review the selected global paper full text.", "Test the relation in another Thai context."],
          noveltyEstablished: false,
        },
        nextStudyProtocol: {
          status: "draft_framework",
          researchQuestion: "Does the Thai road-system factor pattern recur in a second urban context?",
          contextOrPopulation: "A bounded second Thai urban road network.",
          dataNeeded: ["Crash records", "Road-environment observations"],
          method: "Pre-register a matched observational comparison.",
          validationPlan: "Compare held-out locations and inspect the selected global lead's full text.",
          falsificationCondition: "The proposed factor pattern does not recur under the same operational definitions.",
          evidenceBoundary: "Thai page-linked packets support local claims; OpenAlex records remain metadata-only leads.",
        },
        generatedAt: "2026-08-31T00:00:00.000Z",
        stages,
        openAlex: { status: "connected", searchUrl: "https://openalex.org", works: [] },
      }),
    });
  });
});

test("registers non-trivial WebMCP tools and keeps agent actions visible to the human", async ({ page }) => {
  const response = await page.goto("/?view=explore");
  expect(response?.headers()["permissions-policy"]).toContain("tools=(self)");
  expect(response?.headers()["origin-agent-cluster"]).toBe("?1");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });

  const definitions = await page.evaluate(() => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, {
      name: string;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      inputSchema: Record<string, unknown>;
    }> }).__seedResearchWebMcpTools;
    return [...tools.values()].map((tool) => ({ name: tool.name, annotations: tool.annotations, inputSchema: tool.inputSchema }));
  });
  expect(definitions.map((tool) => tool.name).sort()).toEqual([
    "build_research_path",
    "discover_research",
    "draft_research_passport",
    "inspect_learning_progress",
    "inspect_paper_evidence",
    "trace_research_connections",
  ]);
  expect(definitions.every((tool) => tool.annotations?.untrustedContentHint === true)).toBe(true);
  expect(definitions.find((tool) => tool.name === "build_research_path")?.annotations?.readOnlyHint).toBe(false);
  expect(definitions.find((tool) => tool.name === "draft_research_passport")?.annotations?.readOnlyHint).toBe(false);
  expect(definitions.find((tool) => tool.name === "discover_research")?.annotations?.readOnlyHint).toBe(true);
  expect(definitions.find((tool) => tool.name === "trace_research_connections")?.annotations?.readOnlyHint).toBe(true);

  const discovery = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("discover_research")?.execute({ query: "urban road safety", scope: "thai_and_global" });
  }) as { thaiEvidence?: Array<{ source?: string }>; globalMetadata?: unknown[] };
  expect(discovery.thaiEvidence?.[0]?.source).toBe(researchCard.source);
  expect(discovery.globalMetadata).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "Thai research, with sources." })).toBeVisible();
  await expect(page.getByText(researchCard.title).first()).toBeVisible();

  const discoveryOnlyError = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("inspect_paper_evidence")?.execute({ source: "THAIJO-demo" });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(discoveryOnlyError).toContain("discovery-only");

  const connectionWithoutEvidenceError = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("trace_research_connections")?.execute({ source: "NCCE29_TRL42.md" });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(connectionWithoutEvidenceError).toContain("Open this paper and its evidence");

  const evidence = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 });
  }) as {
    evidence?: Array<{ page?: string; excerpt?: string }>;
    readerAccess?: {
      mode?: string;
      pageReadableInSeedResearch?: boolean;
      pageAnchor?: string | null;
      readerUrl?: string | null;
    };
  };
  expect(evidence.evidence?.[0]?.page).toBe("p.2067");
  expect(evidence.readerAccess).toMatchObject({
    mode: "native_verified",
    pageReadableInSeedResearch: true,
    pageAnchor: "asset-webmcp-native-page-2067",
    readerUrl: "/papers/NCCE29_TRL42.md#asset-webmcp-native-page-2067",
  });
  expect(JSON.stringify(evidence)).not.toContain(readerFullPageText);
  await expect(page.getByRole("dialog", { name: "Paper detail" })).toBeVisible();
  await expect(page.getByText("The study groups crash factors into human, vehicle, and road-environment categories.")).toBeVisible();
  await expect(page.getByTestId("paper-reader-action")).toHaveText(/Read verified full paper/);
  await expect(page.getByTestId("paper-reader-action")).toHaveAttribute(
    "href",
    "/papers/NCCE29_TRL42.md#asset-webmcp-native-page-2067",
  );

  const connections = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("trace_research_connections")?.execute({ source: "NCCE29_TRL42.md" });
  }) as {
    match?: { status?: string; basis?: string; requiresHumanReview?: boolean };
    relations?: Array<{ relation?: string; citable?: boolean }>;
    evidenceBoundary?: string;
  };
  expect(connections.match).toMatchObject({ status: "verified", basis: "doi", requiresHumanReview: false });
  expect(connections.relations).toEqual([expect.objectContaining({ relation: "cited_by", citable: false })]);
  expect(connections.evidenceBoundary).toContain("metadata-only");
  await expect(page.getByText("Verified DOI OpenAlex match", { exact: true })).toBeVisible();
  await expect(page.getByText("Global evidence on road-system safety", { exact: true })).toBeVisible();

  const privatePassportError = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("draft_research_passport")?.execute({
        source: "private:account-paper",
        focus: "How road-system factors transfer across urban contexts",
        evidenceIds: ["evidence-road-1"],
        gapLens: "context",
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(privatePassportError).toContain("Private paper sources cannot be included");

  const invalidPassportEvidence = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("draft_research_passport")?.execute({
        source: "NCCE29_TRL42.md",
        focus: "How road-system factors transfer across urban contexts",
        evidenceIds: ["not-visible"],
        gapLens: "context",
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalidPassportEvidence).toContain("visible in the active paper");

  const passport = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("draft_research_passport")?.execute({
      source: "NCCE29_TRL42.md",
      focus: "How road-system factors transfer across urban contexts",
      evidenceIds: ["evidence-road-1"],
      gapLens: "context",
    });
  }) as { passportId?: string; translationStatus?: string; pageLinkedThaiEvidence?: unknown[]; globalLeads?: Array<{ citable?: boolean }>; candidateGap?: { reviewRequired?: boolean; status?: string; evidenceRelationValidated?: boolean } };
  expect(passport.passportId).toMatch(/^SR-/);
  expect(passport.translationStatus).toBe("not_needed");
  expect(passport.pageLinkedThaiEvidence).toHaveLength(1);
  expect(passport.globalLeads?.[0]?.citable).toBe(false);
  expect(passport.candidateGap).toMatchObject({ reviewRequired: true, status: "unsupported_candidate", evidenceRelationValidated: false });

  const passportPanel = page.getByLabel("Thai-to-global research passport");
  await expect(passportPanel.getByRole("heading", { name: "Thai → Global Research Passport" })).toBeVisible();
  await expect(passportPanel.getByText("Page-linked Thai evidence")).toBeVisible();
  await expect(passportPanel.getByText("OpenAlex · metadata only")).toBeVisible();
  await expect(passportPanel.getByText("Novelty and transferability have not been established.", { exact: false })).toBeVisible();
  await expect(passportPanel.getByText("evidence relationship not validated", { exact: false })).toBeVisible();
  await expect(passportPanel.getByText("global records used as evidence: 0", { exact: false })).toBeVisible();
  const exportPassport = passportPanel.getByRole("button", { name: "Export passport" });
  await expect(exportPassport).toBeDisabled();
  const pageReview = passportPanel.getByRole("button", { name: "Open every exact page first" });
  await expect(pageReview).toBeDisabled();
  const evidenceButton = passportPanel.getByRole("button", { name: "Open evidence evidence-road-1 at p.2067" });
  await evidenceButton.focus();
  expect(await evidenceButton.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await evidenceButton.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");
  await evidenceButton.click();
  await expect(page.getByRole("dialog", { name: "Paper detail" })).toBeVisible();
  await expect(page.getByLabel("Cited evidence packet")).toContainText("p.2067");
  await page.getByRole("button", { name: "Close paper detail" }).click();
  const markPagesReviewed = passportPanel.getByRole("button", { name: "Mark pages reviewed" });
  await expect(markPagesReviewed).toBeEnabled();
  await markPagesReviewed.click();
  await expect(passportPanel.getByText("Human-reviewed page anchors")).toBeVisible();
  await expect(exportPassport).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportPassport.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^seed-research-passport-sr-.*\.md$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const passportMarkdown = await readFile(downloadPath as string, "utf8");
  expect(passportMarkdown).toContain("## Page-reviewed Thai evidence");
  expect(passportMarkdown).toContain("p.2067");
  expect(passportMarkdown).toContain("## Global discovery leads — metadata only");
  expect(passportMarkdown).toContain("## Candidate inference — human review required");
  expect(passportMarkdown).toContain("evidence relationship not validated");
  expect(passportMarkdown).toContain("OpenAlex records are discovery metadata only and were not used as evidence");
  await passportPanel.getByText("Inspect WebMCP run").click();
  await expect(passportPanel.getByText("discover_research", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("inspect_paper_evidence", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("draft_research_passport", { exact: true })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await passportPanel.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.setViewportSize({ width: 360, height: 780 });
  const mobilePanel = await passportPanel.boundingBox();
  expect(mobilePanel).not.toBeNull();
  expect(mobilePanel?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((mobilePanel?.x ?? 0) + (mobilePanel?.width ?? 999)).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await exportPassport.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1280, height: 720 });

  const arbitraryLeadError = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("build_research_path")?.execute({
        goal: "Understand how Thai cities can reduce severe road crashes",
        level: "foundation",
        outcome: "study_plan",
        collection: "ncce",
        globalLeadIds: ["https://openalex.org/W999999"],
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(arbitraryLeadError).toContain("Trace and review the active paper connections");

  const path = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("build_research_path")?.execute({
      goal: "Understand how Thai cities can reduce severe road crashes",
      level: "foundation",
      outcome: "study_plan",
      collection: "ncce",
      globalLeadIds: ["https://openalex.org/W456"],
    });
  }) as {
    stages?: unknown[];
    globalConnections?: { leads?: Array<{ id?: string; citable?: boolean }> };
    candidateGap?: { status?: string; noveltyEstablished?: boolean };
    nextStudyProtocol?: { status?: string; researchQuestion?: string };
  };
  expect(path.stages).toHaveLength(4);
  expect(path.globalConnections?.leads).toEqual([
    expect.objectContaining({ id: "https://openalex.org/W456", citable: false }),
  ]);
  expect(path.candidateGap).toMatchObject({ status: "candidate_unvalidated", noveltyEstablished: false });
  expect(path.nextStudyProtocol).toMatchObject({ status: "draft_framework" });
  await expect(page.getByRole("heading", { name: "Understand how Thai cities can reduce severe road crashes" })).toBeVisible();
  await expect(page.getByLabel("0% of research path mastered")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate gap · not proven novel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next-Study Protocol" })).toBeVisible();
  await expect(page.getByText("Does the Thai road-system factor pattern recur in a second urban context?", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Global comparison leads" })).toBeVisible();
  await expect(page.getByText("Global evidence on road-system safety", { exact: true })).toBeVisible();

  const progress = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("inspect_learning_progress")?.execute({});
  }) as { state?: string; masteredStages?: number; privacy?: string };
  expect(progress).toMatchObject({ state: "in_progress", masteredStages: 0, privacy: "Learner free-text answers are intentionally omitted." });

  await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("discover_research")?.execute({ query: "updated road safety question", scope: "thai_and_global" });
  });
  await expect(passportPanel.getByText("Out of date · redraft required", { exact: true })).toBeVisible();
  await expect(exportPassport).toBeDisabled();
  await passportPanel.getByText("Inspect WebMCP run").click();
  await expect(passportPanel.getByText("4 completed calls", { exact: true })).toBeVisible();
});

test("completes the production-seed Passport trust gate in exactly three site-tool calls", async ({ page }) => {
  await page.unroute("**/api/research-feed**");
  await page.route("**/api/research-feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cards: [goldenPassportCard],
        facets: {
          total: 1300,
          catalogTotal: 3878,
          citableTotal: 1300,
          metadataOnlyTotal: 2578,
          totalSections: 11591,
          totalChunks: 68682,
          filters: { hot: 1300, evidence: 1300, thai: 2581, tci: 2581 },
        },
        nextCursor: null,
        generatedAt: "2026-09-01T00:00:00.000Z",
      }),
    });
  });
  await page.unroute("**/api/global-discovery");
  await page.route("**/api/global-discovery", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-09-01T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=longitudinal%20mixed-methods%20Thai%20ELT",
        works: [{
          id: "https://openalex.org/W2997300544",
          doi: null,
          title: "Preparing teachers for the application of AI-powered technologies in foreign language education",
          year: 2020,
          citedByCount: 54,
          topic: "AI in language education",
          url: "https://openalex.org/W2997300544",
          citable: false,
        }],
      }),
    });
  });
  await page.unroute("**/api/papers/**/reader**");
  await page.unroute("**/api/papers/**");

  const response = await page.goto("/?view=explore");
  expect(response?.headers()["permissions-policy"]).toContain("tools=(self)");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });

  const discovered = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("discover_research")?.execute({
      query: "AI in English language teaching in Thailand methodological limitations",
      collection: "all",
      scope: "thai",
    });
  }) as { thaiEvidence?: Array<{ source?: string; nativeReaderVerified?: boolean }> };
  expect(discovered.thaiEvidence?.[0]).toMatchObject({ source: goldenPassportCard.source, nativeReaderVerified: true });

  const inspected = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("inspect_paper_evidence")?.execute({
      source: "thaijo:learn:291631",
      evidenceId: "thaijo-learn-291631-page-2",
      page: 2,
    });
  }) as { evidence?: Array<{ id?: string; page?: string }>; readerAccess?: { mode?: string; pageReadableInSeedResearch?: boolean } };
  expect(inspected.evidence?.[0]).toMatchObject({ id: "thaijo-learn-291631-page-2", page: "p.2" });
  expect(inspected.readerAccess).toMatchObject({ mode: "native_verified", pageReadableInSeedResearch: true });

  const drafted = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("draft_research_passport")?.execute({
      source: "thaijo:learn:291631",
      focus: "How should a longitudinal mixed-methods Thai ELT study test AI learning outcomes beyond novelty effects?",
      evidenceIds: ["thaijo-learn-291631-page-2"],
      gapLens: "validation",
    });
  }) as { translationStatus?: string; globalLeads?: Array<{ citable?: boolean }>; candidateGap?: { status?: string; evidenceRelationValidated?: boolean } };
  expect(drafted.translationStatus).toBe("not_needed");
  expect(drafted.globalLeads).toEqual([expect.objectContaining({ citable: false })]);
  expect(drafted.candidateGap).toMatchObject({ status: "unsupported_candidate", evidenceRelationValidated: false });

  const passportPanel = page.getByLabel("Thai-to-global research passport");
  const exportPassport = passportPanel.getByRole("button", { name: "Export passport" });
  await expect(exportPassport).toBeDisabled();
  await passportPanel.getByRole("button", { name: "Open evidence thaijo-learn-291631-page-2 at p.2" }).click();
  await expect(page.getByRole("dialog", { name: "Paper detail" })).toBeVisible();
  await expect(page.getByTestId("paper-reader-action")).toHaveText(/Read verified full paper/);
  await page.getByRole("button", { name: "Close paper detail" }).click();
  await passportPanel.getByRole("button", { name: "Mark pages reviewed" }).click();
  await expect(exportPassport).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportPassport.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^seed-research-passport-sr-.*\.md$/);

  await passportPanel.getByText("Inspect WebMCP run").click();
  await expect(passportPanel.getByText("3 completed calls", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("discover_research", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("inspect_paper_evidence", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("draft_research_passport", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("trace_research_connections", { exact: true })).toHaveCount(0);
  await expect(passportPanel.getByText("build_research_path", { exact: true })).toHaveCount(0);
});

test("fails closed on a candidate OpenAlex match until a human confirms it", async ({ page }) => {
  await page.route("**/api/citation-map", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-09-01T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=road%20safety",
        match: {
          status: "candidate",
          basis: "title",
          requiresHumanReview: true,
          titleSimilarity: 0.82,
          yearDelta: 3,
          matchedOpenAlexId: "https://openalex.org/W-CANDIDATE",
        },
        seed: {
          id: "https://openalex.org/W-CANDIDATE",
          title: "Possible road safety match",
          year: 2021,
          citedByCount: 2,
          url: "https://openalex.org/W-CANDIDATE",
          relation: "seed",
          citable: false,
        },
        // Even a malformed provider response cannot make candidate relations
        // visible or return them to the browser agent before confirmation.
        nodes: [{
          id: "https://openalex.org/W-MUST-STAY-HIDDEN",
          title: "Relationship from an unconfirmed candidate",
          year: 2022,
          citedByCount: 1,
          url: "https://openalex.org/W-MUST-STAY-HIDDEN",
          relation: "related",
          citable: false,
        }],
      }),
    });
  });
  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });
  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    await tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 });
    return tools.get("trace_research_connections")?.execute({ source: "NCCE29_TRL42.md" });
  }) as { match?: { status?: string; requiresHumanReview?: boolean }; relations?: unknown[] };

  expect(result.match).toMatchObject({ status: "candidate", requiresHumanReview: true });
  expect(result.relations).toEqual([]);
  await expect(page.getByText("A candidate OpenAlex match needs human confirmation", { exact: false })).toBeVisible();
  await expect(page.getByText("Relationship from an unconfirmed candidate", { exact: true })).toHaveCount(0);
});

test("keeps source-hosted full text outside the bounded WebMCP evidence result", async ({ page }) => {
  const officialUrl = "https://publisher.example.org/papers/road-safety";
  const nonNativePageText = "SOURCE-HOSTED PAGE TEXT MUST NEVER ENTER THE WEBMCP RESULT";
  await page.route("**/api/papers/**/reader**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "civilmcp.reader.v1",
        source: researchCard.source,
        access: {
          mode: "source_hosted",
          statusLabel: "Full text remains at the publisher",
          sourceUrl: officialUrl,
        },
        // A malformed upstream payload still cannot turn a non-native mode into
        // page text returned to the browser agent.
        pages: [{ pageNumber: 2067, anchor: "asset:source-hosted:page:2067", text: nonNativePageText }],
      }),
    });
  });

  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });
  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return {
      names: [...tools.keys()].sort(),
      evidence: await tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 }),
    };
  }) as {
    names: string[];
    evidence?: {
      readerAccess?: {
        mode?: string;
        pageReadableInSeedResearch?: boolean;
        pageAnchor?: string | null;
        readerUrl?: string | null;
        sourceUrl?: string | null;
      };
    };
  };

  expect(result.names).toEqual([
    "build_research_path",
    "discover_research",
    "draft_research_passport",
    "inspect_learning_progress",
    "inspect_paper_evidence",
    "trace_research_connections",
  ]);
  expect(result.evidence?.readerAccess).toMatchObject({
    mode: "source_hosted",
    pageReadableInSeedResearch: false,
    pageAnchor: null,
    readerUrl: officialUrl,
    sourceUrl: officialUrl,
  });
  expect(JSON.stringify(result.evidence)).not.toContain(nonNativePageText);
  await expect(page.getByRole("dialog", { name: "Paper detail" })).toBeVisible();
  await expect(page.getByTestId("paper-reader-action")).toHaveText(/Open official full text/);
  await expect(page.getByTestId("paper-reader-action")).toHaveAttribute("href", officialUrl);
});

test("labels an unavailable global layer without implying a zero-result search", async ({ page }) => {
  await page.route("**/api/global-discovery", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "provider unavailable" }) });
  });
  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });

  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    await tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 });
    return tools.get("draft_research_passport")?.execute({
      source: "NCCE29_TRL42.md",
      focus: "How road-system factors transfer across urban contexts",
      evidenceIds: ["evidence-road-1"],
      gapLens: "context",
    });
  }) as { globalStatus?: string; globalLeads?: unknown[] };

  expect(result).toMatchObject({ globalStatus: "unavailable", globalLeads: [] });
  const passportPanel = page.getByLabel("Thai-to-global research passport");
  await expect(passportPanel.getByText("Global layer not checked · provider unavailable", { exact: true })).toBeVisible();
  await expect(passportPanel.getByText("No global records are shown because this layer was not completed.", { exact: false })).toBeVisible();
  await expect(passportPanel.getByText("No matching OpenAlex records found", { exact: true })).toHaveCount(0);
  await expect(passportPanel.getByText("Provenance checks passed", { exact: true })).toBeVisible();
});

test("cancels a Passport draft when the visible research question changes", async ({ page }) => {
  let releaseGlobalDiscovery = () => {};
  let markGlobalDiscoveryStarted = () => {};
  const globalDiscoveryReleased = new Promise<void>((resolve) => { releaseGlobalDiscovery = resolve; });
  const globalDiscoveryStarted = new Promise<void>((resolve) => { markGlobalDiscoveryStarted = resolve; });
  await page.route("**/api/global-discovery", async (route) => {
    markGlobalDiscoveryStarted();
    await globalDiscoveryReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-08-31T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=road%20safety",
        works: [],
      }),
    });
  });
  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    return tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 });
  });

  const draftPromise = page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    try {
      await tools.get("draft_research_passport")?.execute({
        source: "NCCE29_TRL42.md",
        focus: "How road-system factors transfer across urban contexts",
        evidenceIds: ["evidence-road-1"],
        gapLens: "context",
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  await globalDiscoveryStarted;
  await page.getByLabel("Ask or search Thai research papers").fill("a different current research question");
  await expect(page.getByLabel("Thai-to-global research passport").getByText("Research context changed while the Passport was being drafted.", { exact: false })).toBeVisible({ timeout: 3_000 });
  releaseGlobalDiscovery();
  expect(await draftPromise).toContain("research context changed");
});

test("keeps the Thai source excerpt and adds a bounded English rendering", async ({ page }) => {
  const thaiSnippet = "การศึกษาจัดกลุ่มปัจจัยการเกิดอุบัติเหตุเป็นด้านคน ยานพาหนะ และถนนกับสิ่งแวดล้อม";
  const englishSnippet = "The study groups crash factors into human, vehicle, and road-environment categories.";
  await page.route("**/api/papers/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: researchCard,
        sections: [{ id: "section-1", sectionIndex: 0, title: "ผลการศึกษา", pageStart: 2067, pageEnd: 2067, snippet: thaiSnippet }],
        evidence: [{
          id: "thai-evidence-1",
          sectionIndex: 0,
          chunkIndex: 0,
          sectionTitle: "ผลการศึกษา",
          pageStart: 2067,
          pageEnd: 2067,
          snippet: thaiSnippet,
        }],
        counts: { sections: 1, chunks: 1 },
        related: [],
      }),
    });
  });
  await page.route("**/api/paper-translation", async (route) => {
    const body = route.request().postDataJSON() as { segments?: Array<{ id: string }> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceLanguage: "th",
        targetLanguage: "en",
        translations: (body.segments ?? []).map((segment) => ({ id: segment.id, text: englishSnippet })),
        translatedAt: "2026-08-31T00:00:00.000Z",
      }),
    });
  });
  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });
  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    await tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md", page: 2067 });
    return tools.get("draft_research_passport")?.execute({
      source: "NCCE29_TRL42.md",
      focus: "How road-system factors transfer across urban contexts",
      evidenceIds: ["thai-evidence-1"],
      gapLens: "context",
    });
  }) as { translationStatus?: string; pageLinkedThaiEvidence?: Array<{ excerptOriginal?: string; excerptEnglish?: string }> };

  expect(result.translationStatus).toBe("ready");
  expect(result.pageLinkedThaiEvidence?.[0]).toMatchObject({ excerptOriginal: thaiSnippet, excerptEnglish: englishSnippet });
  const passportPanel = page.getByLabel("Thai-to-global research passport");
  await expect(passportPanel.getByText(thaiSnippet, { exact: true })).toBeVisible();
  await expect(passportPanel.getByText(englishSnippet, { exact: false })).toBeVisible();
  await expect(passportPanel.getByText("Original + bounded English rendering", { exact: false })).toBeVisible();
});

test("rejects a Passport anchor that cannot resolve to an original page", async ({ page }) => {
  await page.route("**/api/papers/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: researchCard,
        sections: [{ id: "section-1", sectionIndex: 0, title: "Results", snippet: "Results section." }],
        evidence: [{
          id: "evidence-without-page",
          sectionIndex: 0,
          chunkIndex: 0,
          sectionTitle: "Results",
          pageStart: null,
          pageEnd: null,
          snippet: "This packet deliberately lacks an original-page mapping.",
        }],
        counts: { sections: 1, chunks: 1 },
        related: [],
      }),
    });
  });
  await page.goto("/?view=explore");
  await expect(page.getByLabel("WebMCP site tools ready")).toBeVisible({ timeout: 15_000 });
  const error = await page.evaluate(async () => {
    const tools = (window as unknown as { __seedResearchWebMcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__seedResearchWebMcpTools;
    await tools.get("inspect_paper_evidence")?.execute({ source: "NCCE29_TRL42.md" });
    try {
      await tools.get("draft_research_passport")?.execute({
        source: "NCCE29_TRL42.md",
        focus: "How road-system factors transfer across urban contexts",
        evidenceIds: ["evidence-without-page"],
        gapLens: "context",
      });
      return "";
    } catch (caught) {
      return caught instanceof Error ? caught.message : String(caught);
    }
  });
  expect(error).toContain("must resolve to original source pages");
});
