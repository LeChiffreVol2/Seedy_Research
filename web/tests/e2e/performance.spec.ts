import { expect, test } from "@playwright/test";

const emptyFeed = {
  cards: [],
  facets: {
    total: 0,
    totalSections: 0,
    totalChunks: 0,
    catalogTotal: 0,
    citableTotal: 0,
    metadataOnlyTotal: 0,
    providers: [],
    coverage: [],
    collections: [],
    filters: {},
  },
  nextCursor: null,
  generatedAt: "2026-09-02T00:00:00.000Z",
};

test("Thai research feed starts without waiting for session history", async ({ page }) => {
  let feedRequestedAt = 0;
  let historyCompletedAt = 0;

  await page.route("**/api/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ json: { sessionId: "perf-session" } });
  });
  await page.route("**/api/history**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    historyCompletedAt = Date.now();
    await route.fulfill({ json: {
      sessionId: "perf-session",
      title: "Performance probe",
      mode: "mcp",
      model: "gpt-5.6-luna",
      collection: "",
      messages: [],
      user: { userId: "guest-perf", displayName: "Guest researcher", isGuest: true },
      authenticated: false,
    } });
  });
  await page.route("**/api/research-feed**", async (route) => {
    feedRequestedAt = Date.now();
    await route.fulfill({ json: emptyFeed });
  });
  await page.route("**/api/billing", (route) => route.fulfill({ json: {
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
  } }));
  await page.route("**/api/chat-sessions", (route) => route.fulfill({ json: {
    sessions: [],
    user: { userId: "guest-perf", displayName: "Guest researcher", isGuest: true },
    authenticated: false,
  } }));
  await page.route("**/api/events", (route) => route.fulfill({ json: { ok: true } }));

  await page.goto("/?view=explore");

  await expect.poll(() => feedRequestedAt > 0, { timeout: 800 }).toBe(true);
  expect(historyCompletedAt).toBe(0);
});

test("initial Thai discovery does not fan out into automatic translation requests", async ({ page }) => {
  let translationRequests = 0;
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/api/session", (route) => route.fulfill({ json: { sessionId: "translation-perf" } }));
  await page.route("**/api/history**", (route) => route.fulfill({ json: {
    sessionId: "translation-perf",
    title: "Translation performance probe",
    mode: "mcp",
    model: "gpt-5.6-luna",
    collection: "",
    messages: [],
    user: { userId: "guest-perf", displayName: "Guest researcher", isGuest: true },
    authenticated: false,
  } }));
  await page.route("**/api/research-feed**", (route) => route.fulfill({ json: {
    ...emptyFeed,
    cards: [{
      id: "thai-local-performance-paper",
      source: "thaijo:performance:1",
      collection: "",
      sourceType: "journal_article",
      paperCode: "TH-PERF-1",
      pageStart: 1,
      pageEnd: 5,
      discipline: "transportation",
      language: "th",
      title: "การศึกษาความปลอดภัยทางถนนในประเทศไทย",
      date: "2025",
      sourceLabel: "ThaiJO",
      summary: "หลักฐานภาษาไทยสำหรับทดสอบการโหลดหน้าแรก",
      tags: ["ประเทศไทย"],
      filters: ["hot", "evidence", "thai"],
      evidenceCount: 1,
      pages: 5,
      pageLabel: "5 verified pages",
      preview: "traffic",
      prompt: "",
      provider: "tci_thaijo",
      evidenceStatus: "indexed",
      citable: true,
      canonicalUrl: "https://example.org/thai-paper",
      discoveryLayer: "evidence",
    }],
    facets: { ...emptyFeed.facets, total: 1, catalogTotal: 1, citableTotal: 1, filters: { hot: 1, evidence: 1, thai: 1 } },
  } }));
  await page.route("**/api/paper-translation", async (route) => {
    translationRequests += 1;
    await route.fulfill({ json: { sourceLanguage: "th", targetLanguage: "en", translations: [], translatedAt: "2026-09-02T00:00:00.000Z" } });
  });
  await page.route("**/api/billing", (route) => route.fulfill({ json: {
    plan: "guest", status: "preview", creditsIncluded: null, creditsUsed: null, creditsRemaining: null,
    resetAt: null, premiumModels: true, openAccess: true, billingConfigured: false, priceThb: 299, hasStripeCustomer: false,
  } }));
  await page.route("**/api/chat-sessions", (route) => route.fulfill({ json: { sessions: [], authenticated: false } }));
  await page.route("**/api/events", (route) => route.fulfill({ json: { ok: true } }));

  await page.goto("/?view=explore");
  await expect(page.getByText("การศึกษาความปลอดภัยทางถนนในประเทศไทย")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Thai original" })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);

  expect(translationRequests).toBe(0);
});
