from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import tempfile
import textwrap
from pathlib import Path

from common import ROOT, Check, make_report, print_report, write_report
from run_ops_api_contracts import load_ops_env


DEFAULT_BASE_URL = "http://localhost:3001"


def browser_script() -> str:
    return textwrap.dedent(
        r"""
        import { chromium } from "playwright";

        const baseUrl = process.env.OPS_E2E_BASE_URL || process.env.OPS_DASHBOARD_URL || "http://localhost:3001";
        const authUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER || process.env.OPS_API_BASIC_AUTH_USER || process.env.OPS_BASIC_AUTH_USER;
        const authPass = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD || process.env.OPS_API_BASIC_AUTH_PASSWORD || process.env.OPS_BASIC_AUTH_PASSWORD;
        const headers = {};
        if (authUser && authPass) {
          headers.Authorization = `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`;
        }

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          extraHTTPHeaders: headers,
        });
        const page = await context.newPage();
        const checks = [];

        async function check(name, fn) {
          try {
            const result = await fn();
            checks.push({ name, status: result === false ? "fail" : "pass", details: result === false ? "Check returned false." : "ok" });
          } catch (error) {
            checks.push({ name, status: "fail", details: String(error?.message || error).slice(0, 500) });
          }
        }

        await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
        await check("dashboard_identity", async () => {
          const title = await page.title();
          const body = await page.locator("body").innerText({ timeout: 10000 });
          return /Thailand Transport Safety Ops|CityMCP|CivilMCP/i.test(`${title}\n${body}`);
        });
        await check("no_horizontal_overflow_1280", async () => {
          return await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        });
        await check("map_canvas_present", async () => await page.locator(".mapCanvas").count() > 0);
        await check("source_dock_tab_clickable", async () => {
          const tab = page.getByRole("button", { name: /sources/i }).first();
          await tab.click({ timeout: 10000 });
          return /Source status/i.test(await page.locator("body").innerText());
        });
        await check("analyst_tab_clickable", async () => {
          const tab = page.getByRole("button", { name: /CivilMCP analyst/i }).first();
          await tab.click({ timeout: 10000 });
          return /CivilMCP Analyst/i.test(await page.locator("body").innerText());
        });
        await check("alerts_drawer_clickable", async () => {
          await page.getByRole("button", { name: /Notifications/i }).first().click({ timeout: 10000 });
          return /Alerts|Live alerts|SLA|incident/i.test(await page.locator("body").innerText());
        });
        await check("escape_closes_overlay", async () => {
          await page.keyboard.press("Escape");
          return await page.locator(".utilityDrawer").count() === 0;
        });

        await browser.close();
        console.log(JSON.stringify({ checks }));
        """
    ).strip()


def run_browser(base_url: str, env: dict[str, str], strict: bool) -> list[Check]:
    with tempfile.TemporaryDirectory(prefix="citymcp-browser-e2e-") as temp_dir:
        local_dir = ROOT / "ops-dashboard" / ".local"
        local_dir.mkdir(exist_ok=True)
        script_path = local_dir / "ops-browser-e2e.mjs"
        script_path.write_text(browser_script(), encoding="utf-8")
        runtime_env = dict(env)
        runtime_env["OPS_E2E_BASE_URL"] = base_url
        result = subprocess.run(
            ["node", str(script_path)],
            cwd=str(ROOT / "ops-dashboard"),
            env=runtime_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=120,
            check=False,
        )
        try:
            script_path.unlink()
        except OSError:
            pass
    output = (result.stdout or "").strip()
    if result.returncode != 0 and ("Cannot find package 'playwright'" in output or "Cannot find module 'playwright'" in output):
        return [
            Check(
                "ops_browser_playwright_available",
                "fail" if strict else "warn",
                "Playwright runtime is not installed for browser E2E.",
                "Install @playwright/test or playwright in ops-dashboard and run playwright install chromium before strict browser E2E.",
            )
        ]
    if result.returncode != 0:
        return [Check("ops_browser_e2e_runner", "fail", output[-3000:], "Inspect browser E2E output and fix the failing dashboard flow.")]

    try:
        payload = json.loads(output.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return [Check("ops_browser_e2e_parse", "fail", output[-3000:], "Browser E2E did not emit JSON checks.")]

    checks: list[Check] = []
    for item in payload.get("checks", []):
        checks.append(
            Check(
                item.get("name", "unnamed_browser_check"),
                item.get("status", "fail"),
                item.get("details", ""),
                "Fix the browser-visible interaction or layout regression." if item.get("status") != "pass" else "",
            )
        )
    return checks or [Check("ops_browser_e2e_empty", "fail", "No browser checks were emitted.", "Restore browser E2E check list.")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run isolated browser E2E checks for ops-dashboard.")
    parser.add_argument("--base-url", help="Ops dashboard base URL. Defaults to OPS_E2E_BASE_URL, OPS_DASHBOARD_URL, or localhost:3000.")
    parser.add_argument("--strict", action="store_true", help="Fail instead of warn when browser runtime is unavailable.")
    parser.add_argument("--json-only", action="store_true", help="Print JSON report without writing harness/reports files.")
    args = parser.parse_args()

    env = load_ops_env()
    base_url = (args.base_url or env.get("OPS_E2E_BASE_URL") or env.get("OPS_DASHBOARD_URL") or DEFAULT_BASE_URL).rstrip("/")
    checks = run_browser(base_url, env, args.strict)
    report = make_report("ops_browser_e2e", checks, metrics={"baseUrl": base_url, "strict": args.strict})

    if args.json_only:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        path = write_report("ops_browser_e2e", report)
        print_report(report, path)

    if report["status"] == "fail":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
