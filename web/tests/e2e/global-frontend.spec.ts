import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("civilmcp-paper-language-v1")) {
      window.localStorage.setItem("civilmcp-paper-language-v1", "th");
    }
  });
});

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}

async function expectNoInteractiveOverlap(page: Page) {
  const overlaps = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>("button, a, input, textarea, select")).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        style.visibility !== "hidden" &&
        element.getAttribute("aria-label") !== "Open Next.js Dev Tools"
      );
    });

    const collisions: string[] = [];
    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        const left = controls[leftIndex];
        const right = controls[rightIndex];
        if (left.contains(right) || right.contains(left)) continue;
        const a = left.getBoundingClientRect();
        const b = right.getBoundingClientRect();
        const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (overlapWidth * overlapHeight > 16) {
          const label = (element: HTMLElement) => element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName;
          collisions.push(`${label(left)} <> ${label(right)}`);
        }
      }
    }
    return collisions;
  });
  expect(overlaps).toEqual([]);
}

test("desktop feed keeps the approved research hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Thai civil engineering research, with sources." })).toBeVisible();
  await expect(page.getByLabel("CivilMCP corpus coverage")).toContainText("papers");
  await expect(page.getByLabel("CivilMCP corpus coverage")).toContainText("cited passages");
  await expect(page.getByLabel("CivilMCP corpus coverage")).toContainText("Exact-page citations");
  await expect(page.getByText("Thai + English · Page-linked sources")).toBeVisible();
  const runControl = page.getByRole("button", { name: /Evidence Review/ });
  await expect(runControl).toContainText("Evidence Review");
  await runControl.click();
  await expect(page.getByRole("menuitemradio", { name: /Evidence Review/ })).toContainText("Recommended");
  await expect(page.getByRole("menuitemradio", { name: /Guided Learning/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /Deep Research/ })).toContainText("Pro");
  await expect(page.getByRole("menuitemradio", { name: /Quick Answer/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "CivilMCP research feed" })).toBeVisible();
  await expect.poll(() => page.locator(".researchCard").count()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.locator(".researchCard").evaluateAll((cards) => {
        if (cards.length < 2) return false;
        return cards.slice(0, 2).every((card) => card.getBoundingClientRect().bottom <= window.innerHeight);
      }),
    )
    .toBe(true);
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("Explore separates ThaiJO discovery metadata from citable evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await page.getByRole("button", { name: /^Thai journals/ }).click();
  const feed = page.getByRole("region", { name: "CivilMCP research feed" });
  await expect(feed.getByText("Discovery metadata", { exact: true }).first()).toBeVisible();
  await expect(feed.getByText("Not used for AI answers or citations", { exact: true }).first()).toBeVisible();
  await expect(feed.getByRole("link", { name: "Open publisher record" }).first()).toHaveAttribute("href", /^https:\/\//);
  await expect(feed.getByRole("button", { name: "Ask with evidence" })).toHaveCount(0);

  const unifiedResponse = await page.request.get("/api/research-feed?filter=hot&q=soil&limit=12");
  expect(unifiedResponse.ok()).toBe(true);
  const unified = await unifiedResponse.json() as { cards?: Array<{ citable?: boolean; provider?: string; evidenceStatus?: string }> };
  expect(unified.cards?.some((card) => card.citable === true)).toBe(true);
  expect(
    unified.cards?.some(
      (card) => card.provider === "tci_thaijo" && card.evidenceStatus === "metadata_only" && card.citable === false,
    ),
  ).toBe(true);

  const ncceResponse = await page.request.get("/api/research-feed?filter=ncce&limit=3");
  expect(ncceResponse.ok()).toBe(true);
  const ncce = await ncceResponse.json() as { cards?: Array<{ title?: string; citable?: boolean }> };
  expect(ncce.cards?.length).toBeGreaterThan(0);
  expect(
    ncce.cards?.every(
      (card) =>
        card.citable === true &&
        !/^(?:keywords?|key words?|ค[ํำ]าส[ํำ]าคัญ|คำสำคัญ)(?:\s*[:：]|\s+|$)/i.test(card.title ?? ""),
    ),
  ).toBe(true);

  const knownPaperResponse = await page.request.get("/api/papers/NCCE31_CEM-06.md");
  expect(knownPaperResponse.ok()).toBe(true);
  const knownPaper = await knownPaperResponse.json() as { document?: { source?: string; title?: string } };
  expect(knownPaper.document?.source).toBe("NCCE31_CEM-06.md");
  expect(knownPaper.document?.title).toMatch(/^การศึกษาการบริหารจัดการความเสี่ยง/);
});

