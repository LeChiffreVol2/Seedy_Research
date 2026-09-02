import { expect, test, type Page } from "@playwright/test";

const PAPER_SOURCE = "NCCE31_CEM-06.md";
const OFFICIAL_SOURCE_URL = "https://example.org/thai-paper";
const STABLE_ANCHOR_1 = "asset:reader-verified:page:1";
const STABLE_ANCHOR_2 = "asset:reader-verified:page:2";

type ReaderPayload = {
  paper?: Record<string, unknown>;
  access: {
    mode: string;
    statusLabel?: string;
    reason?: string;
    sourceUrl?: string;
    instructions?: string;
    institution?: string;
    licenseExpression?: string;
    rightsVerifiedAt?: string;
  };
  assets?: Array<Record<string, unknown>>;
  pages?: Array<{
    id: string;
    assetId?: string;
    pageNumber: number;
    pageLabel: string;
    anchor: string;
    sectionTitle?: string;
    text: string;
    textSha256: string;
  }>;
  outline?: Array<{ id: string; title: string; pageStart: number; pageEnd: number }>;
  capabilities?: {
    search: boolean;
    annotation: boolean;
    citation: boolean;
    download: boolean;
    translation: boolean;
  };
  citation?: { plainText: string; exportUrl: string };
  pagination?: { totalPages: number };
  generatedAt?: string;
};

const nativeVerifiedPayload: ReaderPayload = {
  paper: {
    source: PAPER_SOURCE,
    title: "การบริหารความเสี่ยงในงานก่อสร้าง",
    provider: "ncce",
  },
  access: {
    mode: "native_verified",
    statusLabel: "Native full text verified",
    sourceUrl: OFFICIAL_SOURCE_URL,
    licenseExpression: "CC BY 4.0",
    rightsVerifiedAt: "2026-08-31T00:00:00.000Z",
  },
  assets: [{
    id: "reader-verified",
    sourceUrl: OFFICIAL_SOURCE_URL,
    pageCount: 2,
    readerAccessMode: "native_verified",
  }],
  pages: [
    {
      id: "reader-page-one",
      assetId: "reader-verified",
      pageNumber: 1,
      pageLabel: "Page 1",
      anchor: STABLE_ANCHOR_1,
      sectionTitle: "บทนำ",
      text: "การประเมินความเสี่ยงต้องเชื่อมโยงหลักฐานกับหน้าต้นฉบับที่ผู้วิจัยสามารถเปิดตรวจสอบซ้ำได้",
      textSha256: "a".repeat(64),
    },
    {
      id: "reader-page-two",
      assetId: "reader-verified",
      pageNumber: 2,
      pageLabel: "Page 2",
      anchor: STABLE_ANCHOR_2,
      sectionTitle: "ผลการศึกษา",
      text: "ผลการศึกษาพบว่าการจัดการกำแพงกันดินและการทบทวนข้อมูลภาคสนามช่วยลดความไม่แน่นอนของโครงการ",
      textSha256: "b".repeat(64),
    },
  ],
  outline: [
    { id: "outline-intro", title: "บทนำ", pageStart: 1, pageEnd: 1 },
    { id: "outline-results", title: "ผลการศึกษา", pageStart: 2, pageEnd: 2 },
  ],
  capabilities: {
    search: true,
    annotation: true,
    citation: true,
    download: false,
    translation: false,
  },
  citation: {
    plainText: "Demo Researcher. การบริหารความเสี่ยงในงานก่อสร้าง. NCCE.",
    exportUrl: "https://example.org/citation.ris",
  },
  pagination: { totalPages: 2 },
  generatedAt: "2026-08-31T00:00:00.000Z",
};

function failClosedPayload(mode: "source_hosted" | "restricted" | "metadata_only"): ReaderPayload {
  const labels = {
    source_hosted: "Full text remains at the publisher",
    restricted: "Institutional access required",
    metadata_only: "Metadata record only",
  } as const;
  return {
    access: {
      mode,
      statusLabel: labels[mode],
      reason: mode === "metadata_only" ? "rights_not_verified" : "source_controls_access",
      sourceUrl: OFFICIAL_SOURCE_URL,
      instructions: mode === "restricted" ? "Sign in through the member university library." : undefined,
      institution: mode === "restricted" ? "ThaiLIS member library" : undefined,
    },
    assets: [{ id: `${mode}-asset`, sourceUrl: OFFICIAL_SOURCE_URL, readerAccessMode: mode }],
    // A hostile or malformed response must not make non-native text readable.
    pages: [{
      id: `${mode}-leaked-page`,
      pageNumber: 99,
      pageLabel: "Page 99",
      anchor: `asset:${mode}:page:99`,
      text: "THIS NON-NATIVE FULL TEXT MUST NEVER RENDER",
      textSha256: "c".repeat(64),
    }],
    generatedAt: "2026-08-31T00:00:00.000Z",
  };
}

async function routeReader(page: Page, getPayload: () => ReaderPayload) {
  await page.route("**/api/papers/*/reader**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getPayload()),
    });
  });
}

