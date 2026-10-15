import { INGREDIENTS, SAMPLE_PROFILES } from "./recipes.js";
import { calculateShoppingList, generatePlan, normalizeScenario, summarizePlan, validateScenario, verifyPlan } from "./planner.js";
import { fetchLiveTasteSignals, sampleSignal } from "./qloo.js";

const STORE_KEY = "palateops.demo.v1";
const DEMO_INVENTORY = { rice: 18, chickpeas: 6, tomato: 5, chicken: 4, lentils: 4 };
const state = {
  mode: "sample",
  sampleProfile: "campus",
  baseline: null,
  tastePlan: null,
  signal: null,
  scenario: null,
  busy: false,
  shock: null,
};

const byId = (id) => document.getElementById(id);
const form = byId("scenarioForm");
const generateButton = byId("generateButton");
const loadingCard = byId("loadingCard");
const planEmpty = byId("planEmpty");

hydrateForm();
renderProfilePreview();
updateWeightLabels();
bindEvents();
renderSummary();

function bindEvents() {
  generateButton.addEventListener("click", generate);
  emptyGenerateButton.addEventListener("click", generate);
  form.addEventListener("input", () => {
    renderSummary();
    saveForm();
  });
  form.addEventListener("change", () => {
    renderSummary();
    saveForm();
  });
  byId("sampleModeButton").addEventListener("click", () => setMode("sample"));
  byId("liveModeButton").addEventListener("click", () => setMode("live"));
  byId("sampleProfile").addEventListener("change", () => {
    state.sampleProfile = byId("sampleProfile").value;
    renderProfilePreview();
    saveForm();
  });
  document.querySelectorAll(".weight-grid input").forEach((node) => {
    node.addEventListener("input", () => {
      updateWeightLabels();
      saveForm();
    });
  });
  byId("resetButton").addEventListener("click", resetDemo);
  byId("shockButton").addEventListener("click", simulateShock);
  byId("exportButton").addEventListener("click", exportShoppingList);
  byId("helpButton").addEventListener("click", () => byId("helpDialog").showModal());
  byId("venueNames").addEventListener("input", saveForm);
  byId("helpDialog").addEventListener("click", (event) => {
    if (event.target === byId("helpDialog")) byId("helpDialog").close();
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function setMode(mode) {
  state.mode = mode;
  const sample = mode === "sample";
  byId("sampleModeButton").classList.toggle("active", sample);
  byId("liveModeButton").classList.toggle("active", !sample);
  byId("sampleModeButton").setAttribute("aria-pressed", String(sample));
  byId("liveModeButton").setAttribute("aria-pressed", String(!sample));
  byId("sampleProfileFields").hidden = !sample;
  byId("liveProfileFields").hidden = sample;
  byId("modeStatus").classList.toggle("live", !sample);
  byId("modeStatus").innerHTML = '<span class="mode-dot"></span>' + (sample ? "Sample mode" : "Live Qloo mode");
  byId("sampleDisclaimer").hidden = !sample;
  byId("compareTitle").textContent = sample ? "Taste signal advantage" : "Qloo advantage";
  byId("signalPlanCaption").textContent = sample ? "Synthetic sample signal plan" : "Live Qloo tag signals";
  saveForm();
}

function readScenario() {
  const checkedEquipment = [...form.querySelectorAll('input[name="equipment"]:checked')].map((node) => node.value);
  const scenario = normalizeScenario({
    cafeteriaName: byId("cafeteriaName").value,
    attendance: byId("attendance").value,
    dailyBudget: byId("dailyBudget").value,
    vegetarianShare: Number(byId("vegetarianShare").value) / 100,
    allergenExclusions: byId("allergenExclusions").value,
    ingredientExclusions: byId("ingredientExclusions").value,
    equipment: checkedEquipment,
    cuisinePreferences: byId("cuisinePreferences").value ? [byId("cuisinePreferences").value] : [],
    inventory: parseInventory(byId("inventory").value),
    priceMultipliers: state.shock?.priceMultipliers || {},
  });
  return scenario;
}

function parseInventory(value) {
  const inventory = {};
  String(value || "").split(/[,\n]/).forEach((part) => {
    const match = part.trim().match(/^([a-zA-Z]+)\s*=\s*(\d+(?:\.\d+)?)$/);
    if (match && Object.prototype.hasOwnProperty.call(INGREDIENTS, match[1])) inventory[match[1]] = Number(match[2]);
  });
  return inventory;
}

async function generate() {
  if (state.busy) return;
  const scenario = readScenario();
  const errors = validateScenario(scenario);
  if (errors.length) {
    setPlanStatus("Needs attention", "error");
    toast(errors[0]);
    return;
  }
  state.busy = true;
  setButtonsDisabled(true);
  byId("menuGrid").hidden = true;
  byId("planFootnote").hidden = true;
  planEmpty.hidden = true;
  loadingCard.hidden = false;
  setPlanStatus("Planning…", "");
  setTrace([]);
  const trace = [];
  try {
    loadingText("Checking hard constraints…");
    trace.push({ title: "Validate service brief", detail: scenario.attendance + " expected covers · $" + money(scenario.dailyBudget) + " daily cap · dietary and equipment rules", icon: "✓" });
    setTrace(trace);
    await pause(260);

    loadingText(state.mode === "live" ? "Resolving dining interests with Qloo…" : "Loading the labeled sample profile…");
    let signal;
    if (state.mode === "live") {
      const venues = byId("venueNames").value.split(/[\n,]/).map((name) => name.trim()).filter(Boolean).slice(0, 3);
      signal = await fetchLiveTasteSignals(venues);
      trace.push({ title: "Retrieve live Qloo taste tags", detail: signal.provenance.entityIds.length + " restaurant entities resolved · " + signal.provenance.tagCount + " tag results · server-side key", icon: "◉" });
    } else {
      signal = sampleSignal(state.sampleProfile);
      trace.push({ title: "Load synthetic sample profile", detail: signal.cuisineSignals.join(" · ") + " · no Qloo request made", icon: "◉" });
    }
    setTrace(trace);
    await pause(220);

    loadingText("Finding recipes that fit the kitchen…");
    const weights = readWeights();
    const baseline = generatePlan(scenario, { weights });
    trace.push({ title: "Retrieve eligible recipes", detail: "30 original recipes checked against selected exclusions and available equipment", icon: "⌕" });
    setTrace(trace);
    await pause(220);

    loadingText("Optimizing servings and ingredient cost…");
    const tastePlan = generatePlan(scenario, { signal, weights });
    trace.push({ title: "Optimize two-option daily menus", detail: "Portions, full recipe costs, variety and signal coverage calculated deterministically", icon: "↗" });
    setTrace(trace);
    await pause(220);

    loadingText("Verifying constraints and totaling procurement…");
    const verified = tastePlan.status === "feasible" ? verifyPlan(tastePlan, scenario) : { valid: false, errors: tastePlan.errors || ["No feasible plan found."] };
    trace.push({ title: "Verify and prepare shopping list", detail: verified.valid ? "5 days · hard rules passed · ingredient quantities netted against stock" : verified.errors.join(" "), icon: verified.valid ? "✓" : "!" });
    setTrace(trace);
    await pause(150);

    if (baseline.status !== "feasible" || tastePlan.status !== "feasible" || !verified.valid) {
      const reason = [...(baseline.errors || []), ...(tastePlan.errors || []), ...verified.errors][0] || "No feasible five-day plan was found.";
      state.baseline = null;
      state.tastePlan = null;
      state.signal = signal;
      state.scenario = scenario;
      setPlanStatus("No feasible plan", "error");
      showInfeasible(reason);
      renderTrace(trace);
      return;
    }
    state.baseline = baseline;
    state.tastePlan = tastePlan;
    state.signal = signal;
    state.scenario = scenario;
    renderAll();
    setPlanStatus("5 days checked", "ready");
    if (state.mode === "live" && signal.cuisineSignals.length === 0) {
      toast("Qloo returned tags, but none mapped to the recipe catalog’s cuisine labels. The plan stays grounded in operational rules.");
    } else {
      toast("Five-day menu generated and checked against the hard constraints.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The planning request could not be completed.";
    state.baseline = null;
    state.tastePlan = null;
    state.signal = null;
    state.scenario = scenario;
    loadingCard.hidden = true;
    planEmpty.hidden = true;
    byId("menuGrid").hidden = true;
    setPlanStatus("Request needs attention", "error");
    setTrace(trace.concat([{ title: "Planning stopped safely", detail: message, icon: "!" }]));
    toast(message);
  } finally {
    state.busy = false;
    loadingCard.hidden = true;
    setButtonsDisabled(false);
  }
}

function renderAll() {
  renderSummary();
  renderMenu(state.tastePlan, state.scenario);
  renderComparison(state.baseline, state.tastePlan);
  renderShopping(state.tastePlan, state.scenario);
  byId("planEmpty").hidden = true;
  byId("menuGrid").hidden = false;
  byId("planFootnote").hidden = false;
  byId("exportButton").disabled = false;
  byId("shockButton").disabled = false;
  byId("planSubtitle").textContent = "Up to two options per day · " + state.tastePlan.totalServings.toLocaleString() + " planned servings · " + (state.mode === "live" ? "live Qloo tags and recipe rules" : "sample signals and recipe rules");
}

function renderMenu(plan, scenario) {
  if (!plan || plan.status !== "feasible") return;
  byId("menuGrid").innerHTML = plan.days.map((day) => {
    const pct = Math.min(100, Math.round((day.totalCost / scenario.dailyBudget) * 100));
    const fillClass = "budget-fill fill-" + Math.round(pct / 10) * 10 + (pct >= 90 ? " near" : "");
    return '<article class="day-card">' +
      '<div class="day-card-head"><strong>' + escapeHtml(day.day) + '</strong><span>' + day.totalServings.toLocaleString() + ' covers</span></div>' +
      day.items.map((item) => renderMeal(item)).join("") +
      '<div class="day-total"><span>Daily estimate</span><strong>' + money(day.totalCost) + '</strong></div>' +
      '<div class="budget-track" role="img" aria-label="' + pct + '% of daily budget used"><span class="' + fillClass + '"></span></div>' +
      '<div class="meal-servings"><span>' + pct + '% of budget</span><span>cap ' + money(scenario.dailyBudget) + '</span></div>' +
      '</article>';
  }).join("");
  byId("metricWeeklyCost").textContent = money(plan.totalCost);
  byId("metricCuisineCount").textContent = summarizePlan(plan).cuisineCount;
}

function renderMeal(item) {
  const allergy = item.allergens.length
    ? item.allergens.map((value) => '<span class="allergen-chip">' + escapeHtml(value) + '</span>').join("")
    : '<span class="allergen-chip">no listed allergens</span>';
  return '<div class="meal-item">' +
    '<div class="meal-title">' + escapeHtml(item.name) + '<span class="meal-cuisine">' + escapeHtml(item.cuisine) + '</span></div>' +
    '<p class="meal-description">' + escapeHtml(item.description) + '</p>' +
    '<div class="meal-meta"><span class="diet-chip' + (item.vegetarian ? "" : " meat") + '">' + (item.vegetarian ? "Vegetarian" : "Flexible") + '</span>' + allergy + '</div>' +
    '<div class="meal-servings"><span>Planned portions</span><strong>' + item.servings + '</strong></div>' +
    '<div class="meal-servings"><span>Recipe estimate</span><strong>' + money(item.cost) + '</strong></div>' +
    '</div>';
}

function renderComparison(baseline, tastePlan) {
  if (!baseline || !tastePlan || baseline.status !== "feasible" || tastePlan.status !== "feasible") return;
  const baselineSummary = summarizePlan(baseline);
  const signalSummary = summarizePlan(tastePlan);
  const baseRecipes = new Set(baseline.days.flatMap((day) => day.items.map((item) => item.recipeId)));
  const signalRecipes = new Set(tastePlan.days.flatMap((day) => day.items.map((item) => item.recipeId)));
  const changed = [...new Set([...baseRecipes, ...signalRecipes])].filter((id) => baseRecipes.has(id) !== signalRecipes.has(id)).length;
  const baselineCard = compareCard(baseline, baselineSummary, false);
  const signalCard = compareCard(tastePlan, signalSummary, true);
  const cards = byId("compareGrid").querySelectorAll(".compare-card");
  cards[0].innerHTML = baselineCard;
  cards[1].innerHTML = signalCard;
  byId("comparisonVerdict").innerHTML = '<span class="verdict-star">✦</span><span>' +
    (changed === 0
      ? 'The same recipe set wins under both runs. ' + (state.mode === "live" ? 'The returned Qloo tags did not change the selected meals under these hard constraints.' : 'The synthetic sample cues did not change the selected meals under these hard constraints.')
      : state.mode === "live"
        ? changed + ' recipe selections differ when Qloo tag mappings are included. ' + signalSummary.signalCovered + ' of 10 planned options map to cuisine labels found in returned Qloo tags. This is catalog tag coverage, not a claim about satisfaction.'
        : changed + ' recipe selections differ when synthetic sample cues are included. ' + signalSummary.signalCovered + ' of 10 planned options match the curated cuisine list. This is a demo comparison, not a Qloo result or satisfaction claim.') +
    (state.shock ? '<br><strong>Supply shock:</strong> covers ' + state.shock.beforeAttendance + ' → ' + state.shock.afterAttendance + '; chicken price +20%; taste-plan estimate ' + money(state.shock.beforeCost) + ' → ' + money(tastePlan.totalCost) + '.' : '') +
    '</span>';
}

function compareCard(plan, summary, isSignal) {
  const totalOptions = plan.days.reduce((count, day) => count + day.items.length, 0);
  const cuisineLabel = summary.cuisineCount + " cuisines";
  const signalLabel = isSignal ? summary.signalCovered + " / " + totalOptions : "not used";
  const recipes = [...new Set(plan.days.flatMap((day) => day.items.map((item) => item.name)))].slice(0, 5);
  return '<div class="compare-card-top"><span class="compare-index">' + (isSignal ? "B" : "A") + '</span><div><strong>' + (isSignal ? "Taste signals included" : "Constraints only") + '</strong><small>' + (isSignal ? escapeHtml(state.signal?.sourceLabel || "Taste signal") : "Operational baseline") + '</small></div><span class="compare-badge' + (isSignal ? " accent-badge" : "") + '">' + (isSignal ? "WITH SIGNALS" : "BASELINE") + '</span></div>' +
    '<div class="compare-stats">' +
    stat("Week estimate", money(plan.totalCost)) +
    stat("Menu variety", cuisineLabel) +
    stat(isSignal ? "Signal coverage" : "Taste data", signalLabel) +
    '</div><div class="compare-recipes">' + recipes.map((name) => '<span class="compare-recipe">' + escapeHtml(name) + '</span>').join("") + '</div>';
}

function stat(label, value) {
  return '<div class="compare-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
}

function renderShopping(plan, scenario) {
  const list = calculateShoppingList(plan, scenario);
  byId("shoppingList").innerHTML = list.length
    ? list.slice(0, 15).map((line) => '<label class="shopping-line">' +
      '<input type="checkbox" class="shopping-check" aria-label="Mark ' + escapeHtml(line.name) + ' as purchased" />' +
      '<span class="shopping-name">' + escapeHtml(line.name) + '</span>' +
      '<span class="shopping-amount">' + line.buy + ' ' + escapeHtml(line.unit) + '</span>' +
      '<strong>' + money(line.estimatedCost) + '</strong></label>').join("")
    : '<div class="muted-empty">Everything in this menu is covered by the entered on-hand quantities.</div>';
  byId("shoppingTotal").textContent = money(list.reduce((sum, line) => sum + line.estimatedCost, 0));
  byId("shoppingList").dataset.lines = JSON.stringify(list);
}

function renderTrace(rows) {
  byId("traceCount").textContent = rows.length + (rows.length === 1 ? " step" : " steps");
  byId("traceList").innerHTML = rows.length
    ? rows.map((item) => '<div class="trace-row"><span class="trace-step">' + escapeHtml(item.icon) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.detail) + '</small></div></div>').join("")
    : '<div class="muted-empty">The tool trace appears when a plan runs.</div>';
}

function setTrace(rows) {
  byId("traceCount").textContent = rows.length + (rows.length === 1 ? " step" : " steps");
  byId("traceList").innerHTML = rows.map((item) => '<div class="trace-row"><span class="trace-step">' + escapeHtml(item.icon) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.detail) + '</small></div></div>').join("");
}

function renderProfilePreview() {
  const profile = SAMPLE_PROFILES[state.sampleProfile] || SAMPLE_PROFILES.campus;
  byId("sampleProfilePreview").innerHTML = profile.cuisineSignals.map((cuisine) => '<span class="signal-chip">' + escapeHtml(cuisine) + '</span>').join("");
  const old = byId("sampleProfilePreview").nextElementSibling?.classList.contains("profile-venues")
    ? byId("sampleProfilePreview").nextElementSibling
    : null;
  if (old) old.remove();
  byId("sampleProfilePreview").insertAdjacentHTML("afterend", '<p class="profile-venues">Synthetic signals inspired by: ' + escapeHtml(profile.venues.join(", ")) + '.</p>');
}

function renderSummary() {
  const scenario = readScenario();
  byId("metricAttendance").textContent = Number.isFinite(scenario.attendance) ? scenario.attendance.toLocaleString() : "—";
  byId("metricBudget").textContent = Number.isFinite(scenario.dailyBudget) ? money(scenario.dailyBudget) : "—";
  if (!state.tastePlan) {
    byId("metricCuisineCount").textContent = "—";
    byId("metricWeeklyCost").textContent = "—";
  }
}

function showInfeasible(reason) {
  loadingCard.hidden = true;
  planEmpty.hidden = false;
  byId("planEmpty").innerHTML = '<div class="empty-illustration"><span>!</span><span>▤</span><span>×</span></div>' +
    '<strong>No feasible menu under these constraints.</strong>' +
    '<p>' + escapeHtml(reason) + ' Adjust the budget, exclusions or equipment list, then try again. Safety-related restrictions are never relaxed automatically.</p>' +
    '<button class="button button-primary" id="emptyGenerateButton">Try again <span>→</span></button>';
  byId("emptyGenerateButton").addEventListener("click", generate);
}

function simulateShock() {
  if (!state.tastePlan || !state.scenario || state.busy) return;
  const beforeAttendance = state.scenario.attendance;
  const beforeCost = state.tastePlan.totalCost;
  const attendance = Math.ceil(beforeAttendance * 1.25);
  const priceMultipliers = { ...state.scenario.priceMultipliers, chicken: (Number(state.scenario.priceMultipliers.chicken) || 1) * 1.2 };
  state.shock = { beforeAttendance, afterAttendance: attendance, beforeCost };
  byId("attendance").value = attendance;
  const scenario = normalizeScenario({ ...state.scenario, attendance, priceMultipliers });
  state.scenario = scenario;
  renderSummary();
  setTrace([{ title: "Apply simulated supply shock", detail: "Attendance " + beforeAttendance + " → " + attendance + " · chicken ingredient price +20%", icon: "ϟ" }]);
  generateWithExistingSignal(scenario);
}

async function generateWithExistingSignal(scenario) {
  state.busy = true;
  setButtonsDisabled(true);
  loadingCard.hidden = false;
  planEmpty.hidden = true;
  byId("menuGrid").hidden = true;
  loadingText("Replanning around the new service load…");
  try {
    await pause(220);
    const weights = readWeights();
    const baseline = generatePlan(scenario, { weights });
    const tastePlan = generatePlan(scenario, { signal: state.signal, weights });
    const validation = tastePlan.status === "feasible" ? verifyPlan(tastePlan, scenario) : { valid: false, errors: tastePlan.errors || [] };
    if (baseline.status !== "feasible" || tastePlan.status !== "feasible" || !validation.valid) {
      state.baseline = null;
      state.tastePlan = null;
      setPlanStatus("Shock is infeasible", "error");
      showInfeasible(validation.errors[0] || baseline.errors?.[0] || "The increased attendance cannot be served under the current budget and restrictions.");
      setTrace([{ title: "Replanning stopped safely", detail: validation.errors[0] || baseline.errors?.[0] || "No feasible plan was found.", icon: "!" }]);
      return;
    }
    state.baseline = baseline;
    state.tastePlan = tastePlan;
    state.scenario = scenario;
    renderAll();
    setPlanStatus("Replanned after supply shock", "ready");
    toast("Plan rebuilt for " + attendance.toLocaleString() + " covers with a 20% chicken price increase.");
  } finally {
    state.busy = false;
    loadingCard.hidden = true;
    setButtonsDisabled(false);
  }
}

function exportShoppingList() {
  if (!state.tastePlan || !state.scenario) return;
  const list = calculateShoppingList(state.tastePlan, state.scenario);
  const rows = [["Ingredient", "Buy quantity", "Unit", "Estimated cost"]];
  for (const line of list) rows.push([line.name, line.buy, line.unit, line.estimatedCost.toFixed(2)]);
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "palateops-shopping-list.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("Shopping list exported as CSV.");
}

function csvCell(value) {
  let safe = String(value);
  if (/^[\s]*[=+\-@]/.test(safe)) safe = "'" + safe;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function resetDemo() {
  localStorage.removeItem(STORE_KEY);
  state.mode = "sample";
  state.sampleProfile = "campus";
  state.baseline = null;
  state.tastePlan = null;
  state.signal = null;
  state.scenario = null;
  state.shock = null;
  setMode("sample");
  byId("sampleProfile").value = "campus";
  byId("cafeteriaName").value = "Campus Commons Cafeteria";
  byId("attendance").value = 150;
  byId("dailyBudget").value = 600;
  byId("vegetarianShare").value = 35;
  byId("allergenExclusions").value = "peanut";
  byId("ingredientExclusions").value = "";
  byId("inventory").value = "rice=18, chickpeas=6, tomato=5, chicken=4, lentils=4";
  byId("cuisinePreferences").value = "";
  byId("weightTaste").value = 40;
  byId("weightExplicit").value = 28;
  byId("weightCost").value = 20;
  byId("weightPrep").value = 12;
  byId("venueNames").value = "";
  form.querySelectorAll('input[name="equipment"]').forEach((node) => { node.checked = true; });
  byId("menuGrid").hidden = true;
  byId("planFootnote").hidden = true;
  planEmpty.hidden = false;
  byId("planEmpty").innerHTML = '<div class="empty-illustration"><span>◉</span><span>✦</span><span>▤</span></div><strong>The kitchen is ready for a plan.</strong><p>We’ll check constraints, select a five-day menu, verify servings and cost, then make a shopping list.</p><button class="button button-primary" id="emptyGenerateButton">Generate my weekly menu <span>→</span></button>';
  byId("emptyGenerateButton").addEventListener("click", generate);
  byId("shoppingList").innerHTML = '<div class="muted-empty">Your consolidated list will appear after planning.</div>';
  byId("shoppingTotal").textContent = "—";
  byId("comparisonVerdict").innerHTML = '<span class="verdict-star">✦</span><span>What changed because the signal was included will appear here. If nothing changes, PalateOps will say so.</span>';
  byId("compareGrid").innerHTML = '<article class="compare-card"><div class="compare-card-top"><span class="compare-index">A</span><div><strong>Constraints only</strong><small>Operational baseline</small></div><span class="compare-badge">BASELINE</span></div><div class="compare-placeholder">Generate the week to compare plans.</div></article><article class="compare-card accent-card"><div class="compare-card-top"><span class="compare-index">B</span><div><strong>Taste signals included</strong><small>Synthetic sample signal plan</small></div><span class="compare-badge accent-badge">WITH SIGNALS</span></div><div class="compare-placeholder">Generate the week to compare plans.</div></article>';
  byId("planSubtitle").textContent = "Generate a plan to compare operational fit with taste signals.";
  setPlanStatus("Waiting for a plan", "");
  setTrace([]);
  byId("exportButton").disabled = true;
  byId("shockButton").disabled = true;
  renderProfilePreview();
  updateWeightLabels();
  renderSummary();
  saveForm();
}

function hydrateForm() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch {}
  if (saved) {
    byId("cafeteriaName").value = saved.cafeteriaName || "Campus Commons Cafeteria";
    byId("attendance").value = saved.attendance ?? 150;
    byId("dailyBudget").value = saved.dailyBudget ?? 600;
    byId("vegetarianShare").value = saved.vegetarianShare ?? 35;
    byId("allergenExclusions").value = saved.allergenExclusions || "peanut";
    byId("ingredientExclusions").value = saved.ingredientExclusions || "";
    byId("inventory").value = saved.inventoryText || "";
    byId("cuisinePreferences").value = saved.cuisinePreference || "";
    byId("venueNames").value = saved.venueNames || "";
    state.mode = saved.mode === "live" ? "live" : "sample";
    state.sampleProfile = SAMPLE_PROFILES[saved.sampleProfile] ? saved.sampleProfile : "campus";
    byId("sampleProfile").value = state.sampleProfile;
    if (Array.isArray(saved.equipment)) {
      form.querySelectorAll('input[name="equipment"]').forEach((node) => { node.checked = saved.equipment.includes(node.value); });
    }
    const weights = saved.weights || {};
    byId("weightTaste").value = weights.tasteSignal ?? 40;
    byId("weightExplicit").value = weights.explicitPreference ?? 28;
    byId("weightCost").value = weights.affordability ?? 20;
    byId("weightPrep").value = weights.preparation ?? 12;
    setMode(state.mode);
  }
}

function saveForm() {
  const equipment = [...form.querySelectorAll('input[name="equipment"]:checked')].map((node) => node.value);
  const saved = {
    cafeteriaName: byId("cafeteriaName").value,
    attendance: byId("attendance").value,
    dailyBudget: byId("dailyBudget").value,
    vegetarianShare: byId("vegetarianShare").value,
    allergenExclusions: byId("allergenExclusions").value,
    ingredientExclusions: byId("ingredientExclusions").value,
    inventoryText: byId("inventory").value,
    cuisinePreference: byId("cuisinePreferences").value,
    venueNames: byId("venueNames").value,
    equipment,
    mode: state.mode,
    sampleProfile: state.sampleProfile,
    weights: readWeights(),
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch {}
}

function setButtonsDisabled(disabled) {
  generateButton.disabled = disabled;
  const currentEmptyButton = byId("emptyGenerateButton");
  if (currentEmptyButton) currentEmptyButton.disabled = disabled;
  byId("shockButton").disabled = disabled || !state.tastePlan;
}

function readWeights() {
  return {
    tasteSignal: Number(byId("weightTaste").value),
    explicitPreference: Number(byId("weightExplicit").value),
    affordability: Number(byId("weightCost").value),
    preparation: Number(byId("weightPrep").value),
  };
}

function updateWeightLabels() {
  const values = readWeights();
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const defaults = { tasteSignal: 40, explicitPreference: 28, affordability: 20, preparation: 12 };
  const source = total === 0 ? defaults : values;
  const denominator = total === 0 ? 100 : total;
  byId("weightTasteValue").textContent = Math.round(source.tasteSignal / denominator * 100) + "%";
  byId("weightExplicitValue").textContent = Math.round(source.explicitPreference / denominator * 100) + "%";
  byId("weightCostValue").textContent = Math.round(source.affordability / denominator * 100) + "%";
  byId("weightPrepValue").textContent = Math.round(source.preparation / denominator * 100) + "%";
  byId("weightSummary").textContent = "Signal " + Math.round(source.tasteSignal / denominator * 100) +
    " · focus " + Math.round(source.explicitPreference / denominator * 100) +
    " · cost " + Math.round(source.affordability / denominator * 100) +
    " · prep " + Math.round(source.preparation / denominator * 100);
}

function setPlanStatus(label, variant) {
  byId("planStatus").className = "plan-status" + (variant ? " " + variant : "");
  byId("planStatus").innerHTML = '<span class="status-dot"></span>' + escapeHtml(label);
}

function loadingText(message) {
  byId("loadingText").textContent = message;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  byId("toastRegion").append(node);
  setTimeout(() => node.remove(), 4500);
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