test("paper detail exposes library, citation export, global comparison, and related evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator(".cardTitleButton").first().click();

  await expect(page.getByRole("button", { name: "BibTeX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RIS · Zotero" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare globally" })).toHaveAttribute("href", /^https:\/\/openalex\.org\//);
  await expect(page.getByRole("heading", { name: "Library notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related Thai evidence" })).toBeVisible();
});

test("personal library saves a paper and enables notes and folders", async ({ page }) => {
  await page.route("**/api/paper-workspace**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], cards: [] }) });
      return;
    }
    if (request.method() === "POST") {
      const payload = request.postDataJSON() as { source: string; note?: string; labels?: string[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item: {
            documentId: null,
            source: payload.source,
            collection: "ncce",
            paperCode: null,
            note: payload.note ?? "",
            labels: payload.labels ?? [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Save paper to library" }).first().click();
  await expect(page.getByRole("button", { name: /^Saved 1/ })).toBeVisible();

  await page.locator(".cardTitleButton").first().click();
  await expect(page.getByLabel("Folders and labels")).toBeEnabled();
  await page.getByLabel("Folders and labels").fill("Thesis, Read next");
  await page.getByLabel("Note").fill("Compare the risk factors with the next paper.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Library note synced")).toBeVisible();
});

test("intermediate responsive widths stay collision-free", async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Thai civil engineering research, with sources." })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoInteractiveOverlap(page);
  }
});

test("320px layout has no control collision and exposes all primary filters", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Collection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session actions" })).toBeVisible();

  for (const label of ["Top", "Recent", "Evidence", "Saved"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  await page.getByRole("button", { name: "Session actions" }).click();
  const actionMenu = page.getByRole("menu", { name: "Session actions" });
  await expect(actionMenu).toBeVisible();
  await expect
    .poll(() =>
      actionMenu.evaluate((menu) => {
        const rect = menu.closest<HTMLElement>(".glassDropdown")?.getBoundingClientRect();
        return Boolean(rect && rect.left >= 8 && rect.right <= window.innerWidth - 8);
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(actionMenu).toHaveCount(0);

  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("navigation resets rail scroll and account does not render the composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".mainRail").evaluate((element) => element.scrollTo({ top: 700 }));
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => page.locator(".mainRail").evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator(".searchComposer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("#civilmcp-password")).toBeVisible();
  await expect(page.getByLabel("Account and chat history login").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await expect(page.getByText("฿199")).toHaveCount(0);

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send recovery link" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

  await page.getByLabel("Account and chat history login").getByRole("button", { name: "Sign in", exact: true }).click();
  const password = page.locator("#civilmcp-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await page.getByLabel("Account and chat history login").getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toBeVisible();
  await expect(page.getByLabel("Account and chat history login").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("advanced models lead free users to the Founder Pro decision point", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Model" }).click();
  const deepseekPro = page.getByRole("menuitemradio", { name: /DeepSeek V4 Pro/ });
  const luna = page.getByRole("menuitemradio", { name: /GPT-5.6 Luna/ });
  const terra = page.getByRole("menuitemradio", { name: /GPT-5.6 Terra/ });
  const sol = page.getByRole("menuitemradio", { name: /GPT-5.6 Sol/ });
  await expect(deepseekPro).toContainText("PRO");
  await expect(luna).toContainText("PRO");
  await expect(terra).toContainText("PRO");
  await expect(sol).toContainText("PRO");
  await deepseekPro.click();
  await expect(page.getByRole("heading", { name: "For larger research projects." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to upgrade" })).toBeVisible();
  await expect(page.getByText("Free includes DeepSeek Flash and exact-page citations.")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("Research Path turns an explicit goal into a four-stage learning sequence", async ({ page }) => {
  const pathPayload = {
    version: "civilmcp-research-path-v2",
    goal: "Urban road safety in Thailand",
    level: "applied",
    outcome: "literature_review",
    sourceCodes: ["NCCE29_TRL40", "NCCE25_TRL42"],
    generatedAt: new Date().toISOString(),
    stages: ["Map the field", "Inspect the methods", "Compare the evidence", "Build your position"].map((title, index) => ({
      id: `stage-${index + 1}`,
      title,
      objective: `Objective ${index + 1} for an applied literature review.`,
      prompt: `Study stage ${index + 1} with exact-page evidence.`,
      papers: [{
        id: `paper-${index + 1}`,
        source: `NCCE29_TRL4${index}.md`,
        paperCode: `TRL4${index}`,
        collection: "ncce",
        title: `Thai road safety paper ${index + 1}`,
        summary: "Mocked research path paper.",
        discipline: "transport",
        pageLabel: "p.1-8",
        evidenceCount: 40 + index,
      }],
    })),
    openAlex: {
      status: "connected",
      searchUrl: "https://openalex.org/works?search=road%20safety",
      works: [{ id: "W1", title: "Global road safety research", year: 2026, citedByCount: 42, topic: "Road safety", url: "https://openalex.org/W1" }],
    },
  };
  await page.route("**/api/research-path", (route) => route.fulfill({ json: pathPayload }));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Research Path" }).click();
  await expect(page.getByRole("heading", { name: "Turn a topic into a research plan" })).toBeVisible();
  await page.getByLabel("What do you want to understand?").fill("Urban road safety in Thailand");
  await page.getByRole("button", { name: "Build research path" }).click();

  const workspace = page.getByLabel("Personalized research learning path");
  await expect(workspace.getByRole("heading", { name: "Urban road safety in Thailand" })).toBeVisible();
  await expect(workspace.locator(".pathStage")).toHaveCount(4);
  await expect(workspace.getByText("Global road safety research")).toBeVisible();
  await workspace.getByRole("button", { name: "Mark complete" }).first().click();
  await expect(workspace).toContainText("1 of 4 stages complete");
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("Deep Research is visible but gated to Founder Pro", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Evidence Review/ }).click();
  const deepResearch = page.getByRole("menuitemradio", { name: /Deep Research/ });
  await expect(deepResearch).toContainText("Pro");
  await deepResearch.click();
  await expect(page.getByRole("heading", { name: "For larger research projects." })).toBeVisible();
  await expect(page.getByText(/Deep Research is included in Founder Pro/)).toBeVisible();
});

test("Research Workspace is a separate Founder Pro surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Workspace" }).click();
  const workspace = page.getByLabel("Research Workspace Pro");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Compare evidence across selected papers.")).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Run with Pro/ })).toBeVisible();
  await workspace.getByRole("button", { name: /Run with Pro/ }).click();
  await expect(page.getByRole("heading", { name: "For larger research projects." })).toBeVisible();
  await expect(page.getByText(/Research Workspace is included in Founder Pro/)).toBeVisible();
  await expect(page.getByText("Research Workspace", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("Founder Pro can batch-run, inspect, review, and export workspace cells", async ({ page }) => {
  const sessionId = "00000000-0000-4000-8000-000000000099";
  const user = { userId: "user-workspace", displayName: "Workspace Researcher", email: "researcher@example.com", isGuest: false };
  const cards = [1, 2].map((index) => ({
    id: `paper-${index}`,
    source: `NCCE29_TRL4${index}.md`,
    sourcePdf: `NCCE29_TRL4${index}.pdf`,
    collection: "ncce",
    paperCode: `NCCE29_TRL4${index}`,
    discipline: "transportation",
    title: `Thai road safety evidence ${index}`,
    date: "2026",
    sourceLabel: "NCCE29",
    summary: "Mocked civil engineering evidence for a workspace batch.",
    tags: ["Transportation"],
    filters: ["hot", "evidence", "ncce"],
    evidenceCount: 32 + index,
    pages: 9,
    pageLabel: "p.1-9",
    preview: "traffic",
    prompt: "Compare road safety evidence.",
  }));

  await page.route("**/api/session", (route) => route.fulfill({ json: { sessionId } }));
  await page.route("**/api/history", (route) => route.fulfill({ json: {
    sessionId,
    title: "Untitled chat",
    mode: "mcp",
    model: "gpt-5.6-luna",
    collection: "",
    messages: [],
    user,
    authenticated: true,
  } }));
  await page.route("**/api/chat-sessions", (route) => route.fulfill({ json: { sessions: [], user, authenticated: true } }));
  await page.route("**/api/billing", (route) => route.fulfill({ json: {
    plan: "founder_pro",
    status: "active",
    creditsIncluded: 150,
    creditsUsed: 0,
    creditsRemaining: 150,
    resetAt: "2026-08-21T00:00:00.000Z",
    premiumModels: true,
    billingConfigured: true,
    priceThb: 199,
    hasStripeCustomer: true,
  } }));
  await page.route("**/api/research-feed**", (route) => route.fulfill({ json: {
    cards,
    facets: { total: 941, totalSections: 9412, totalChunks: 49965, filters: { hot: 2 } },
    nextCursor: null,
    generatedAt: "2026-07-21T00:00:00.000Z",
  } }));
  await page.route("**/api/research-workspaces**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { workspaces: [] } });
      return;
    }
    const request = route.request().postDataJSON() as {
      action: string;
      workspaceId: string;
      runId?: string;
      model?: string;
      rows?: Array<{ source: string }>;
      columns?: Array<{ id: string }>;
      state?: unknown;
    };
    if (request.action === "save") {
      await route.fulfill({ json: { workspace: { workspaceId: request.workspaceId, state: request.state } } });
      return;
    }
    await route.fulfill({ json: {
      version: "civilmcp-research-workspace-run-v1",
      workspaceId: request.workspaceId,
      runId: request.runId,
      model: request.model,
      chargedCredits: request.rows?.length ?? 0,
      generatedAt: "2026-07-21T00:01:00.000Z",
      rows: (request.rows ?? []).map((row, paperIndex) => ({
        source: row.source,
        cells: (request.columns ?? []).map((column) => ({
          columnId: column.id,
          value: `${column.id} finding for paper ${paperIndex + 1}`,
          confidence: "high",
          status: "ready",
          evidence: [{
            id: `P${paperIndex + 1}E1`,
            source: row.source,
            pageStart: 3,
            pageEnd: 3,
            sectionTitle: "Methodology",
            snippet: "Mocked exact-page evidence supporting the generated cell.",
          }],
        })),
      })),
    } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Workspace" }).click();
  const workspace = page.getByLabel("Research Workspace Pro");
  await expect(workspace.locator("tbody tr")).toHaveCount(2);
  await workspace.getByRole("button", { name: /Run selected/ }).click();
  await expect(workspace.getByText(/Run complete · 2 credits used/)).toBeVisible();
  await workspace.getByRole("button", { name: /Method for Thai road safety evidence 1/ }).click();
  const inspector = page.getByLabel("Cell evidence inspector");
  await expect(inspector).toContainText("method finding for paper 1");
  await expect(inspector).toContainText("p.3");
  await inspector.getByRole("button", { name: /Verified/ }).click();
  await expect(inspector.getByText("Review · verified")).toBeVisible();
  const download = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "Export CSV" }).click();
  await expect((await download).suggestedFilename()).toMatch(/^civilmcp-research-workspace-\d+\.csv$/);

  await workspace.getByRole("button", { name: "Template" }).click();
  await workspace.getByRole("menuitemradio", { name: /PRISMA scoping review/ }).click();
  const prisma = workspace.getByLabel("PRISMA-guided scoping review");
  await expect(prisma).toContainText("Review protocol");
  await prisma.getByRole("group", { name: "Screen Thai road safety evidence 1" }).getByRole("button", { name: "Include" }).click();
  await prisma.getByRole("group", { name: "Screen Thai road safety evidence 2" }).getByRole("button", { name: "Exclude" }).click();
  await prisma.getByLabel("Exclusion reason for Thai road safety evidence 2").fill("Outside the review context");
  await expect(prisma.getByLabel("Screened 2")).toBeVisible();
  await expect(prisma.getByLabel("Included 1")).toBeVisible();
  await expect(prisma.getByLabel("Excluded 1")).toBeVisible();
  await workspace.getByRole("button", { name: /Run included/ }).click();
  await expect(workspace.getByText(/Run complete · 1 credits used/)).toBeVisible();
  const prismaDownload = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "Export PRISMA" }).click();
  await expect((await prismaDownload).suggestedFilename()).toMatch(/^civilmcp-prisma-scoping-review-\d+\.md$/);
  await expectNoPageOverflow(page);
});

test("model menu supports keyboard navigation and focus return", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Model" });
  await trigger.focus();
  await trigger.press("ArrowDown");

  const options = page.getByRole("menuitemradio");
  const selectedOption = page.getByRole("menuitemradio", { checked: true });
  await expect(selectedOption).toBeFocused();
  await expect(selectedOption).toContainText("DeepSeek V4 Flash");
  await selectedOption.press("End");
  await expect(options.last()).toBeFocused();
  await options.last().press("Escape");
  await expect(page.getByRole("menu", { name: "Model" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Evidence Mission renders a linked brief and exports Markdown", async ({ page }) => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const guestUser = { userId: "guest-test", displayName: "Guest researcher", isGuest: true };
  await page.route("**/api/session", (route) => route.fulfill({ json: { sessionId } }));
  await page.route("**/api/history", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { ok: true, sessionId }
          : { sessionId, title: "Untitled chat", mode: "mcp", model: "deepseek-v4-flash", collection: "", messages: [], user: guestUser, authenticated: false },
    }),
  );
  await page.route("**/api/chat-sessions", (route) =>
    route.fulfill({ json: { sessions: [], user: guestUser, authenticated: false } }),
  );
  await page.route("**/api/billing", (route) =>
    route.fulfill({
      json: {
        plan: "guest",
        status: "active",
        creditsIncluded: null,
        creditsUsed: null,
        creditsRemaining: null,
        resetAt: null,
        premiumModels: false,
        billingConfigured: false,
        priceThb: 199,
        hasStripeCustomer: false,
      },
    }),
  );
  await page.route("**/api/research-feed**", (route) =>
    route.fulfill({ json: { cards: [], facets: { total: 941, totalSections: 8148, totalChunks: 48370, filters: {} }, nextCursor: null } }),
  );
  const evidenceItem = {
    evidenceId: "E1",
    citation: "NCCE29_TRL40.md p.3",
    source: "NCCE29_TRL40.md",
    collection: "ncce",
    paperCode: "TRL40",
    pageStart: 3,
    pageEnd: 3,
    sectionTitle: "Results",
    snippet: "Representative exact-page evidence for the mission contract.",
  };
  const artifact = {
    version: "civilmcp-evidence-brief-v1",
    question: "Compare safety factors",
    experience: "mission",
    title: "Road safety evidence mission",
    executiveSummary: "The indexed evidence supports a bounded comparison [E1].",
    verdict: { status: "mixed", rationale: "Coverage is useful but local [E1]." },
    matrix: [{
      finding: "Serious outcomes require contextual comparison.",
      interpretation: "Treat this as a research signal.",
      methodOrContext: "NCCE transport study",
      limitation: "One mocked source in this UI contract.",
      evidenceIds: ["E1"],
    }],
    worldBridge: {
      transferableSignals: ["Compare mechanisms, not headline rates."],
      thaiContext: ["Preserve local road and reporting context."],
      validateNext: ["Retest with the destination country's data."],
    },
    learning: {
      objective: "Separate evidence, interpretation, and transfer assumptions.",
      checkpoints: [
        { question: "What does E1 directly support?", hint: "Read the cited result.", evidenceIds: ["E1"] },
        { question: "What must be validated elsewhere?", hint: "Check local context.", evidenceIds: ["E1"] },
      ],
    },
    trust: { evidenceCount: 1, sourceCount: 1, exactPageCount: 1, pageCoveragePercent: 100 },
    agentRun: {
      bounded: true,
      toolCalls: 2,
      toolCallLimit: 4,
      stepLimit: 3,
      stages: [
        { name: "Plan", detail: "compare · deterministic router", status: "complete" },
        { name: "Search", detail: "2/4 tool calls · 1 evidence packet", status: "complete" },
        { name: "Compare", detail: "1 unique source", status: "limited" },
        { name: "Verify", detail: "1/1 packets have exact pages", status: "complete" },
        { name: "Publish", detail: "Saved as a linked Evidence Brief", status: "complete" },
      ],
    },
  };
  await page.route("**/api/chat", async (route) => {
    const body = [
      `8:${JSON.stringify([{ type: "civilmcp_context", traceId: "trace-test", evidenceItems: [evidenceItem] }])}`,
      `8:${JSON.stringify([{ type: "civilmcp_mission", traceId: "trace-test", artifact }])}`,
      `0:${JSON.stringify("## Evidence Review\nThe brief is grounded in [E1].")}`,
      `d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 10, completionTokens: 20 } })}`,
      "",
    ].join("\n");
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "x-vercel-ai-data-stream": "v1" },
      body,
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const composer = page.getByLabel("Ask or search civil engineering papers");
  await composer.fill("Compare safety factors");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();

  const mission = page.getByLabel("Evidence Review");
  await expect(mission).toContainText("Road safety evidence mission");
  await expect(mission).toContainText("100% exact-page coverage");
  await expect(mission).toContainText("Thailand → World bridge");
  await expect(mission.getByRole("button", { name: /What does E1 directly support/ })).toBeVisible();
  await mission.getByText("Inspect agent run").click();
  await expect(mission).toContainText("Saved as a linked Evidence Brief");

  const downloadPromise = page.waitForEvent("download");
  await mission.getByRole("button", { name: "Export Evidence Brief" }).click();
  await expect((await downloadPromise).suggestedFilename()).toMatch(/civilmcp-evidence-brief-.*\.md/);
});

test("paper language mode translates globally, persists, and follows the paper drawer", async ({ page }) => {
  let translationRequests = 0;
  const card = {
    id: "paper-language-test",
    source: "NCCE29_TRL40.md",
    collection: "ncce",
    paperCode: "TRL40",
    discipline: "transport",
    title: "หลักฐานความปลอดภัยทางถนนในประเทศไทย",
    date: "30 May 2026",
    sourceLabel: "NCCE",
    summary: "หลักฐานจากงานวิจัยที่เชื่อมโยงกับหน้าต้นฉบับ",
    tags: ["Transport", "NCCE"],
    filters: ["hot", "evidence", "ncce"],
    evidenceCount: 12,
    pages: 8,
    pageLabel: "p.1-8",
    preview: "traffic",
    prompt: "Summarize this paper with exact-page evidence.",
    indexedAt: new Date().toISOString(),
  };
  await page.addInitScript(() => window.localStorage.setItem("civilmcp-paper-language-v1", "en"));
  await page.route("**/api/session", (route) => route.fulfill({ json: { sessionId: "00000000-0000-4000-8000-000000000002" } }));
  await page.route("**/api/history**", (route) => route.fulfill({
    json: {
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Untitled chat",
      mode: "mcp",
      model: "deepseek-v4-flash",
      collection: "",
      messages: [],
      user: { userId: "guest-test", displayName: "Guest researcher", isGuest: true },
      authenticated: false,
    },
  }));
  await page.route("**/api/chat-sessions**", (route) => route.fulfill({ json: { sessions: [], authenticated: false } }));
  await page.route("**/api/billing**", (route) => route.fulfill({ json: { plan: "guest", status: "active", premiumModels: false, billingConfigured: false, priceThb: 199 } }));
  await page.route("**/api/research-feed**", (route) =>
    route.fulfill({
      json: {
        cards: [card],
        facets: { total: 941, totalSections: 8148, totalChunks: 48370, filters: { hot: 941, recent: 64, evidence: 939, ncce: 874, ce_project: 67 } },
        nextCursor: null,
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route(/\/api\/papers\//, (route) =>
    route.fulfill({
      json: {
        document: card,
        sections: [{ id: "section-1", sectionIndex: 0, title: "Introduction", pageStart: 1, pageEnd: 2, snippet: "Thai road safety context." }],
        evidence: [{ id: "evidence-1", sectionIndex: 0, chunkIndex: 0, sectionTitle: "Introduction", pageStart: 1, pageEnd: 1, snippet: "Exact-page road safety evidence." }],
        counts: { sections: 1, chunks: 1 },
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/paper-translation", async (route) => {
    translationRequests += 1;
    const body = route.request().postDataJSON() as { segments: Array<{ id: string; text: string }> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceLanguage: "th",
        targetLanguage: "en",
        translations: body.segments.map((segment) => ({ id: segment.id, text: `[EN] English translation for ${segment.id}` })),
        translatedAt: new Date().toISOString(),
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const languageControl = page.getByRole("group", { name: "Paper language" });
  const englishButton = languageControl.getByRole("button", { name: "Translate papers to English" });
  const thaiButton = languageControl.getByRole("button", { name: "Show Thai original" });
  await expect(languageControl).toBeVisible();
  await expect(englishButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => translationRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator(".researchCard [lang='en']").filter({ hasText: "[EN]" }).count()).toBeGreaterThan(0);

  await thaiButton.click();
  await expect(thaiButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".researchCard [lang='en']").filter({ hasText: "[EN]" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("civilmcp-paper-language-v1"))).toBe("th");

  await englishButton.click();
  await expect(englishButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".researchCard [lang='en']").filter({ hasText: "[EN]" }).count()).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Translate papers to English" })).toHaveAttribute("aria-pressed", "true");

  const evidenceButton = page.locator(".researchCard").getByRole("button", { name: /^Evidence \d+$/ }).first();
  await expect(evidenceButton).toBeVisible({ timeout: 15_000 });
  await evidenceButton.click();
  const dialog = page.getByRole("dialog", { name: "Paper detail" });
  await expect(dialog.getByRole("group", { name: "Paper language" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Translate papers to English" })).toHaveAttribute("aria-pressed", "true");
  await expectNoPageOverflow(page);
});

test("paper drawer traps focus and returns it to the opener", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const opener = page.locator(".researchCard").first().getByRole("button", { name: /Evidence/ });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Paper detail" });
  const closeButton = dialog.getByRole("button", { name: "Close paper detail" });
  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("reduced motion uses the stable CSS glass fallback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".liquidEffect").first()).toHaveCSS("display", "none");
  await expectNoPageOverflow(page);
});