async function openPublicReader(page: Page) {
  const response = await page.goto(`/papers/${encodeURIComponent(PAPER_SOURCE)}`);
  expect(response?.ok()).toBe(true);
  const reader = page.getByTestId("paper-reader");
  await expect(reader).toBeVisible({ timeout: 30_000 });
  // The first reader render may share a cold dev compiler with other E2E files.
  // Wait on the semantic ready state instead of racing the transient copy.
  await expect(reader.getByTestId("reader-access-state")).toBeVisible({ timeout: 45_000 });
  await expect(reader.getByText("Checking verified access and page provenance…")).toHaveCount(0);
  return reader;
}

async function selectPhrase(page: Page, pageNumber: number, phrase: string) {
  await page.getByTestId(`reader-page-${pageNumber}`).locator("p").evaluate((element, selectedPhrase) => {
    const textNode = element.querySelector("span")?.firstChild;
    if (!(textNode instanceof Text)) throw new Error("Reader page did not expose a selectable text node.");
    const start = textNode.data.indexOf(selectedPhrase);
    if (start < 0) throw new Error("Test phrase was not found in the reader page.");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + selectedPhrase.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  }, phrase);
}

test("native verified reader keeps stable page anchors through search, navigation, notes, and citation", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await routeReader(page, () => nativeVerifiedPayload);
  const reader = await openPublicReader(page);

  await expect(reader.getByRole("heading", { name: "Read and anchor evidence to the page" })).toBeVisible();
  await expect(reader.getByTestId("reader-access-state")).toHaveText(/Native full text verified/);
  await expect(reader).toContainText("CC BY 4.0");

  const firstPage = reader.getByTestId("reader-page-1");
  const secondPage = reader.getByTestId("reader-page-2");
  await expect(firstPage).toHaveAttribute("id", "asset-reader-verified-page-1");
  await expect(secondPage).toHaveAttribute("id", "asset-reader-verified-page-2");
  await expect(firstPage.getByRole("link", { name: "#asset-reader-verified-page-1" })).toHaveAttribute("href", "#asset-reader-verified-page-1");
  await expect(secondPage).toContainText("ผลการศึกษาพบว่า");

  await reader.focus();
  await page.keyboard.press("/");
  const search = reader.getByRole("searchbox", { name: "Search within paper" });
  await expect(search).toBeFocused();
  await search.fill("กำแพงกันดิน");
  const results = reader.getByRole("region", { name: "Paper search results" });
  await expect(results).toContainText("1 matching loaded pages");
  const searchResult = results.getByRole("button");
  await expect(searchResult).toBeEnabled();
  await searchResult.press("Enter");
  await expect(reader.getByRole("combobox", { name: "Page number" })).toHaveValue("2");

  const previousPage = reader.getByRole("button", { name: "Previous page" });
  await expect(previousPage).toBeEnabled();
  await previousPage.press("Enter");
  await expect(reader.getByRole("combobox", { name: "Page number" })).toHaveValue("1");
  const nextPage = reader.getByRole("button", { name: "Next page" });
  await expect(nextPage).toBeEnabled();
  await nextPage.press("Enter");
  await expect(reader.getByRole("combobox", { name: "Page number" })).toHaveValue("2");

  await selectPhrase(page, 2, "กำแพงกันดิน");
  const selectionToolbar = reader.getByTestId("reader-selection-toolbar");
  await expect(selectionToolbar).toBeVisible();
  await selectionToolbar.getByRole("button", { name: "Add note" }).focus();
  await page.keyboard.press("Enter");
  const note = reader.getByRole("textbox", { name: "Note on page 2" });
  await expect(note).toBeFocused();
  await note.fill("Compare this intervention with the field evidence.");
  await reader.getByRole("button", { name: "Save note" }).focus();
  await page.keyboard.press("Enter");
  await expect(reader.getByTestId("reader-note-panel")).toContainText("Compare this intervention with the field evidence.");
  await expect(reader.getByRole("status")).toContainText("Note saved on page 2.");
  await expect(secondPage.locator("mark")).toContainText("กำแพงกันดิน");

  await secondPage.getByRole("button", { name: "Copy page citation" }).focus();
  await page.keyboard.press("Enter");
  await expect(reader.getByRole("status")).toContainText("Page 2 citation copied.");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Page 2");

  await selectPhrase(page, 1, "หลักฐาน");
  await expect(selectionToolbar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(selectionToolbar).toHaveCount(0);
});

