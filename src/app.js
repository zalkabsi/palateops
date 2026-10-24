import { INGREDIENTS, RECIPES, SAMPLE_PROFILES } from "./recipes.js";
import { calculateShoppingList, generatePlan, normalizeScenario, summarizePlan, validateScenario, verifyPlan } from "./planner.js";
import { fetchLiveTasteSignals, resolveLiveTasteEntities, sampleSignal } from "./qloo.js";
import { requestAgentPlan } from "./agent.js";

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
  history: [],
  currentHistoryId: null,
  trace: [],
  entities: [],
  agentSummary: "",
  agentAvailable: false,
  preferredMethod: "rules",
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
renderHistoryControls();
loadAgentAvailability();

function bindEvents() {
  generateButton.addEventListener("click", generate);
  byId("emptyGenerateButton").addEventListener("click", generate);
  form.addEventListener("input", () => {
    markPlanOutdated();
    renderSummary();
    saveForm();
  });
  form.addEventListener("change", () => {
    markPlanOutdated();
    renderSummary();
    saveForm();
  });
  byId("sampleModeButton").addEventListener("click", () => setMode("sample"));
  byId("liveModeButton").addEventListener("click", () => setMode("live"));
  byId("sampleProfile").addEventListener("change", () => {
    state.sampleProfile = byId("sampleProfile").value;
    renderProfilePreview();
    markPlanOutdated();
    saveForm();
  });
  byId("planningMethod").addEventListener("change", () => {
    markPlanOutdated();
    saveForm();
  });
  document.querySelectorAll(".weight-grid input").forEach((node) => {
    node.addEventListener("input", () => {
      markPlanOutdated();
      updateWeightLabels();
      saveForm();
    });
  });
  byId("resetButton").addEventListener("click", resetDemo);
  byId("shockButton").addEventListener("click", simulateShock);
  byId("restoreHistoryButton").addEventListener("click", restoreSelectedHistory);
  byId("undoShockButton").addEventListener("click", undoSupplyShock);
  byId("exportButton").addEventListener("click", exportWeeklyPlan);
  byId("helpButton").addEventListener("click", () => byId("helpDialog").showModal());
  byId("venueNames").addEventListener("input", () => {
    markPlanOutdated();
    saveForm();
  });
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

async function loadAgentAvailability() {
  try {
    const response = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
    state.agentAvailable = response.ok && (await response.json()).agentConfigured === true;
  } catch { state.agentAvailable = false; }
  byId("agentMethodOption").disabled = !state.agentAvailable;
  byId("planningMethodHelp").textContent = state.agentAvailable
    ? "Shares the kitchen brief with the AI service. Every menu still passes independent rule checks."
    : "Rules planning is ready. The AI agent is unavailable in this deployment.";
  if (state.agentAvailable && state.preferredMethod === "agent" && !state.busy && !state.tastePlan) {
    byId("planningMethod").value = "agent";
    saveForm();
  }
}

function setMode(mode) {
  const changed = state.mode !== mode;
  state.mode = mode;
  renderMode();
  if (changed) markPlanOutdated();
  saveForm();
}

function renderMode() {
  const sample = state.mode === "sample";
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
  const signalPlanCaption = byId("signalPlanCaption");
  if (signalPlanCaption) signalPlanCaption.textContent = sample ? "Synthetic sample signal plan" : "Live Qloo tag signals";
}

function readScenario() {
  const checkedEquipment = [...form.querySelectorAll('input[name="equipment"]:checked')].map((node) => node.value);
  const scenario = normalizeScenario({
    cafeteriaName: byId("cafeteriaName").value,
    attendance: byId("attendance").value,
    kitchenCapacity: byId("kitchenCapacity").value,
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
    state.baseline = null;
    state.tastePlan = null;
    state.signal = null;
    state.scenario = scenario;
    state.currentHistoryId = null;
    clearPlanPanels();
    setPlanStatus("Needs attention", "error");
    showPlanMessage("Check the planning inputs", errors[0], "Adjust the fields, then try again.");
    toast(errors[0]);
    return;
  }
  state.baseline = null;
  state.tastePlan = null;
  state.signal = null;
  state.scenario = scenario;
  state.currentHistoryId = null;
  state.agentSummary = "";
  state.entities = [];
  clearPlanPanels();
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
    const useAgent = byId("planningMethod").value === "agent";
    if (useAgent && !state.agentAvailable) throw new Error("The AI planner is unavailable. Choose the rules planner.");
    loadingText("Checking hard constraints…");
    trace.push({ title: "Validate service brief", detail: scenario.attendance + " expected covers · " + money(scenario.dailyBudget) + " daily cap · dietary and equipment rules", icon: "✓" });
    setTrace(trace);
    await pause(260);

    loadingText(state.mode === "live" ? "Resolving dining interests with Qloo…" : "Loading the labeled sample profile…");
    let signal;
    if (state.mode === "live") {
      const venues = byId("venueNames").value.split(/[\n,]/).map((name) => name.trim()).filter(Boolean);
      const resolvedEntities = await resolveLiveTasteEntities(venues);
      trace.push({ title: "Resolve dining interests", detail: resolvedEntities.map((entity) => entity.requestedName + " → " + entity.name).join(" · "), icon: "◉" });
      setTrace(trace);
      if (!confirmResolvedEntities(resolvedEntities)) {
        throw new Error("No Qloo insights were requested. Edit the restaurant names or stay in Sample mode.");
      }
      state.entities = resolvedEntities;
      if (!useAgent) {
        loadingText("Retrieving taste signals with the Qloo Harness…");
        signal = await fetchLiveTasteSignals(resolvedEntities);
        trace.push({ title: "Retrieve Qloo restaurant insights", detail: signal.provenance.recommendationCount + " recommended places · " + signal.provenance.tagCount + " unique returned tags · Qloo Harness backend", icon: "◉" });
      }
    } else if (!useAgent) {
      signal = sampleSignal(state.sampleProfile);
      trace.push({ title: "Load synthetic sample profile", detail: signal.cuisineSignals.join(" · ") + " · no Qloo request made", icon: "◉" });
    }
    if (useAgent) {
      loadingText("The AI agent is selecting and checking planning tools…");
      installAgentResult(await requestAgentPlan(agentInput(scenario)), scenario, trace);
      return;
    }
    setTrace(trace);
    await pause(220);

    loadingText("Finding recipes that fit the kitchen…");
    const weights = readWeights();
    const baseline = generatePlan(scenario, { weights });
    trace.push({ title: "Retrieve eligible recipes", detail: RECIPES.length + " original recipes checked against selected exclusions and available equipment", icon: "⌕" });
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
    recordPlanHistory(state.shock ? "Replanned scenario" : state.mode === "live" ? "Live Qloo plan" : "Sample plan");
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
    clearPlanPanels();
    setPlanStatus("Request needs attention", "error");
    setTrace(trace.concat([{ title: "Planning stopped safely", detail: message, icon: "!" }]));
    showPlanMessage("Planning request failed", message, "Check the settings or connection, then try again.");
    toast(message);
  } finally {
    state.busy = false;
    loadingCard.hidden = true;
    setButtonsDisabled(false);
  }
}

function agentInput(scenario) {
  return { scenario, weights: readWeights(), mode: state.mode, sampleProfile: state.sampleProfile, entities: cloneData(state.entities) };
}

function installAgentResult(result, scenario, priorTrace) {
  setTrace(priorTrace.concat(result.trace));
  state.signal = result.signal;
  state.scenario = scenario;
  state.agentSummary = result.summary;
  if (result.status !== "feasible") {
    state.baseline = null;
    state.tastePlan = null;
    setPlanStatus("No feasible plan", "error");
    showInfeasible(result.errors[0]);
    return;
  }
  state.baseline = result.baseline;
  state.tastePlan = result.tastePlan;
  renderAll();
  setPlanStatus(state.shock ? "AI replan verified" : "AI plan verified", "ready");
  recordPlanHistory(state.shock ? "AI supply shock replan" : "AI tool plan");
  toast("The AI agent completed its tools; both plans passed independent constraint checks.");
}

function confirmResolvedEntities(entities) {
  const rows = entities.map((entity) => "• " + entity.requestedName + " → " + entity.name).join("\n");
  return window.confirm(
    "Review the Qloo restaurant matches before using them as taste signals.\n\n" + rows +
    "\n\nContinue with these matches? No insights request is made if you cancel.",
  );
}

function renderAll() {
  renderSummary();
  renderMenu(state.tastePlan, state.scenario);
  renderDashboard(state.tastePlan, state.scenario);
  renderComparison(state.baseline, state.tastePlan);
  renderShopping(state.tastePlan, state.scenario);
  byId("planEmpty").hidden = true;
  byId("menuGrid").hidden = false;
  byId("planFootnote").hidden = false;
  byId("exportButton").disabled = false;
  byId("shockButton").disabled = false;
  byId("planSubtitle").textContent = "Up to two options per day · " + state.tastePlan.totalServings.toLocaleString() + " planned servings · " + (state.mode === "live" ? "live Qloo tags and recipe rules" : "sample signals and recipe rules") + (state.agentSummary ? " · AI tool agent" : "");
  byId("agentSummary").hidden = !state.agentSummary;
  byId("agentSummary").textContent = state.agentSummary ? "Agent note: " + state.agentSummary : "";
}

function renderDashboard(plan, scenario) {
  const dashboard = byId("dashboard");
  if (!plan || plan.status !== "feasible" || !scenario) {
    dashboard.hidden = true;
    return;
  }
  dashboard.hidden = false;
  byId("dailySpendCap").textContent = "Cap " + money(scenario.dailyBudget);
  byId("dailySpendChart").innerHTML = plan.days.map((day) => {
    const pct = Math.min(100, Math.round((day.totalCost / scenario.dailyBudget) * 100));
    return '<div class="progress-row"><div class="progress-row-head"><span>' + escapeHtml(day.day) + '</span><strong>' + money(day.totalCost) + '</strong></div>' +
      '<progress class="chart-progress" max="100" value="' + pct + '" aria-label="' + escapeHtml(day.day + ": " + pct + "% of daily cap") + '"></progress></div>';
  }).join("");

  const cuisineTotals = {};
  for (const item of plan.days.flatMap((day) => day.items)) cuisineTotals[item.cuisine] = (cuisineTotals[item.cuisine] || 0) + item.servings;
  const cuisines = Object.entries(cuisineTotals).sort((first, second) => second[1] - first[1]).slice(0, 6);
  const maxCuisineServings = Math.max(1, ...cuisines.map(([, servings]) => servings));
  byId("cuisineMixChart").innerHTML = cuisines.length
    ? cuisines.map(([cuisine, servings]) => '<div class="progress-row"><div class="progress-row-head"><span>' + escapeHtml(cuisine) + '</span><strong>' + servings.toLocaleString() + '</strong></div>' +
      '<progress class="chart-progress" max="' + maxCuisineServings + '" value="' + servings + '" aria-label="' + escapeHtml(cuisine + ": " + servings + " planned servings") + '"></progress></div>').join("")
    : '<p class="chart-empty">No cuisine data is available for this plan.</p>';

  const purchases = calculateShoppingList(plan, scenario).filter((line) => line.estimatedCost > 0).slice(0, 5);
  const maxPurchaseCost = Math.max(1, ...purchases.map((line) => line.estimatedCost));
  byId("purchaseCostChart").innerHTML = purchases.length
    ? purchases.map((line) => '<div class="progress-row"><div class="progress-row-head"><span>' + escapeHtml(line.name) + '</span><strong>' + money(line.estimatedCost) + '</strong></div>' +
      '<progress class="chart-progress" max="' + maxPurchaseCost + '" value="' + line.estimatedCost + '" aria-label="' + escapeHtml(line.name + ": " + money(line.estimatedCost) + " estimated purchase cost") + '"></progress></div>').join("")
    : '<p class="chart-empty">On-hand inventory covers the planned purchases.</p>';
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
  const totalOptions = tastePlan.days.reduce((count, day) => count + day.items.length, 0);
  const baselineCard = compareCard(baseline, baselineSummary, false);
  const signalCard = compareCard(tastePlan, signalSummary, true);
  const cards = byId("compareGrid").querySelectorAll(".compare-card");
  cards[0].innerHTML = baselineCard;
  cards[1].innerHTML = signalCard;
  const changeSummary = changed === 0
    ? 'The same recipe set wins under both runs. ' + (state.mode === "live" ? 'The returned Qloo tags did not change the selected meals under these hard constraints.' : 'The synthetic sample cues did not change the selected meals under these hard constraints.')
    : state.mode === "live"
      ? changed + ' recipe selections differ when Qloo tag mappings are included.'
      : changed + ' recipe selections differ when synthetic sample cues are included.';
  const coverageSummary = state.mode === "live"
    ? ' ' + signalSummary.signalCovered + ' of ' + totalOptions + ' planned options map to cuisine labels found in returned Qloo tags. This is catalog tag coverage, not a claim about satisfaction.'
    : ' ' + signalSummary.signalCovered + ' of ' + totalOptions + ' planned options match the curated cuisine list. This is a demo comparison, not a Qloo result or satisfaction claim.';
  byId("comparisonVerdict").innerHTML = '<span class="verdict-star">✦</span><span>' + changeSummary + coverageSummary +
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
  state.trace = rows.map((item) => ({ ...item }));
  byId("traceCount").textContent = rows.length + (rows.length === 1 ? " step" : " steps");
  byId("traceList").innerHTML = rows.map((item) => '<div class="trace-row"><span class="trace-step">' + escapeHtml(item.icon) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.detail) + '</small></div></div>').join("");
}

