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
      const centerX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const centerY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(centerX, centerY);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        style.visibility !== "hidden" &&
        Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element))) &&
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
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  await expect(page.getByRole("heading", { name: "Start a Thai-to-global Research Case." })).toBeVisible();
  const scoreboard = page.getByLabel("Non-overlapping Seedy Research corpus scoreboard");
  await expect(scoreboard).toContainText("Thai-published discovery records");
  await expect(scoreboard).toContainText("Thai-published native full papers");
  await expect(scoreboard).toContainText("Thai-published page-citable papers");
  await expect(scoreboard).toContainText("Thai-affiliated global comparisons");
  await expect(scoreboard).toContainText("visibility-audited works");
  await expect(page.getByText("Published in Thailand · Context, language, and affiliation remain separate facets")).toBeVisible();
  await expect(page.getByLabel("Thai-to-global research passport")).toHaveCount(0);
  const runControl = page.getByRole("button", { name: /Quick Answer/ });
  await expect(runControl).toContainText("Quick Answer");
  await runControl.click();
  await expect(page.getByRole("menuitemradio", { name: /Quick Answer/ })).toContainText("Recommended");
  await expect(page.getByRole("menuitemradio", { name: /Evidence Review/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /Guided Learning/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /Deep Research/ })).toContainText("OpenAI");
  await expect(page.getByRole("menuitemradio", { name: /Quick Answer/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  const coverageLedger = page.getByRole("region", { name: "Thai research coverage ledger" });
  await expect(coverageLedger).toBeVisible({ timeout: 45_000 });
  await expect(coverageLedger.getByText("2,681", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Seedy Research feed", exact: true })).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.locator(".researchCard").count()).toBeGreaterThan(0);
  await expect(page.locator(".researchCard .paperMeta span", { hasText: /^Indexed\b/i })).toHaveCount(0);
  await page.locator(".researchCard").first().scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator(".researchCard").evaluateAll((cards) => {
        if (cards.length < 2) return false;
        const first = cards[0].getBoundingClientRect();
        const second = cards[1].getBoundingClientRect();
        return first.top < second.top && first.bottom <= second.top;
      }),
    )
    .toBe(true);
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("Explore separates ThaiJO discovery metadata from citable evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();

  const invalidProvider = await page.request.get("/api/research-feed?filter=thai&provider=%2Funsafe&limit=3");
  expect(invalidProvider.status()).toBe(422);

  await page.getByRole("button", { name: /^Thai discovery/ }).click();
  const feed = page.getByRole("region", { name: "Seedy Research feed" });
  // Rights-reviewed papers intentionally lead the Thai source tab. The visible
  // ledger keeps the remaining provider records outside the citation boundary.
  await expect.poll(() => feed.getByText("#Native reader", { exact: true }).count(), { timeout: 45_000 }).toBeGreaterThan(0);
  await expect.poll(() => feed.getByRole("button", { name: "Read paper" }).count()).toBeGreaterThan(0);
  const coverageLedger = page.getByRole("region", { name: "Thai research coverage ledger" });
  await expect(coverageLedger.getByText("103 native full papers", { exact: true })).toBeVisible();
  await expect(coverageLedger.getByText("897 native full papers", { exact: true })).toBeVisible();
  await expect(coverageLedger.getByText("PMC · Thai-affiliated global OA", { exact: true })).toBeVisible();
  await expect(coverageLedger.getByText("2,578 metadata-only", { exact: true })).toBeVisible();

  type ThaiCard = { citable?: boolean; evidenceStatus?: string; canonicalUrl?: string };
  let metadataOnlyCard: ThaiCard | undefined;
  let cursor: string | null = null;
  for (let batch = 0; batch < 4 && !metadataOnlyCard; batch += 1) {
    const thaiResponse = await page.request.get(
      `/api/research-feed?filter=thai&provider=tci_thaijo&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(thaiResponse.ok()).toBe(true);
    const thai = await thaiResponse.json() as { cards?: ThaiCard[]; nextCursor?: string | null };
    metadataOnlyCard = thai.cards?.find((card) => card.evidenceStatus === "metadata_only");
    cursor = thai.nextCursor ?? null;
  }
  expect(metadataOnlyCard).toMatchObject({ citable: false, evidenceStatus: "metadata_only" });
  expect(metadataOnlyCard?.canonicalUrl).toMatch(/^https:\/\//);

  const unifiedResponse = await page.request.get("/api/research-feed?filter=hot&q=soil&limit=12");
  expect(unifiedResponse.ok()).toBe(true);
  const unified = await unifiedResponse.json() as { cards?: Array<{ citable?: boolean; provider?: string; evidenceStatus?: string }> };
  expect(unified.cards?.some((card) => card.citable === true)).toBe(true);
  expect(
    unified.cards?.some(
      (card) => card.provider === "tci_thaijo" && card.evidenceStatus === "metadata_only" && card.citable === false,
    ),
  ).toBe(true);

  const constrainedGoal = "How should a longitudinal mixed-methods Thai ELT study test AI learning outcomes beyond novelty effects?";
  const constrainedResponse = await page.request.get(
    `/api/research-feed?filter=evidence&collection=all&limit=8&q=${encodeURIComponent(constrainedGoal)}`,
  );
  expect(constrainedResponse.ok()).toBe(true);
  const constrained = await constrainedResponse.json() as { cards?: Array<{ source?: string; title?: string }> };
  expect(constrained.cards?.map((card) => card.source)).toEqual(["thaijo:learn:291631"]);

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

  const studentResponse = await page.request.get("/api/research-feed?filter=ce_project&limit=3");
  expect(studentResponse.ok()).toBe(true);
  const student = await studentResponse.json() as { cards?: Array<{ collection?: string; citable?: boolean }> };
  expect(student.cards?.length).toBeGreaterThan(0);
  expect(student.cards?.every((card) => card.collection === "ce_project" && card.citable === true)).toBe(true);
});

test("Coverage Ledger separates access classes and filters the connected provider", async ({ page }) => {
  const feedRequests: string[] = [];
  await page.route("**/api/research-feed**", async (route) => {
    feedRequests.push(route.request().url());
    await route.fulfill({ json: {
      cards: [],
      facets: {
        total: 3978,
        totalSections: 11591,
        totalChunks: 11591,
        catalogTotal: 2681,
        citableTotal: 1403,
        metadataOnlyTotal: 2578,
        filters: { hot: 1300, thai: 2681, tci: 2681, ncce: 940 },
        providers: [{ provider: "tci_thaijo", records: 2681, citable: 103, metadataOnly: 2578 }],
        coverage: [{
          provider: "tci_thaijo",
          label: "ThaiJO",
          state: "connected",
          records: 2681,
          metadataOnly: 2578,
          pageCitable: 103,
          nativeFullPaper: 103,
          sourceHostedFullPaper: 0,
          endpointObserved: 4,
          endpointKnown: null,
          rights: "article_specific",
          freshness: "2026-09-01",
          filter: "tci_thaijo",
        }],
      },
      nextCursor: null,
      generatedAt: "2026-09-01T00:00:00.000Z",
    } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  const ledger = page.getByLabel("Thai research coverage ledger");
  await expect(ledger).toContainText("Coverage Ledger");
  await expect(ledger).toContainText("2,578 metadata-only");
  await expect(ledger).toContainText("103 native full papers");
  await expect(ledger).toContainText("4 bounded source slices");
  await ledger.getByRole("button", { name: "View ThaiJO records" }).click();
  await expect.poll(() => feedRequests.some((url) => url.includes("provider=tci_thaijo"))).toBe(true);
});

test("global discovery is explicit, metadata-only, and recoverable", async ({ page }) => {
  let requestCount = 0;
  let receivedQuery = "";
  await page.route("**/api/global-discovery", async (route) => {
    requestCount += 1;
    receivedQuery = String((route.request().postDataJSON() as { query?: unknown }).query ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "connected",
        provider: "openalex",
        generatedAt: "2026-08-13T00:00:00.000Z",
        searchUrl: "https://openalex.org/works?search=flood%20resilience",
        works: [
          {
            id: "https://openalex.org/W123",
            doi: "https://doi.org/10.1000/flood",
            title: "Flood resilience across infrastructure systems",
            year: 2025,
            citedByCount: 18,
            topic: "Climate adaptation",
            url: "https://openalex.org/W123",
            citable: false,
          },
          {
            id: "https://openalex.org/W456",
            doi: null,
            title: "Evidence synthesis for resilient cities",
            year: 2024,
            citedByCount: 7,
            topic: "Urban resilience",
            url: "https://openalex.org/W456",
            citable: false,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  await page.getByLabel("Start a Thai-to-global Research Case").fill("flood resilience");
  const expand = page.getByRole("button", { name: "Expand globally" });
  await expect(expand).toBeVisible();
  expect(requestCount).toBe(0);

  await expand.click();
  await expect.poll(() => requestCount).toBe(1);
  expect(receivedQuery).toBe("flood resilience");

  const panel = page.getByRole("region", { name: "Suggested global comparison leads" });
  await expect(panel.getByText("OpenAlex metadata", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open global metadata: Flood resilience across infrastructure systems" })).toHaveAttribute(
    "href",
    "https://openalex.org/W123",
  );
  await expect(panel.getByText("OpenAlex · metadata only", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: /ask|save|evidence/i })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);

  await page.getByLabel("Start a Thai-to-global Research Case").fill("seismic retrofit");
  await expect(page.getByRole("button", { name: "Expand globally" })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Open global metadata:/ })).toHaveCount(0);
  expect(requestCount).toBe(1);
});

test("developer setup and OAuth consent stay clear on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/developers");
  await expect(page.getByRole("heading", { name: "Thai research evidence for people and agents." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Share the page, or work remotely." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SeedyMCP · shared browser" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the SeedyMCP research surface" })).toHaveAttribute("href", "/?view=explore");
  await expect(page.getByText("https://civil-mcp-server.vercel.app/v2/mcp").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "One endpoint, two secure paths." })).toBeVisible();
  await expect(page.getByText("Evidence and metadata never blur together.")).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);

  await page.goto("/oauth/consent");
  await expect(page.getByText("This authorization request is invalid or has expired.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to API setup" })).toHaveAttribute("href", "/developers");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("paper detail exposes library, citation export, global comparison, and related evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  await page.locator(".cardTitleButton").first().click();

  await expect(page.getByRole("button", { name: "BibTeX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RIS · Zotero" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare globally" })).toHaveAttribute("href", /^https:\/\/openalex\.org\//);
  const readerAction = page.getByTestId("paper-reader-action");
  await expect(readerAction).toBeVisible();
  await expect(readerAction).toHaveAttribute("href", /^(?:\/papers\/|https?:\/\/)/);
  await expect(page.getByRole("heading", { name: "Library notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related Thai evidence" })).toBeVisible();

  const knownPaperResponse = await page.request.get("/api/papers/NCCE31_CEM-06.md");
  expect(knownPaperResponse.ok()).toBe(true);
  const knownPaper = await knownPaperResponse.json() as {
    evidence?: Array<{ id?: string; sectionIndex?: number | null; chunkIndex?: number | null; pageStart?: number | null }>;
  };
  const targetEvidence = knownPaper.evidence?.at(-1);
  expect(targetEvidence?.id).toBeTruthy();
  const targetParams = new URLSearchParams({ evidence: targetEvidence?.id ?? "" });
  if (targetEvidence?.sectionIndex != null) targetParams.set("section", String(targetEvidence.sectionIndex));
  if (targetEvidence?.chunkIndex != null) targetParams.set("chunk", String(targetEvidence.chunkIndex));
  if (targetEvidence?.pageStart != null) targetParams.set("page", String(targetEvidence.pageStart));
  const targetedResponse = await page.request.get(`/api/papers/NCCE31_CEM-06.md?${targetParams.toString()}`);
  expect(targetedResponse.ok()).toBe(true);
  const targetedPaper = await targetedResponse.json() as { evidence?: Array<{ id?: string }> };
  expect(targetedPaper.evidence?.[0]?.id).toBe(targetEvidence?.id);
});

test("public paper record is indexable without exposing raw full text", async ({ page }) => {
  const response = await page.goto("/papers/NCCE31_CEM-06.md");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("การศึกษาการบริหารจัดการความเสี่ยง");
  await expect(page.getByRole("heading", { name: "Evidence outline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect exact-page evidence" })).toHaveAttribute("href", /\?paper=NCCE31_CEM-06\.md/);
  await expect(page.getByText("Source text stays inside the controlled evidence workflow.")).toBeVisible();
  await expectNoPageOverflow(page);
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
  await page.getByRole("button", { name: "Explore" }).click();
  const selectedCard = page.locator(".researchCard").filter({
    has: page.getByRole("button", { name: "Save paper to library" }),
  }).first();
  const selectedTitle = await selectedCard.getByRole("heading", { level: 2 }).innerText();
  await selectedCard.getByRole("button", { name: "Save paper to library" }).click();
  await expect(page.getByRole("button", { name: /^Saved 1/ })).toBeVisible();

  await page.locator(".researchCard").filter({
    has: page.getByRole("heading", { name: selectedTitle, exact: true }),
  }).getByRole("button", { name: selectedTitle, exact: true }).click();
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
    await page.getByRole("button", { name: "Explore" }).click();
    await expect(page.getByRole("heading", { name: "Start a Thai-to-global Research Case." })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoInteractiveOverlap(page);
  }
});

test("320px layout has no control collision and exposes all primary filters", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
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

test("navigation resets rail scroll and account explains open access without rendering the composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".mobileBottomNav button.locked")).toHaveCount(0);
  await expect(page.locator("svg.lucide-lock-keyhole")).toHaveCount(0);
  await page.locator(".mainRail").evaluate((element) => element.scrollTo({ top: 700 }));
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => page.locator(".mainRail").evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.locator(".searchComposer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("#civilmcp-password")).toBeVisible();
  await expect(page.getByLabel("Account and chat history login").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("SEEDY Open Access")).toBeVisible();
  await expect(page.getByText("Every research workflow is included after sign in.")).toBeVisible();
  await expect(page.getByText(/No answer credits, model paywalls, or Pro-only research modes/)).toBeVisible();
  await expect(page.getByLabel("Research tools included with your account").locator(":scope > span")).toHaveCount(7);
  await expect(page.locator("svg.lucide-lock-keyhole")).toHaveCount(0);

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

test("OpenAI-first model menu exposes every model without a plan boundary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Model" }).click();
  const deepseekPro = page.getByRole("menuitemradio", { name: /DeepSeek V4 Pro/ });
  const luna = page.getByRole("menuitemradio", { name: /GPT-5.6 Luna/ });
  const terra = page.getByRole("menuitemradio", { name: /GPT-5.6 Terra/ });
  const sol = page.getByRole("menuitemradio", { name: /GPT-5.6 Sol/ });
  await expect(luna).toContainText("OPENAI");
  await expect(luna).toContainText("Default");
  await expect(terra).toContainText("OPENAI");
  await expect(sol).toContainText("OPENAI");
  await expect(deepseekPro).toContainText("OPTIONAL");
  await terra.click();
  await expect(page.getByRole("button", { name: /^Model/ })).toContainText("GPT-5.6 Terra");
  await expect(page.getByLabel("SEEDY Open Access")).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("Research Path turns an explicit goal into a four-stage learning sequence", async ({ page }) => {
  const pathPayload = {
    version: "civilmcp-research-path-v2",
    goal: "Urban road safety in Thailand",
    level: "applied",
    outcome: "literature_review",
    sourceCodes: ["NCCE29_TRL40", "NCCE25_TRL42"],
    coverage: { status: "strong", paperCount: 4, message: "Enough matching papers." },
    planningMode: "model",
    model: "gpt-5.6-luna",
    candidateGap: {
      status: "candidate_unvalidated",
      statement: "Whether the observed Thai road-safety pattern transfers remains unvalidated.",
      basis: "Bounded Thai evidence only; global records remain discovery metadata.",
      missingValidation: ["Review relevant global full text.", "Validate in another context."],
      noveltyEstablished: false,
    },
    nextStudyProtocol: {
      status: "draft_framework",
      researchQuestion: "Does the observed factor pattern recur in a second Thai urban context?",
      contextOrPopulation: "A bounded second Thai urban road network.",
      dataNeeded: ["Crash records", "Road-environment observations"],
      method: "Run a pre-registered observational comparison.",
      validationPlan: "Compare held-out locations and review global full text.",
      falsificationCondition: "The factor pattern does not recur under the same definitions.",
      evidenceBoundary: "Thai page-linked packets support local claims; OpenAlex records are metadata-only leads.",
    },
    generatedAt: new Date().toISOString(),
    stages: ["Map the Thai field", "Inspect full-paper evidence", "Connect Thai and global leads", "Frame the gap and next study"].map((title, index) => ({
      id: `stage-${index + 1}`,
      title,
      objective: `Objective ${index + 1} for an applied literature review.`,
      prompt: `Study stage ${index + 1} with exact-page evidence.`,
      checkpointQuestion: `Checkpoint question ${index + 1}?`,
      concepts: [`Concept gap ${index + 1}`],
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
  await page.route("**/api/research-path", async (route) => {
    const request = route.request().postDataJSON() as { action?: string; stageId?: string };
    if (request.action !== "assess_checkpoint") {
      await route.fulfill({ json: pathPayload });
      return;
    }
    const mastered = request.stageId === "stage-1";
    await route.fulfill({ json: {
      version: "civilmcp-checkpoint-assessment-v1",
      stageId: request.stageId,
      status: mastered ? "understood" : "partial",
      score: mastered ? 84 : 58,
      gradeAvailable: true,
      assessmentMode: "model",
      feedback: mastered ? "The answer connects the themes to the supplied evidence." : "The comparison needs a clearer scope and source link.",
      strengths: ["Identifies a relevant theme"],
      gaps: mastered ? [] : ["Explain where the two scopes differ"],
      nextStep: mastered ? "Continue to methods." : "Revise the comparison with the cited page.",
      evidence: [{
        evidenceId: "E1",
        citation: "TRL40 · p.3",
        source: "NCCE29_TRL40.md",
        id: "chunk-1",
        sectionIndex: 1,
        chunkIndex: 0,
        pageStart: 3,
        pageEnd: 3,
        sectionTitle: "Results",
        snippet: "Mock exact-page evidence for the assessment.",
      }],
      model: "gpt-5.6-luna",
      assessedAt: new Date().toISOString(),
    } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Research Path" }).click();
  await expect(page.getByRole("heading", { name: "Turn a topic into a research plan" })).toBeVisible();
  await expect(page.getByLabel("What do you want to understand?")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Starting point" })).toContainText("New to the topic");
  await expect(page.getByRole("button", { name: "Target outcome" })).toContainText("Study plan");
  await page.getByLabel("What do you want to understand?").fill("Urban road safety in Thailand");
  await page.getByRole("button", { name: "Build research path" }).click();

  const workspace = page.getByLabel("Personalized research learning path");
  await expect(workspace.getByRole("heading", { name: "Urban road safety in Thailand" })).toBeVisible();
  await expect(workspace.locator(".pathStage")).toHaveCount(4);
  await expect(workspace.getByText("Global road safety research")).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Candidate gap · not proven novel" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Next-Study Protocol" })).toBeVisible();
  await expect(workspace.getByText("Path planned with GPT‑5.6 Luna from the retrieved evidence set.")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Stage 1: Map the Thai field · Current" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Stage 2: Inspect full-paper evidence · Upcoming" })).toBeVisible();
  const firstStage = workspace.locator(".pathStage").first();
  await expect(firstStage.getByText("Research checkpoint")).toBeVisible();
  await expect(firstStage.getByText("Read", { exact: true })).toBeVisible();
  await expect(firstStage.getByRole("button", { name: "Open paper evidence: Thai road safety paper 1" })).toBeVisible();
  await expect(firstStage.getByText(/p\.1-8/)).toHaveCount(0);
  await expect(firstStage.getByText(/packets/i)).toHaveCount(0);
  await firstStage.getByRole("button", { name: "Load demo answer" }).click();
  await expect(firstStage.getByLabel("Your reasoning")).toHaveValue(/Demo learning claim:/);
  await expect(firstStage.getByLabel("Your reasoning")).toBeFocused();
  await expect(workspace.getByRole("button", { name: "Stage 1: Map the Thai field · Draft" })).toBeVisible();
  await firstStage.getByRole("button", { name: "Complete task" }).click();
  await expect(workspace.getByText("84/100")).toBeVisible();
  await expect(workspace).toContainText("1 of 4 stages mastered");
  await expect(workspace.getByRole("button", { name: "Stage 1: Map the Thai field · Mastered" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Stage 2: Inspect full-paper evidence · Current" })).toBeVisible();
  const secondStage = workspace.locator(".pathStage").nth(1);
  await secondStage.getByLabel("Your reasoning").fill("The methods are different, but the supplied answer does not yet explain why or connect the claim to a page.");
  await secondStage.getByRole("button", { name: "Check understanding" }).click();
  await expect(workspace.getByText("58/100")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Stage 2: Inspect full-paper evidence · Review" })).toBeVisible();
  const adaptButton = workspace.getByRole("button", { name: "Adapt to 1 learning gap" });
  await expect(adaptButton).toBeVisible();
  await adaptButton.click();
  await expect(workspace.getByText("84/100")).toBeVisible();
  await expect(workspace).toContainText("1 of 4 stages mastered");
  const pathDownload = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "Export" }).click();
  await expect((await pathDownload).suggestedFilename()).toMatch(/^seed-research-path-draft-\d+\.md$/);
  await expectNoPageOverflow(page);
  await expectNoInteractiveOverlap(page);
});

test("Deep Research is open access", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByRole("button", { name: /Quick Answer/ }).click();
  const deepResearch = page.getByRole("menuitemradio", { name: /Deep Research/ });
  await expect(deepResearch).toContainText("OpenAI");
  await deepResearch.click();
  await expect(page.getByRole("button", { name: /Deep Research/ })).toBeVisible();
  await expect(page.getByLabel("SEEDY Open Access")).toHaveCount(0);
});

test("Research Workspace is a separate open-access surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Workspace" }).click();
  const workspace = page.getByLabel("Open Access Research Workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText("Build scientific evidence snapshots with exact-page provenance.")).toBeVisible();
  await expect(workspace.getByText("Verified Review Project")).toBeVisible();
  await expect(workspace.getByText("Open review tools", { exact: true })).toBeVisible();
  await expect(workspace.getByText(/Batch research and every model are unlocked/)).toBeVisible();
  await expect(workspace.getByText(/Research Notebook asks require sign-in/)).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Run selected/ })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("sidebar exposes Research Notebook as a first-class surface", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNavigation.getByRole("button", { name: "Notebook" })).toBeVisible();
  await primaryNavigation.getByRole("button", { name: "Notebook" }).click();

  const notebookWorkspace = page.getByLabel("Research Notebook Workspace");
  await expect(notebookWorkspace).toBeVisible();
  await expect(notebookWorkspace.getByRole("heading", { name: "Ask this Workspace" })).toBeVisible();
  await expect(notebookWorkspace).toContainText("Seedy bounded retrieval active");
});

test("live glass is bounded away from the scrolling paper feed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  await expect.poll(() => page.locator(".researchCard").count()).toBeGreaterThan(0);

  const materialContract = await page.evaluate(() => {
    const composer = document.querySelector<HTMLElement>(".searchComposer");
    const card = document.querySelector<HTMLElement>(".researchCard");
    return {
      composer: composer ? getComputedStyle(composer).backdropFilter : "missing",
      card: card ? getComputedStyle(card).backdropFilter : "missing",
    };
  });

  expect(materialContract.composer).toContain("blur(");
  expect(materialContract.card).toBe("none");
});

test("Open Access can batch-run, inspect, review, and export workspace cells", async ({ page }) => {
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
    summary: "Mocked Thai research evidence for a workspace batch.",
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
    plan: "free",
    status: "active",
    creditsIncluded: 600,
    creditsUsed: 0,
    creditsRemaining: 600,
    resetAt: "2026-08-21T00:00:00.000Z",
    premiumModels: true,
    openAccess: true,
    billingConfigured: false,
    priceThb: 0,
    hasStripeCustomer: false,
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
      question?: string;
      sources?: string[];
    };
    if (request.action === "save") {
      await route.fulfill({ json: { workspace: { workspaceId: request.workspaceId, state: request.state } } });
      return;
    }
    if (request.action === "ask") {
      await route.fulfill({ json: {
        version: "seed-research-notebook-answer-v1",
        workspaceId: request.workspaceId,
        model: "gpt-5.6-luna",
        answer: "Both selected studies report a page-linked road-safety finding [N1], while cross-context validation remains missing [N2].",
        citations: (request.sources ?? []).slice(0, 2).map((source, index) => ({
          id: `N${index + 1}`,
          evidenceId: `evidence-${index + 1}`,
          source,
          pageStart: 3 + index,
          pageEnd: 3 + index,
          sectionTitle: "Results",
          snippet: "Mocked exact-page Notebook evidence.",
          shareable: true,
        })),
        insufficient: false,
        shareable: true,
        adapter: {
          requested: "openrag",
          active: false,
          status: "disabled_for_challenge_candidate",
          retrievalAuthority: "seedy_bounded_retrieval",
          evidenceAuthority: "seedy_rights_and_exact_page_contract",
        },
        generatedAt: "2026-09-01T00:02:00.000Z",
      } });
      return;
    }
    await route.fulfill({ json: {
      version: "civilmcp-research-workspace-run-v1",
      workspaceId: request.workspaceId,
      runId: request.runId,
      model: request.model,
      chargedCredits: 0,
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
  await page.addInitScript((savedCards) => {
    window.localStorage.setItem(
      "civilmcp-bookmarks",
      JSON.stringify(Object.fromEntries(savedCards.map((card) => [card.id, card]))),
    );
  }, cards);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore" }).click();
  await page.getByRole("button", { name: /^Saved/ }).click();
  const savedFeed = page.getByRole("region", { name: "Seedy Research feed" });
  await savedFeed.getByRole("button", { name: "Compare", exact: true }).nth(0).click();
  await savedFeed.getByRole("button", { name: "Compare", exact: true }).nth(0).click();
  await expect(page.getByLabel("Compare saved papers")).toContainText("2 selected");
  await page.getByRole("button", { name: "Compare in Workspace" }).click();
  const workspace = page.getByLabel("Open Access Research Workspace");
  await expect(workspace.locator("tbody tr")).toHaveCount(2);
  const notebook = workspace.getByLabel("Research Notebook", { exact: true });
  await expect(notebook).toContainText("Seedy bounded retrieval active · OpenRAG adapter staged");
  await notebook.getByRole("button", { name: "Ask selected sources" }).click();
  await expect(notebook).toContainText("Both selected studies report a page-linked road-safety finding");
  await expect(notebook.getByLabel("Research Notebook exact-page citations").getByRole("button")).toHaveCount(2);
  const exactEvidenceRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.includes("/api/papers/") && url.searchParams.get("evidence") === "evidence-1" && url.searchParams.get("page") === "3";
  });
  await notebook.getByLabel("Research Notebook exact-page citations").getByRole("button").first().click();
  await exactEvidenceRequest;
  await page.getByRole("button", { name: "Close paper detail" }).click();
  await expect(notebook.getByRole("button", { name: "Promote to Passport" })).toBeEnabled();
  await expect(notebook.getByRole("button", { name: "Continue to Path" })).toBeEnabled();
  await workspace.getByRole("button", { name: /Run selected/ }).click();
  await expect(workspace.getByText(/Review run complete · verify generated cells/)).toBeVisible();
  await workspace.getByRole("button", { name: /Method for Thai road safety evidence 1/ }).click();
  const inspector = page.getByLabel("Cell evidence inspector");
  await expect(inspector).toContainText("method finding for paper 1");
  await expect(inspector).toContainText("p.3");
  await inspector.getByRole("button", { name: /Verified/ }).click();
  await expect(inspector.getByText("Review · verified")).toBeVisible();
  const download = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "Export CSV" }).click();
  await expect((await download).suggestedFilename()).toMatch(/^seed-research-workspace-\d+\.csv$/);

  await workspace.getByRole("button", { name: "Template" }).click();
  await workspace.getByRole("menuitemradio", { name: /PRISMA scoping review/ }).click();
  const prisma = workspace.getByLabel("PRISMA-guided scoping review");
  await expect(prisma).toContainText("Review protocol");
  await expect(prisma.getByText("Search strategy")).toBeVisible();
  await prisma.getByRole("group", { name: "Screen Thai road safety evidence 1" }).getByRole("button", { name: "Include" }).click();
  await prisma.getByRole("group", { name: "Screen Thai road safety evidence 2" }).getByRole("button", { name: "Exclude" }).click();
  await prisma.getByLabel("Exclusion reason for Thai road safety evidence 2").fill("Outside the review context");
  await expect(prisma.getByLabel("Screened 2")).toBeVisible();
  await expect(prisma.getByLabel("Included 1")).toBeVisible();
  await expect(prisma.getByLabel("Excluded 1")).toBeVisible();
  await workspace.getByRole("button", { name: /Run included/ }).click();
  await expect(workspace.getByText(/Review run complete · verify generated cells/)).toBeVisible();
  const prismaDownload = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "Export PRISMA" }).click();
  await expect((await prismaDownload).suggestedFilename()).toMatch(/^seed-research-prisma-scoping-review-\d+\.md$/);
  await expectNoPageOverflow(page);
});

test("model menu supports keyboard navigation and focus return", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  const trigger = page.locator(".modelControl").getByRole("button", { name: /^Model/ });
  await trigger.focus();
  await trigger.press("ArrowDown");

  const options = page.getByRole("menuitemradio");
  const selectedOption = page.getByRole("menuitemradio", { checked: true });
  await expect(selectedOption).toBeFocused();
  await expect(selectedOption).toContainText("GPT-5.6 Luna");
  await selectedOption.press("End");
  await expect(options.last()).toBeFocused();
  await options.last().press("Escape");
  await expect(page.getByRole("menu", { name: "Model" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("chat batches a dense response stream without a React update loop", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") clientErrors.push(message.text());
  });
  page.on("pageerror", (error) => clientErrors.push(error.message));

  const sessionId = "00000000-0000-4000-8000-000000000099";
  const guestUser = { userId: "guest-stream-test", displayName: "Guest researcher", isGuest: true };
  await page.route("**/api/session", (route) => route.fulfill({ json: { sessionId } }));
  await page.route("**/api/history**", (route) => route.fulfill({
    json: route.request().method() === "POST"
      ? { ok: true, sessionId }
      : { sessionId, title: "Untitled chat", mode: "mcp", model: "gpt-5.6-luna", collection: "", messages: [], user: guestUser, authenticated: false },
  }));
  await page.route("**/api/chat-sessions**", (route) => route.fulfill({ json: { sessions: [], user: guestUser, authenticated: false } }));
  await page.route("**/api/billing**", (route) => route.fulfill({ json: { plan: "guest", status: "active", premiumModels: true, openAccess: true, billingConfigured: false, priceThb: 0 } }));
  await page.route("**/api/research-feed**", (route) => route.fulfill({
    json: { cards: [], facets: { total: 0, totalSections: 0, totalChunks: 0, filters: {} }, nextCursor: null },
  }));
  await page.route("**/api/chat", async (route) => {
    const stream = [
      ...Array.from({ length: 120 }, (_, index) => `0:${JSON.stringify(index === 0 ? "Streamed answer " : `part-${index} `)}`),
      `d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 10, completionTokens: 120 } })}`,
      "",
    ].join("\n");
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { "x-vercel-ai-data-stream": "v1" },
      body: stream,
    });
  });

  await page.goto("/?view=chat");
  await page.getByLabel("Ask about research evidence").fill("Verify the dense stream");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Streamed answer part-1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.waitForTimeout(250);

  expect(clientErrors.filter((message) => /Maximum update depth|React error #185/i.test(message))).toEqual([]);
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
        priceThb: 299,
        hasStripeCustomer: false,
      },
    }),
  );
  await page.route("**/api/research-feed**", (route) =>
    route.fulfill({ json: { cards: [], facets: { total: 941, totalSections: 8148, totalChunks: 48370, filters: {} }, nextCursor: null } }),
  );
  const evidenceItem = {
    evidenceId: "E1",
    id: "chunk-road-safety-1",
    sectionId: "section-road-safety",
    sectionIndex: 2,
    chunkIndex: 1,
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
      `8:${JSON.stringify([{
        type: "civilmcp_context",
        traceId: "trace-test",
        intent: "compare",
        searchQuery: "Thai road safety factors",
        queryExpansions: ["truck crash", "road safety"],
        discipline: "transport",
        collection: "ncce",
        retrievalMode: "semantic",
        sectionsUsed: 2,
        chunksUsed: 4,
        evidenceItems: [evidenceItem],
      }])}`,
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
  await page.route("**/api/papers/NCCE29_TRL40.md**", async (route) => {
    await route.fulfill({
      json: {
        document: {
          id: "paper-road-safety",
          source: "NCCE29_TRL40.md",
          sourcePdf: "NCCE29_TRL40.pdf",
          collection: "ncce",
          paperCode: "TRL40",
          discipline: "transport",
          title: "Thai road safety evidence",
          date: "2026",
          sourceLabel: "NCCE29",
          summary: "Mocked road safety paper.",
          tags: ["Transportation"],
          filters: ["hot", "evidence", "ncce"],
          evidenceCount: 1,
          pages: 8,
          pageLabel: "p.1-8",
          preview: "traffic",
          prompt: "Ask this road safety paper.",
          citable: true,
        },
        sections: [],
        evidence: [{
          id: "chunk-road-safety-1",
          sectionIndex: 2,
          chunkIndex: 1,
          sectionTitle: "Results",
          pageStart: 3,
          pageEnd: 3,
          snippet: "Representative exact-page evidence for the mission contract.",
        }],
        counts: { sections: 1, chunks: 1 },
        related: [],
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Chat" }).click();
  const composer = page.getByLabel("Ask about research evidence");
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

  const audit = page.getByLabel("Evidence audit");
  await expect(audit).toContainText("Provenance complete");
  await audit.locator("summary").click();
  await expect(audit).toContainText("1/1 citation IDs resolve");
  await expect(audit).toContainText("Thai road safety factors");
  await expect(audit).toContainText("Cross-paper comparison");
  await expect(audit).toContainText("Expanded · truck crash");
  const auditDownload = page.waitForEvent("download");
  await audit.getByRole("button", { name: "Export audit" }).click();
  await expect((await auditDownload).suggestedFilename()).toMatch(/^seed-research-evidence-audit-\d+\.md$/);
  await audit.getByRole("button", { name: /\[E1\] p\.3/ }).first().click();
  await expect(page.getByLabel("Cited evidence packet")).toBeVisible();
  await expect(page).toHaveURL(/paper=NCCE29_TRL40\.md/);
  await expect(page).toHaveURL(/evidence=chunk-road-safety-1/);
  await page.getByRole("button", { name: "Close paper detail" }).click();

  const downloadPromise = page.waitForEvent("download");
  await mission.getByRole("button", { name: "Export Evidence Brief" }).click();
  await expect((await downloadPromise).suggestedFilename()).toMatch(/seed-research-evidence-brief-.*\.md/);
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
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("paper-language-test-ready") === "1") return;
    window.localStorage.removeItem("civilmcp-paper-language-v1");
    window.sessionStorage.setItem("paper-language-test-ready", "1");
  });
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
  await page.route("**/api/billing**", (route) => route.fulfill({ json: { plan: "guest", status: "active", premiumModels: false, billingConfigured: false, priceThb: 299 } }));
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
  await page.getByRole("button", { name: "Explore" }).click();

  const languageControl = page.getByRole("group", { name: "Paper language" });
  const englishButton = languageControl.getByRole("button", { name: "Translate papers to English" });
  const thaiButton = languageControl.getByRole("button", { name: "Show Thai original" });
  await expect(languageControl).toBeVisible();
  await expect(thaiButton).toHaveAttribute("aria-pressed", "true");
  expect(translationRequests).toBe(0);
  await expect(page.locator(".researchCard [lang='en']").filter({ hasText: "[EN]" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("civilmcp-paper-language-v1"))).toBe("th");

  await englishButton.click();
  await expect(englishButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".researchCard [lang='en']").filter({ hasText: "[EN]" }).count()).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole("button", { name: "Explore" }).click();
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
  await page.getByRole("button", { name: "Explore" }).click();
  const opener = page.locator(".researchCard").first().getByRole("button", { name: /Evidence|Read paper/ });
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
  await expect(page.locator(".searchComposer")).toHaveCSS("backdrop-filter", "none");
  await expectNoPageOverflow(page);
});