test("source-hosted, restricted, and metadata-only modes never masquerade as native full text", async ({ page }) => {
  test.setTimeout(120_000);
  let payload = failClosedPayload("source_hosted");
  await routeReader(page, () => payload);

  let reader = await openPublicReader(page);
  await expect(reader.getByTestId("reader-access-state")).toContainText("Full text remains at the publisher");
  await expect(reader.getByRole("link", { name: "Open official full text" })).toHaveAttribute("href", OFFICIAL_SOURCE_URL);
  await expect(reader.getByText("THIS NON-NATIVE FULL TEXT MUST NEVER RENDER")).toHaveCount(0);
  await expect(reader.locator("[data-testid^='reader-page-']")).toHaveCount(0);

  payload = failClosedPayload("restricted");
  await page.reload();
  reader = page.getByTestId("paper-reader");
  await expect(reader.getByTestId("reader-access-state")).toContainText("Institutional access required");
  await expect(reader.getByTestId("reader-access-state")).toContainText("Sign in through the member university library.");
  await expect(reader.getByTestId("reader-access-state")).toContainText("ThaiLIS member library");
  await expect(reader.getByRole("link", { name: "Open institutional resolver" })).toHaveAttribute("href", OFFICIAL_SOURCE_URL);
  await expect(reader.getByText("THIS NON-NATIVE FULL TEXT MUST NEVER RENDER")).toHaveCount(0);

  payload = failClosedPayload("metadata_only");
  await page.reload();
  reader = page.getByTestId("paper-reader");
  await expect(reader.getByTestId("reader-access-state")).toContainText("Metadata record only");
  await expect(reader.getByRole("link", { name: "Open source record" })).toHaveAttribute("href", OFFICIAL_SOURCE_URL);
  await expect(reader.getByRole("link", { name: "Open official full text" })).toHaveCount(0);
  await expect(reader.getByRole("searchbox", { name: "Search within paper" })).toHaveCount(0);
  await expect(reader.getByText("THIS NON-NATIVE FULL TEXT MUST NEVER RENDER")).toHaveCount(0);
  await expect(reader.locator("[data-testid^='reader-page-']")).toHaveCount(0);
});

test("native reader stays usable on mobile with reduced motion", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 780 });
  await routeReader(page, () => nativeVerifiedPayload);
  const reader = await openPublicReader(page);

  await expect(reader.getByRole("searchbox", { name: "Search within paper" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(reader.getByLabel(/Full text of/)).toHaveCSS("scroll-behavior", "auto");

  for (const control of [
    reader.getByRole("button", { name: "Previous page" }),
    reader.getByRole("button", { name: "Next page" }),
    reader.getByRole("combobox", { name: "Page number" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("committed rights-reviewed paper reaches the real reader route with journal page labels", async ({ page }) => {
  test.setTimeout(90_000);
  const source = "thaijo:learn:291543";
  const response = await page.goto(`/papers/${encodeURIComponent(source)}`);
  expect(response?.ok()).toBe(true);

  const reader = page.getByTestId("paper-reader");
  await expect(reader.getByTestId("reader-access-state")).toContainText("Native full text verified", { timeout: 30_000 });
  await expect(reader).toContainText("CC-BY-4.0");
  await expect(reader.getByTestId("reader-page-1")).toHaveAttribute("id", "asset-thaijo-learn-291543-pdf-page-1");
  await expect(reader.getByTestId("reader-page-1")).toContainText("156");
  await expect(reader.getByTestId("reader-outline")).toContainText("p.156");
  await expect(reader.getByRole("link", { name: "Download permitted copy" })).toHaveAttribute(
    "href",
    "https://so04.tci-thaijo.org/index.php/LEARN/article/download/291543/192897/1318731",
  );
  await reader.getByRole("button", { name: "Load next pages" }).click();
  await expect(reader.getByTestId("reader-page-20")).toContainText("175");
  await reader.getByRole("button", { name: "Load next pages" }).click();
  await expect(reader.getByTestId("reader-page-26")).toContainText("181");
  await expect(reader.getByRole("button", { name: "Load next pages" })).toHaveCount(0);
  await expect(reader.getByRole("combobox", { name: "Page number" }).locator("option")).toHaveCount(26);

  const readerResponse = await page.request.get(`/api/papers/${encodeURIComponent(source)}/reader?limit=1`);
  expect(readerResponse.ok()).toBe(true);
  expect(readerResponse.headers()["cache-control"]).toContain("private, no-store");
  const readerPayload = await readerResponse.json() as {
    access: { mode: string };
    pages: Array<{ pageNumber: number; pageLabel: string; anchor: string }>;
  };
  expect(readerPayload.access.mode).toBe("native_verified");
  expect(readerPayload.pages[0]).toEqual(expect.objectContaining({
    pageNumber: 1,
    pageLabel: "156",
    anchor: "asset:thaijo-learn-291543-pdf:page:1",
  }));

  const aliasResponse = await page.request.get(`/api/papers?source=${encodeURIComponent("doi:10.70730/KVFS2893")}&page=156`);
  expect(aliasResponse.ok()).toBe(true);
  const aliasPayload = await aliasResponse.json() as {
    document: { source: string; citable: boolean; accessLevel: string };
    evidence: Array<{ pageStart: number; readerPageNumber: number; readerAnchor: string }>;
  };
  expect(aliasPayload.document).toEqual(expect.objectContaining({
    source,
    citable: true,
    accessLevel: "full_text_licensed",
  }));
  expect(aliasPayload.evidence[0]).toEqual(expect.objectContaining({
    pageStart: 156,
    readerPageNumber: 1,
    readerAnchor: "asset:thaijo-learn-291543-pdf:page:1",
  }));
});