function recordPlanHistory(title) {
  if (!state.baseline || !state.tastePlan || !state.scenario) return;
  const createdAt = new Date();
  const id = createdAt.getTime() + "-" + Math.random().toString(36).slice(2, 8);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(createdAt);
  state.history.unshift({
    id,
    label: title + " · " + state.scenario.attendance + " covers · " + time,
    scenario: cloneData(state.scenario),
    baseline: cloneData(state.baseline),
    tastePlan: cloneData(state.tastePlan),
    signal: cloneData(state.signal),
    shock: cloneData(state.shock),
    mode: state.mode,
    sampleProfile: state.sampleProfile,
    venueNames: byId("venueNames").value,
    weights: readWeights(),
    trace: cloneData(state.trace),
    entities: cloneData(state.entities),
    agentSummary: state.agentSummary,
    planningMethod: byId("planningMethod").value,
  });
  state.history = state.history.slice(0, 6);
  state.currentHistoryId = id;
  renderHistoryControls();
}

function renderHistoryControls() {
  const controls = byId("historyControls");
  if (!controls) return;
  const select = byId("planHistory");
  const restoreButton = byId("restoreHistoryButton");
  const undoButton = byId("undoShockButton");
  controls.hidden = state.history.length === 0;
  select.replaceChildren();
  state.history.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    select.append(option);
  });
  select.value = state.currentHistoryId || state.history[0]?.id || "";
  restoreButton.disabled = state.busy || !state.history.some((entry) => entry.id === select.value);
  undoButton.hidden = !canUndoShock();
  undoButton.disabled = state.busy || !canUndoShock();
}

