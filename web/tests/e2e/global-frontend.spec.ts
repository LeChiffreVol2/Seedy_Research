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
  await expect(page.getByRole("heading", { name: /Explore .* Thai civil engineering papers/ })).toBeVisible();
  await expect(page.getByLabel("CivilMCP corpus coverage")).toContainText("sections");
  await expect(page.getByLabel("CivilMCP corpus coverage")).toContainText("Powered by GPT-5.6 Luna");
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

test("intermediate responsive widths stay collision-free", async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Explore .* Thai civil engineering papers/ })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoInteractiveOverlap(page);
  }
});

test("320px layout has no control collision and exposes all primary filters", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Collection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session actions" })).toBeVisible();

  for (const label of ["Hot", "Recent", "Evidence", "Saved"]) {
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
  await expect(page.getByRole("heading", { name: "Sign in with an email link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  await expect(page.getByText("฿199")).toBeVisible();

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send recovery link" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);

  await page.getByLabel("Account and chat history login").getByRole("button", { name: "Sign in", exact: true }).click();
  const password = page.locator("#civilmcp-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expectNoPageOverflow(page);
});

test("Terra and Sol lead free users to the Founder Pro decision point", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Model" }).click();
  const terra = page.getByRole("menuitemradio", { name: /GPT-5.6 Terra/ });
  const sol = page.getByRole("menuitemradio", { name: /GPT-5.6 Sol/ });
  await expect(terra).toContainText("PRO");
  await expect(sol).toContainText("PRO");
  await terra.click();
  await expect(page.getByRole("heading", { name: "Unlock Terra and Sol." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to upgrade" })).toBeVisible();
  await expect(page.getByText("Luna and exact-page evidence remain available")).toBeVisible();
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
  await expect(selectedOption).toContainText("GPT-5.6 Luna");
  await selectedOption.press("End");
  await expect(options.last()).toBeFocused();
  await options.last().press("Escape");
  await expect(page.getByRole("menu", { name: "Model" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("paper language mode translates globally, persists, and follows the paper drawer", async ({ page }) => {
  let translationRequests = 0;
  await page.addInitScript(() => window.localStorage.setItem("civilmcp-paper-language-v1", "en"));
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
  await expect.poll(() => translationRequests).toBeGreaterThan(0);
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

  const evidenceButtons = page.locator(".researchCard").getByRole("button", { name: /Evidence/ });
  await expect.poll(() => evidenceButtons.count()).toBeGreaterThan(0);
  await evidenceButtons.first().click();
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
