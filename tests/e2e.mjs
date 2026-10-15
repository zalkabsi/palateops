import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const port = 4178;
const origin = "http://127.0.0.1:" + port;
const preview = spawn(process.execPath, ["scripts/preview.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
let browser;

try {
  await waitForPreview();
  const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);
  browser = await chromium.launch({
    headless: true,
    ...(localChromium ? { executablePath: localChromium } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1160 }, acceptDownloads: true });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.clear());

  await page.goto(origin, { waitUntil: "networkidle" });
  assert.match(await page.title(), /PalateOps/);
  await page.locator("#generateButton").click();
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".day-card").count(), 5);
  assert.equal(await page.locator(".day-card .meal-item").count(), 10);
  assert.equal(await page.locator("#sampleDisclaimer").isVisible(), true);
  const weekdays = await page.locator(".day-card").count();
  const menuOptions = await page.locator(".day-card .meal-item").count();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".day-card").first().isVisible(), true);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(horizontalOverflow, false, "mobile layout should not overflow horizontally");
  await page.setViewportSize({ width: 1440, height: 1160 });

  const screenshotPath = resolve("docs/screenshots/palateops-demo.png");
  await mkdir(resolve("docs/screenshots"), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.locator("#liveModeButton").click();
  assert.equal(await page.locator("#planEmpty").isVisible(), true);
  assert.equal(await page.locator("#exportButton").isDisabled(), true);
  await page.locator("#sampleModeButton").click();
  await page.locator("#generateButton").click();
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });

  await page.locator("#shockButton").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".day-card-head span")].length === 5 &&
    [...document.querySelectorAll(".day-card-head span")].every((node) => node.textContent.includes("188 covers")),
  null, { timeout: 10000 });
  assert.match(await page.locator("#comparisonVerdict").innerText(), /Supply shock/);
  assert.match(await page.locator(".toast").last().innerText(), /188 covers/);
  const shockAttendance = await page.locator("#metricAttendance").innerText();
  const shockPlanCost = await page.locator("#compareGrid .compare-card").nth(1).locator(".compare-stat").first().locator("strong").innerText();
  await page.locator("#generateButton").click();
  assert.equal(await page.locator("#attendance").isDisabled(), true);
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#attendance").isDisabled(), false);
  assert.equal(await page.locator("#compareGrid .compare-card").nth(1).locator(".compare-stat").first().locator("strong").innerText(), shockPlanCost);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportButton").click(),
  ]);
  assert.equal(download.suggestedFilename(), "palateops-shopping-list.csv");

  await page.locator("#vegetarianShare").evaluate((node) => {
    node.value = "100";
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.locator("#planEmpty").isVisible(), true);
  assert.equal(await page.locator("#menuGrid").isHidden(), true);
  assert.equal(await page.locator("#exportButton").isDisabled(), true);
  await page.locator("#generateButton").click();
  assert.equal(await page.locator("#attendance").isDisabled(), true);
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".day-card .meal-item").count(), 5);
  assert.match(await page.locator("#comparisonVerdict").innerText(), /of 5 planned options/);
  assert.match(await page.locator("#traceList").innerText(), /32 original recipes checked/);

  await page.locator("#attendance").fill("1");
  await page.locator("#vegetarianShare").evaluate((node) => {
    node.value = "35";
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#generateButton").click();
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".day-card .meal-item").count(), 5);
  assert.ok(await page.locator(".day-card .meal-item").evaluateAll((items) => items.every((item) => item.innerText.includes("Planned portions\n1"))));

  await page.locator("#attendance").fill("5000");
  await page.locator("#dailyBudget").fill("1");
  await page.locator("#generateButton").click();
  await page.locator("#planEmpty:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#menuGrid").isHidden(), true);
  assert.equal(await page.locator("#exportButton").isDisabled(), true);
  assert.match(await page.locator("#shoppingList").innerText(), /will appear after planning/);
  assert.match(await page.locator(".compare-placeholder").first().innerText(), /Generate the week/);

  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "passed",
    weekdays,
    menuOptions,
    shockAttendance,
    csv: download.suggestedFilename(),
    horizontalOverflow,
    screenshot: "docs/screenshots/palateops-demo.png",
  }));
} finally {
  if (browser) await browser.close();
  preview.kill("SIGTERM");
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    if (preview.exitCode !== null) throw new Error("Preview server exited before it became ready.");
    await wait(100);
  }
  throw new Error("Preview server did not become ready on " + origin);
}