function canUndoShock() {
  const previousId = state.shock?.previousHistoryId;
  return Boolean(previousId && state.history.some((entry) => entry.id === previousId));
}

function restoreSelectedHistory() {
  restorePlanHistory(byId("planHistory").value);
}

function undoSupplyShock() {
  if (!canUndoShock()) return;
  restorePlanHistory(state.shock.previousHistoryId);
  toast("Restored the plan from before the supply shock.");
}

function restorePlanHistory(id) {
  const entry = state.history.find((item) => item.id === id);
  if (!entry || state.busy) return;
  const scenario = cloneData(entry.scenario);
  byId("cafeteriaName").value = scenario.cafeteriaName;
  byId("attendance").value = scenario.attendance;
  byId("kitchenCapacity").value = scenario.kitchenCapacity;
  byId("dailyBudget").value = scenario.dailyBudget;
  byId("vegetarianShare").value = Math.round(scenario.vegetarianShare * 100);
  byId("allergenExclusions").value = scenario.allergenExclusions.join(", ");
  byId("ingredientExclusions").value = scenario.ingredientExclusions.join(", ");
  byId("inventory").value = Object.entries(scenario.inventory).map(([key, amount]) => key + "=" + amount).join(", ");
  byId("cuisinePreferences").value = scenario.cuisinePreferences[0] || "";
  form.querySelectorAll('input[name="equipment"]').forEach((node) => { node.checked = scenario.equipment.includes(node.value); });
  byId("weightTaste").value = entry.weights.tasteSignal;
  byId("weightExplicit").value = entry.weights.explicitPreference;
  byId("weightCost").value = entry.weights.affordability;
  byId("weightPrep").value = entry.weights.preparation;
  byId("venueNames").value = entry.venueNames;
  state.mode = entry.mode;
  state.sampleProfile = entry.sampleProfile;
  byId("sampleProfile").value = entry.sampleProfile;
  state.scenario = scenario;
  state.baseline = cloneData(entry.baseline);
  state.tastePlan = cloneData(entry.tastePlan);
  state.signal = cloneData(entry.signal);
  state.shock = cloneData(entry.shock);
  state.trace = cloneData(entry.trace);
  state.entities = cloneData(entry.entities || []);
  state.agentSummary = entry.agentSummary || "";
  byId("planningMethod").value = entry.planningMethod || "rules";
  state.currentHistoryId = entry.id;
  renderMode();
  renderProfilePreview();
  updateWeightLabels();
  renderAll();
  setTrace(state.trace);
  setPlanStatus(entry.shock ? "Replanned after supply shock" : "Plan restored", "ready");
  setButtonsDisabled(false);
  renderHistoryControls();
  saveForm();
}

