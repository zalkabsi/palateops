import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { runPlanningAgent } from "../qloo-backend/agent.mjs";
import { AGENT_ENV, scriptedModel } from "./helpers/agent-fixture.js";

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1160 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.clear());

  await page.goto(origin, { waitUntil: "networkidle" });
  assert.match(await page.title(), /PalateOps/);
  await page.locator("#generateButton").click();
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".day-card").count(), 5);
  assert.equal(await page.locator(".day-card .meal-item").count(), 10);
  assert.equal(await page.locator("#dashboard:not([hidden])").count(), 1);
  assert.equal(await page.locator("#dailySpendChart .progress-row").count(), 5);
  assert.ok(await page.locator("#cuisineMixChart .progress-row").count() > 0);
  assert.ok(await page.locator("#purchaseCostChart .progress-row").count() > 0);
  assert.equal(await page.locator("#planHistory option").count(), 1);
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
  assert.equal(await page.locator("#planHistory option").count(), 3);
  assert.match(await page.locator("#comparisonVerdict").innerText(), /Supply shock/);
  assert.match(await page.locator(".toast").last().innerText(), /188 covers/);
  assert.match(await page.locator("#traceList").innerText(), /Re-optimize/);
  await page.locator("#planHistory").selectOption({ index: 1 });
  await page.locator("#restoreHistoryButton").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".day-card-head span")].every((node) => node.textContent.includes("150 covers")), null, { timeout: 10000 });
  await page.locator("#planHistory").selectOption({ index: 0 });
  await page.locator("#restoreHistoryButton").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".day-card-head span")].every((node) => node.textContent.includes("188 covers")), null, { timeout: 10000 });
  await page.locator("#undoShockButton").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".day-card-head span")].every((node) => node.textContent.includes("150 covers")), null, { timeout: 10000 });
  await page.locator("#shockButton").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".day-card-head span")].every((node) => node.textContent.includes("188 covers")), null, { timeout: 10000 });
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
  assert.equal(download.suggestedFilename(), "palateops-weekly-plan.csv");
  const csvText = await readFile(await download.path(), "utf8");
  assert.match(csvText, /Weekly menu/);
  assert.match(csvText, /Shopping list/);
  assert.match(csvText, /Weekly recipe ingredient estimate/);

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

  // Exercise the actual agent loop through a scripted Responses protocol fixture.
  // This is UI integration coverage, not evidence of a live model call.
  let agentRequests = 0;
  let tamperAgentPlan = false;
  await page.route(origin + "/api/health", (route) => route.fulfill({ json: { agentConfigured: true } }));
  await page.route(origin + "/api/agent/plan", async (route) => {
    agentRequests += 1;
    const result = await runPlanningAgent(route.request().postDataJSON(), { env: AGENT_ENV, modelFetch: scriptedModel() });
    if (tamperAgentPlan) result.tastePlan.days[0].totalCost += 100;
    await route.fulfill({ json: result });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.getElementById("agentMethodOption").disabled);
  await page.locator("#planningMethod").selectOption("agent");
  await page.locator("#generateButton").click();
  await page.locator("#menuGrid:not([hidden])").waitFor({ timeout: 10000 });
  assert.match(await page.locator("#planStatus").innerText(), /AI plan verified/);
  assert.match(await page.locator("#agentSummary").innerText(), /Fixture model/);
  assert.match(await page.locator("#traceList").innerText(), /Agent verified taste plan/);
  assert.match(await page.locator("#traceList").innerText(), /Agent built procurement list/);
  await page.locator("#shockButton").click();
  await page.waitForFunction(() => document.getElementById("planStatus").textContent.includes("AI replan verified"));
  assert.equal(await page.locator("#metricAttendance").innerText(), "188");
  await page.locator("#undoShockButton").click();
  assert.equal(await page.locator("#metricAttendance").innerText(), "150");
  assert.equal(await page.locator("#planningMethod").inputValue(), "agent");
  assert.match(await page.locator("#agentSummary").innerText(), /Fixture model/);
  tamperAgentPlan = true;
  await page.locator("#generateButton").click();
  await page.locator("#planEmpty:not([hidden])").waitFor({ timeout: 10000 });
  assert.match(await page.locator("#planEmpty").innerText(), /independent constraint check/);
  assert.equal(await page.locator("#exportButton").isDisabled(), true);
  assert.equal(agentRequests, 3);
  assert.deepEqual(pageErrors, []);
  await page.locator("details").filter({ has: page.locator("#allergenExclusions") }).locator("summary").click();
  await page.locator("#allergenExclusions").fill("");
  const persistencePage = await page.context().newPage();
  await persistencePage.route(origin + "/api/health", (route) => route.fulfill({ json: { agentConfigured: true } }));
  await persistencePage.goto(origin, { waitUntil: "networkidle" });
  await persistencePage.waitForFunction(() => document.getElementById("planningMethod").value === "agent");
  assert.equal(await persistencePage.locator("#allergenExclusions").inputValue(), "");
  await persistencePage.reload({ waitUntil: "networkidle" });
  await persistencePage.waitForFunction(() => document.getElementById("planningMethod").value === "agent");
  assert.equal(await persistencePage.locator("#allergenExclusions").inputValue(), "");
  await persistencePage.close();

  console.log(JSON.stringify({
    status: "passed",
    weekdays,
    menuOptions,
    shockAttendance,
    csv: download.suggestedFilename(),
    horizontalOverflow,
    agentFixtureRequests: agentRequests,
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
