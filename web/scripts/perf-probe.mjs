import { chromium } from "@playwright/test";

const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:3210";
const runs = Number.parseInt(process.env.PERF_RUNS || "3", 10);
const feedBudgetMs = Number.parseInt(process.env.PERF_FEED_BUDGET_MS || "3000", 10);
const maxLongTaskBudgetMs = Number.parseInt(process.env.PERF_MAX_LONG_TASK_MS || "100", 10);
const totalBlockingBudgetMs = Number.parseInt(process.env.PERF_TOTAL_BLOCKING_MS || "250", 10);
const inputBudgetMs = Number.parseInt(process.env.PERF_INPUT_BUDGET_MS || "75", 10);
const filterBudgetMs = Number.parseInt(process.env.PERF_FILTER_BUDGET_MS || "75", 10);
const frameP95BudgetMs = Number.parseInt(process.env.PERF_FRAME_P95_BUDGET_MS || "25", 10);
const frameMaxBudgetMs = Number.parseInt(process.env.PERF_FRAME_MAX_BUDGET_MS || "80", 10);
const settleMs = Number.parseInt(process.env.PERF_SETTLE_MS || "0", 10);
const mockEmptyFeed = process.env.PERF_MOCK_EMPTY_FEED === "1";
const injectContentVisibility = process.env.PERF_INJECT_CONTENT_VISIBILITY === "1";
const disableScrollingBackdrop = process.env.PERF_DISABLE_SCROLLING_BACKDROP === "1";
const disableFixedBackground = process.env.PERF_DISABLE_FIXED_BACKGROUND === "1";
const disableAllBackdrop = process.env.PERF_DISABLE_ALL_BACKDROP === "1";

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (let index = 0; index < runs; index += 1) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.__seedyLongTasks = [];
      if (typeof PerformanceObserver === "function") {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__seedyLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
            }
          });
          observer.observe({ type: "longtask", buffered: true });
        } catch {
          // Long Task API is optional; an empty list remains a valid measurement.
        }
      }
    });

    const page = await context.newPage();
    if (mockEmptyFeed) {
      await page.route("**/api/research-feed**", (route) => route.fulfill({
        json: {
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
          generatedAt: "2026-09-03T00:00:00.000Z",
        },
      }));
    }
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const startedAt = Date.now();
    let feedResponseMs = null;
    page.on("response", (response) => {
      if (feedResponseMs === null && response.url().includes("/api/research-feed")) {
        feedResponseMs = Date.now() - startedAt;
      }
    });

    await page.goto(`${baseUrl}/?view=explore`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const shellMs = Date.now() - startedAt;
    await page.getByRole("button", { name: "Refresh research feed" }).waitFor({ timeout: 20_000 });
    const feedVisibleMs = Date.now() - startedAt;
    if (injectContentVisibility) {
      await page.addStyleTag({
        content: `
          .feedStack > .researchCard,
          .visibilityAuditPanel,
          .coverageLedger,
          .researchCasePanel,
          .globalDiscoveryPanel,
          .researchPassport,
          .livingReviewPanel {
            content-visibility: auto !important;
            contain-intrinsic-size: auto 280px;
          }
        `,
      });
    }
    if (disableScrollingBackdrop) {
      await page.addStyleTag({
        content: `
          .feedStack > .researchCard,
          .visibilityAuditPanel,
          .coverageLedger,
          .researchCasePanel,
          .globalDiscoveryPanel,
          .researchPassport,
          .livingReviewPanel {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }
        `,
      });
    }
    if (disableFixedBackground) {
      await page.addStyleTag({ content: "body { background-attachment: scroll !important; }" });
    }
    if (disableAllBackdrop) {
      await page.addStyleTag({
        content: "* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
      });
    }
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    const scrollMetrics = await page.evaluate(async () => {
      const rail = document.querySelector(".mainRail");
      if (!(rail instanceof HTMLElement)) throw new Error("Main scroll rail was not found.");
      const cardCount = document.querySelectorAll(".feedStack > .researchCard").length;
      const rootScroller = document.scrollingElement;
      const scroller = rail.scrollHeight > rail.clientHeight + 1 ? rail : rootScroller;
      if (!(scroller instanceof HTMLElement)) throw new Error("Page scroll container was not found.");
      const scrollTarget = scroller === rail ? "mainRail" : "document";
      const scrollHeight = scroller.scrollHeight;
      const clientHeight = scroller.clientHeight;
      scroller.scrollTop = 0;
      const intervals = [];
      let previous = performance.now();
      for (let frame = 0; frame < 45; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        scroller.scrollTop += 36;
      }
      scroller.scrollTop = 0;
      const sorted = [...intervals].sort((left, right) => left - right);
      return {
        cardCount,
        scrollTarget,
        scrollHeight,
        clientHeight,
        p95FrameIntervalMs: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0,
        maxFrameIntervalMs: Math.max(0, ...intervals),
      };
    });

    const inputEchoMs = await page.evaluate(async () => {
      const input = document.querySelector('textarea[aria-label="Start a Thai-to-global Research Case"]');
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("Research Case composer was not found.");
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setValue) throw new Error("Native textarea value setter is unavailable.");
      const startedAt = performance.now();
      setValue.call(input, "Which validation gaps recur in Thai transportation research?");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "research" }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    });

    // Include the deferred query commit/search render in the blocking sample,
    // while keeping it separate from the immediate input-echo measurement.
    await page.waitForTimeout(700);
    const filterEchoMs = await page.evaluate(async () => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith("NCCE"));
      if (!(button instanceof HTMLButtonElement)) throw new Error("NCCE filter was not found.");
      const startedAt = performance.now();
      button.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    });
    const browserMetrics = await page.evaluate(() => {
      const longTasks = Array.isArray(window.__seedyLongTasks) ? window.__seedyLongTasks : [];
      const blocking = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
        loadEventMs: navigation?.loadEventEnd || 0,
        longTaskCount: longTasks.length,
        maxLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)),
        totalBlockingMs: blocking,
      };
    });

    results.push({
      run: index + 1,
      shellMs,
      feedResponseMs,
      feedVisibleMs,
      inputEchoMs,
      filterEchoMs,
      consoleErrors: consoleErrors.length,
      ...scrollMetrics,
      ...browserMetrics,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = {
  target: baseUrl,
  runs,
    settleMs,
    mockEmptyFeed,
    injectContentVisibility,
    disableScrollingBackdrop,
    disableFixedBackground,
    disableAllBackdrop,
  budgets: { feedBudgetMs, maxLongTaskBudgetMs, totalBlockingBudgetMs, inputBudgetMs, filterBudgetMs, frameP95BudgetMs, frameMaxBudgetMs },
  p95FeedVisibleMs: percentile(results.map((result) => result.feedVisibleMs), 0.95),
  p95InputEchoMs: percentile(results.map((result) => result.inputEchoMs), 0.95),
  p95FilterEchoMs: percentile(results.map((result) => result.filterEchoMs), 0.95),
  p95FrameIntervalMs: percentile(results.map((result) => result.p95FrameIntervalMs), 0.95),
  maxFrameIntervalMs: Math.max(...results.map((result) => result.maxFrameIntervalMs)),
  maxLongTaskMs: Math.max(...results.map((result) => result.maxLongTaskMs)),
  maxTotalBlockingMs: Math.max(...results.map((result) => result.totalBlockingMs)),
  consoleErrors: results.reduce((sum, result) => sum + result.consoleErrors, 0),
};

const failures = [];
if (summary.p95FeedVisibleMs > feedBudgetMs) failures.push(`feed visible p95 ${summary.p95FeedVisibleMs}ms > ${feedBudgetMs}ms`);
if (summary.p95InputEchoMs > inputBudgetMs) failures.push(`input echo p95 ${summary.p95InputEchoMs}ms > ${inputBudgetMs}ms`);
if (summary.p95FilterEchoMs > filterBudgetMs) failures.push(`filter echo p95 ${summary.p95FilterEchoMs}ms > ${filterBudgetMs}ms`);
if (summary.p95FrameIntervalMs > frameP95BudgetMs) failures.push(`scroll frame p95 ${summary.p95FrameIntervalMs.toFixed(1)}ms > ${frameP95BudgetMs}ms`);
if (summary.maxFrameIntervalMs > frameMaxBudgetMs) failures.push(`scroll frame max ${summary.maxFrameIntervalMs.toFixed(1)}ms > ${frameMaxBudgetMs}ms`);
if (summary.maxLongTaskMs > maxLongTaskBudgetMs) failures.push(`max long task ${summary.maxLongTaskMs.toFixed(1)}ms > ${maxLongTaskBudgetMs}ms`);
if (summary.maxTotalBlockingMs > totalBlockingBudgetMs) failures.push(`blocking ${summary.maxTotalBlockingMs.toFixed(1)}ms > ${totalBlockingBudgetMs}ms`);
if (summary.consoleErrors > 0) failures.push(`${summary.consoleErrors} console errors`);

console.log(JSON.stringify({ passed: failures.length === 0, summary, results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