function cloneData(value) {
  if (value == null) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
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
  showPlanMessage("No feasible menu under these constraints", reason, "Adjust the budget, exclusions or equipment list, then try again. Safety-related restrictions are never relaxed automatically.");
}

function showPlanMessage(title, reason, guidance) {
  planEmpty.hidden = false;
  byId("planEmpty").innerHTML = '<div class="empty-illustration"><span>!</span><span>▤</span><span>×</span></div>' +
    '<strong>' + escapeHtml(title) + '.</strong>' +
    '<p>' + escapeHtml(reason) + ' ' + escapeHtml(guidance) + '</p>' +
    '<button class="button button-primary" id="emptyGenerateButton">Try again <span>→</span></button>';
  byId("emptyGenerateButton").addEventListener("click", generate);
}

function clearPlanPanels() {
  byId("agentSummary").hidden = true;
  byId("agentSummary").textContent = "";
  byId("menuGrid").innerHTML = "";
  byId("menuGrid").hidden = true;
  byId("dashboard").hidden = true;
  byId("planFootnote").hidden = true;
  byId("planSubtitle").textContent = "Generate a plan to compare operational fit with taste signals.";
  byId("metricCuisineCount").textContent = "—";
  byId("metricWeeklyCost").textContent = "—";
  renderComparisonPlaceholder();
  renderShoppingPlaceholder();
  setButtonsDisabled(false);
}

function renderComparisonPlaceholder() {
  const signalLabel = state.mode === "live" ? "Live Qloo tag signal plan" : "Synthetic sample signal plan";
  byId("compareGrid").innerHTML = '<article class="compare-card"><div class="compare-card-top"><span class="compare-index">A</span><div><strong>Constraints only</strong><small>Operational baseline</small></div><span class="compare-badge">BASELINE</span></div><div class="compare-placeholder">Generate the week to compare plans.</div></article>' +
    '<article class="compare-card accent-card"><div class="compare-card-top"><span class="compare-index">B</span><div><strong>Taste signals included</strong><small>' + escapeHtml(signalLabel) + '</small></div><span class="compare-badge accent-badge">WITH SIGNALS</span></div><div class="compare-placeholder">Generate the week to compare plans.</div></article>';
  byId("comparisonVerdict").innerHTML = '<span class="verdict-star">✦</span><span>What changed because the signal was included will appear here. If nothing changes, PalateOps will say so.</span>';
}

function renderShoppingPlaceholder() {
  byId("shoppingList").innerHTML = '<div class="muted-empty">Your consolidated list will appear after planning.</div>';
  byId("shoppingList").dataset.lines = "[]";
  byId("shoppingTotal").textContent = "—";
}

function markPlanOutdated() {
  if (!state.tastePlan || state.busy) return;
  const hadShock = Boolean(state.shock);
  state.baseline = null;
  state.tastePlan = null;
  state.signal = null;
  state.scenario = null;
  state.shock = null;
  state.currentHistoryId = null;
  state.agentSummary = "";
  state.entities = [];
  clearPlanPanels();
  setPlanStatus("Settings changed", "error");
  setTrace([]);
  showPlanMessage(
    "Plan needs to be regenerated",
    "One or more settings changed after this plan was created.",
    hadShock ? "The simulated supply shock was cleared with the old plan. Generate a fresh plan." : "Generate again to update the menu, comparison and shopping list.",
  );
  renderHistoryControls();
}

function simulateShock() {
  if (!state.tastePlan || !state.scenario || state.busy) return;
  const beforeAttendance = state.scenario.attendance;
  const beforeCost = state.tastePlan.totalCost;
  const previousHistoryId = state.currentHistoryId;
  const attendance = Math.ceil(beforeAttendance * 1.25);
  const priceMultipliers = { ...state.scenario.priceMultipliers, chicken: (Number(state.scenario.priceMultipliers.chicken) || 1) * 1.2 };
  state.shock = { beforeAttendance, afterAttendance: attendance, beforeCost, priceMultipliers, previousHistoryId };
  byId("attendance").value = attendance;
  const scenario = normalizeScenario({ ...state.scenario, attendance, priceMultipliers });
  state.scenario = scenario;
  saveForm();
  renderSummary();
  setTrace([{ title: "Apply simulated supply shock", detail: "Attendance " + beforeAttendance + " → " + attendance + " · chicken ingredient price +20%", icon: "ϟ" }]);
  generateWithExistingSignal(scenario);
}

async function generateWithExistingSignal(scenario) {
  state.baseline = null;
  state.tastePlan = null;
  state.scenario = scenario;
  state.currentHistoryId = null;
  clearPlanPanels();
  state.busy = true;
  setButtonsDisabled(true);
  loadingCard.hidden = false;
  planEmpty.hidden = true;
  byId("menuGrid").hidden = true;
  byId("dashboard").hidden = true;
  loadingText("Replanning around the new service load…");
  const trace = cloneData(state.trace);
  state.agentSummary = "";
  try {
    if (byId("planningMethod").value === "agent") {
      loadingText("The AI agent is replanning around the supply shock…");
      installAgentResult(await requestAgentPlan(agentInput(scenario)), scenario, trace);
      return;
    }
    await pause(220);
    const weights = readWeights();
    trace.push({ title: "Re-optimize operational baseline", detail: "Recalculate recipe choices, portions and daily costs with the shock applied", icon: "↗" });
    setTrace(trace);
    const baseline = generatePlan(scenario, { weights });
    trace.push({ title: "Re-optimize taste-signal plan", detail: "Use the same constraints and retained taste signals for a comparable replan", icon: "◉" });
    setTrace(trace);
    const tastePlan = generatePlan(scenario, { signal: state.signal, weights });
    const validation = tastePlan.status === "feasible" ? verifyPlan(tastePlan, scenario) : { valid: false, errors: tastePlan.errors || [] };
    trace.push({ title: "Verify revised plan", detail: validation.valid ? "Attendance, cost, exclusions and portions passed" : validation.errors.join(" "), icon: validation.valid ? "✓" : "!" });
    setTrace(trace);
    if (baseline.status !== "feasible" || tastePlan.status !== "feasible" || !validation.valid) {
      state.baseline = null;
      state.tastePlan = null;
      setPlanStatus("Shock is infeasible", "error");
      showInfeasible(validation.errors[0] || baseline.errors?.[0] || "The increased attendance cannot be served under the current budget and restrictions.");
      trace.push({ title: "Replanning stopped safely", detail: validation.errors[0] || baseline.errors?.[0] || "No feasible plan was found.", icon: "!" });
      setTrace(trace);
      return;
    }
    state.baseline = baseline;
    state.tastePlan = tastePlan;
    state.scenario = scenario;
    renderAll();
    setPlanStatus("Replanned after supply shock", "ready");
    recordPlanHistory("Supply shock replan");
    toast("Plan rebuilt for " + scenario.attendance.toLocaleString() + " covers with a 20% chicken price increase.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The supply shock replan could not be completed.";
    state.baseline = null;
    state.tastePlan = null;
    clearPlanPanels();
    setPlanStatus("Replan needs attention", "error");
    setTrace(trace.concat([{ title: "Replanning stopped safely", detail: message, icon: "!" }]));
    showPlanMessage("Could not replan the supply shock", message, "Try generating the plan again.");
    toast(message);
  } finally {
    state.busy = false;
    loadingCard.hidden = true;
    setButtonsDisabled(false);
    renderHistoryControls();
  }
}

function exportWeeklyPlan() {
  if (!state.tastePlan || !state.scenario) return;
  const list = calculateShoppingList(state.tastePlan, state.scenario);
  const purchaseTotal = list.reduce((sum, line) => sum + line.estimatedCost, 0);
  const averagePerServing = state.tastePlan.totalCost / state.tastePlan.totalServings;
  const rows = [["Section", "Day", "Item", "Cuisine", "Servings", "Quantity", "Unit", "Estimated cost"]];
  rows.push(["Cost summary", "", "Cafeteria", "", "", state.scenario.cafeteriaName, "", ""]);
  rows.push(["Cost summary", "", "Planning days", "", "", state.tastePlan.days.length, "days", ""]);
  rows.push(["Cost summary", "", "Total planned servings", "", "", state.tastePlan.totalServings, "servings", ""]);
  rows.push(["Cost summary", "", "Weekly recipe ingredient estimate", "", "", "", "", state.tastePlan.totalCost.toFixed(2)]);
  rows.push(["Cost summary", "", "Average recipe cost per serving", "", "", "", "", averagePerServing.toFixed(2)]);
  rows.push(["Cost summary", "", "Estimated purchasing total", "", "", "", "", purchaseTotal.toFixed(2)]);
  rows.push(["Cost summary", "", "Daily ingredient cap", "", "", "", "", state.scenario.dailyBudget.toFixed(2)]);
  rows.push(["Cost summary", "", "Daily kitchen serving capacity", "", "", state.scenario.kitchenCapacity, "servings", ""]);
  rows.push([]);
  rows.push(["Weekly menu"]);
  rows.push(["Section", "Day", "Recipe", "Cuisine", "Servings", "", "", "Estimated cost"]);
  for (const day of state.tastePlan.days) {
    for (const item of day.items) rows.push(["Menu", day.day, item.name, item.cuisine, item.servings, "", "", item.cost.toFixed(2)]);
  }
  rows.push([]);
  rows.push(["Shopping list"]);
  rows.push(["Section", "", "Ingredient", "", "", "Buy quantity", "Unit", "Estimated cost"]);
  for (const line of list) rows.push(["Procurement", "", line.name, "", "", line.buy, line.unit, line.estimatedCost.toFixed(2)]);
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "palateops-weekly-plan.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("Weekly menu, cost summary and shopping list exported as CSV.");
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
  state.history = [];
  state.currentHistoryId = null;
  state.trace = [];
  state.entities = [];
  state.agentSummary = "";
  state.preferredMethod = "rules";
  byId("planningMethod").value = "rules";
  setMode("sample");
  byId("sampleProfile").value = "campus";
  byId("cafeteriaName").value = "Campus Commons Cafeteria";
  byId("attendance").value = 150;
  byId("kitchenCapacity").value = 200;
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
  byId("dashboard").hidden = true;
  byId("planFootnote").hidden = true;
  planEmpty.hidden = false;
  byId("planEmpty").innerHTML = '<div class="empty-illustration"><span>◉</span><span>✦</span><span>▤</span></div><strong>The kitchen is ready for a plan.</strong><p>We’ll check constraints, select a five-day menu, verify servings and cost, then make a shopping list.</p><button class="button button-primary" id="emptyGenerateButton">Generate my weekly menu <span>→</span></button>';
  byId("emptyGenerateButton").addEventListener("click", generate);
  renderShoppingPlaceholder();
  renderComparisonPlaceholder();
  byId("planSubtitle").textContent = "Generate a plan to compare operational fit with taste signals.";
  setPlanStatus("Waiting for a plan", "");
  setTrace([]);
  byId("exportButton").disabled = true;
  byId("shockButton").disabled = true;
  renderProfilePreview();
  updateWeightLabels();
  renderSummary();
  renderHistoryControls();
  saveForm();
}

function hydrateForm() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch {}
  if (saved) {
    byId("cafeteriaName").value = saved.cafeteriaName || "Campus Commons Cafeteria";
    byId("attendance").value = saved.attendance ?? 150;
    byId("kitchenCapacity").value = saved.kitchenCapacity ?? 200;
    byId("dailyBudget").value = saved.dailyBudget ?? 600;
    byId("vegetarianShare").value = saved.vegetarianShare ?? 35;
    byId("allergenExclusions").value = saved.allergenExclusions ?? "peanut";
    byId("ingredientExclusions").value = saved.ingredientExclusions || "";
    byId("inventory").value = saved.inventoryText || "";
    byId("cuisinePreferences").value = saved.cuisinePreference || "";
    byId("venueNames").value = saved.venueNames || "";
    state.mode = saved.mode === "live" ? "live" : "sample";
    state.sampleProfile = SAMPLE_PROFILES[saved.sampleProfile] ? saved.sampleProfile : "campus";
    state.preferredMethod = saved.planningMethod === "agent" ? "agent" : "rules";
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
    kitchenCapacity: byId("kitchenCapacity").value,
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
    planningMethod: byId("planningMethod").value,
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch {}
}

function setButtonsDisabled(disabled) {
  generateButton.disabled = disabled;
  const currentEmptyButton = byId("emptyGenerateButton");
  if (currentEmptyButton) currentEmptyButton.disabled = disabled;
  form.querySelectorAll("input, select, textarea").forEach((node) => { node.disabled = disabled; });
  document.querySelectorAll(".weight-grid input").forEach((node) => { node.disabled = disabled; });
  ["sampleModeButton", "liveModeButton", "sampleProfile", "venueNames", "resetButton", "planningMethod"].forEach((id) => { byId(id).disabled = disabled; });
  byId("exportButton").disabled = disabled || !state.tastePlan;
  byId("shockButton").disabled = disabled || !state.tastePlan;
  byId("restoreHistoryButton").disabled = disabled || !state.history.length;
  byId("undoShockButton").disabled = disabled || !canUndoShock();
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
