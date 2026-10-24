import { EQUIPMENT, INGREDIENTS, RECIPES, WEEKDAYS } from "./recipes.js";

export function normalizeScenario(input = {}) {
  return {
    cafeteriaName: cleanText(input.cafeteriaName, "Campus Commons Cafeteria", 80),
    attendance: Number(input.attendance ?? 150),
    kitchenCapacity: Number(input.kitchenCapacity ?? 5000),
    dailyBudget: Number(input.dailyBudget ?? 600),
    vegetarianShare: Number(input.vegetarianShare ?? 0.35),
    allergenExclusions: normalizeList(input.allergenExclusions ?? ["peanut"]),
    ingredientExclusions: normalizeList(input.ingredientExclusions ?? []),
    equipment: normalizeList(input.equipment ?? EQUIPMENT),
    cuisinePreferences: normalizeList(input.cuisinePreferences ?? []),
    inventory: normalizeInventory(input.inventory ?? {}),
    priceMultipliers: normalizeMultipliers(input.priceMultipliers ?? {}),
  };
}

export function validateScenario(scenario) {
  const errors = [];
  if (!Number.isInteger(scenario.attendance) || scenario.attendance < 1 || scenario.attendance > 5000) {
    errors.push("Attendance must be a whole number from 1 to 5,000.");
  }
  if (!Number.isInteger(scenario.kitchenCapacity) || scenario.kitchenCapacity < 1 || scenario.kitchenCapacity > 5000) {
    errors.push("Daily kitchen serving capacity must be a whole number from 1 to 5,000.");
  } else if (Number.isInteger(scenario.attendance) && scenario.attendance > scenario.kitchenCapacity) {
    errors.push("Attendance exceeds the stated daily kitchen serving capacity.");
  }
  if (!Number.isFinite(scenario.dailyBudget) || scenario.dailyBudget <= 0) {
    errors.push("Daily ingredient budget must be greater than zero.");
  }
  if (!Number.isFinite(scenario.vegetarianShare) || scenario.vegetarianShare <= 0 || scenario.vegetarianShare > 1) {
    errors.push("Vegetarian planning share must be greater than 0% and at most 100%.");
  }
  if (!Array.isArray(scenario.equipment)) errors.push("Kitchen equipment must be a list.");
  return errors;
}

export function recipeCostPerServing(recipe, multipliers = {}) {
  return Object.entries(recipe.ingredients).reduce(function (sum, entry) {
    const key = entry[0];
    const quantity = entry[1];
    const price = INGREDIENTS[key]?.price;
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity < 0) return Infinity;
    const multiplier = multipliers[key] == null ? 1 : Number(multipliers[key]);
    if (!Number.isFinite(multiplier) || multiplier < 0) return Infinity;
    return sum + price * quantity * multiplier;
  }, 0);
}

function isEligible(recipe, scenario) {
  const excludedAllergen = recipe.allergens.some((allergen) => scenario.allergenExclusions.includes(allergen));
  const excludedIngredient = hasExcludedIngredient(recipe, scenario);
  const missingEquipment = recipe.equipment.some((item) => !scenario.equipment.includes(item));
  return !excludedAllergen && !excludedIngredient && !missingEquipment && Number.isFinite(recipeCostPerServing(recipe, scenario.priceMultipliers));
}

function hasExcludedIngredient(recipe, scenario) {
  return Object.keys(recipe.ingredients).some((ingredient) =>
    scenario.ingredientExclusions.some((term) => {
      const needle = term.replace(/[^a-z0-9]/g, "");
      const searchable = (ingredient + " " + (INGREDIENTS[ingredient]?.name || "")).toLowerCase().replace(/[^a-z0-9]/g, "");
      return needle && searchable.includes(needle);
    }),
  );
}

function candidatePairs(scenario, recipes) {
  const vegetarian = recipes.filter((recipe) => recipe.vegetarian);
  const all = recipes;
  const pairs = [];
  const vegServings = requiredVegetarianServings(scenario);
  const flexServings = scenario.attendance - vegServings;
  for (const veggie of vegetarian) {
    for (const other of all) {
      if (other.id === veggie.id) continue;
      if (flexServings > 0 && other.vegetarian) continue;
      const items = [
        { recipe: veggie, servings: vegServings },
        { recipe: other, servings: flexServings },
      ].filter((item) => item.servings > 0);
      const cost = items.reduce((sum, item) => sum + recipeCostPerServing(item.recipe, scenario.priceMultipliers) * item.servings, 0);
      if (cost <= scenario.dailyBudget + 0.000001) {
        pairs.push({ items, cost, ids: items.map((item) => item.recipe.id) });
      }
    }
  }
  const unique = new Map();
  for (const pair of pairs) {
    const signature = pair.ids.slice().sort().join("|");
    if (!unique.has(signature)) unique.set(signature, pair);
  }
  return [...unique.values()];
}

function signalMatches(recipe, signal) {
  if (!signal || !Array.isArray(signal.cuisineSignals)) return false;
  return signal.cuisineSignals.some((entry) => normalizeCuisine(entry) === normalizeCuisine(recipe.cuisine));
}

export function normalizeCuisine(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/cuisine|food|dining/g, "")
    .replace(/[^a-z]/g, "");
}

export function alignableCuisineSignals(tags) {
  const groups = [
    ["Japanese", ["japanese", "japan", "ramen", "sushi"]],
    ["Korean", ["korean", "korea", "bibimbap", "bulgogi"]],
    ["Thai", ["thai", "thailand"]],
    ["Mexican", ["mexican", "mexico", "taco", "texmex"]],
    ["Italian", ["italian", "italy", "pasta"]],
    ["Mediterranean", ["mediterranean", "greek", "levantine"]],
    ["Middle Eastern", ["middle eastern", "lebanese", "shawarma", "arabic"]],
    ["Indian", ["indian", "india", "curry"]],
    ["West African", ["west african", "african", "jollof"]],
    ["American", ["american", "united states", "us cuisine"]],
  ];
  const text = (tags || []).map((item) => typeof item === "string" ? item : item.name || item.tag_value || "").join(" | ").toLowerCase();
  return groups.filter((group) => group[1].some((keyword) => text.includes(keyword))).map((group) => group[0]);
}

function cuisinePreferenceScore(recipe, scenario) {
  return scenario.cuisinePreferences.some((cuisine) => normalizeCuisine(cuisine) === normalizeCuisine(recipe.cuisine)) ? 1 : 0;
}

function recipeScore(recipe, scenario, signal, weights) {
  const cost = recipeCostPerServing(recipe, scenario.priceMultipliers);
  const costFit = Math.max(0, 1 - cost / 8);
  const speedFit = Math.max(0, 1 - recipe.prep / 90);
  const explicitFit = cuisinePreferenceScore(recipe, scenario);
  const signalFit = signalMatches(recipe, signal) ? 1 : 0;
  return {
    value: weights.affordability * costFit + weights.preparation * speedFit + weights.explicitPreference * explicitFit + weights.tasteSignal * signalFit,
    costFit,
    speedFit,
    explicitFit,
    signalFit,
  };
}

function pairScore(pair, scenario, signal, weights, history) {
  let total = 0;
  let cuisineSet = new Set();
  for (const item of pair.items) {
    const score = recipeScore(item.recipe, scenario, signal, weights).value;
    total += score * (item.servings / scenario.attendance);
    cuisineSet.add(normalizeCuisine(item.recipe.cuisine));
  }
  const cuisineNovelty = pair.items.reduce((sum, item) => {
    const normalized = normalizeCuisine(item.recipe.cuisine);
    return sum + (history.cuisines.has(normalized) ? 0 : 0.1);
  }, 0);
  const dishNovelty = pair.items.reduce((sum, item) => sum + (history.dishes.has(item.recipe.id) ? -0.12 : 0.05), 0);
  const optionVariety = cuisineSet.size > 1 ? 0.08 : 0;
  return total + cuisineNovelty + dishNovelty + optionVariety;
}

export function generatePlan(scenarioInput, options = {}) {
  const scenario = normalizeScenario(scenarioInput);
  const errors = validateScenario(scenario);
  if (errors.length) return { status: "invalid", errors, days: [] };
  const weights = normalizeWeights(options.weights);
  const recipes = (options.recipes || RECIPES).filter((recipe) => isEligible(recipe, scenario));
  if (recipes.filter((recipe) => recipe.vegetarian).length === 0) {
    return { status: "infeasible", errors: ["No vegetarian recipe meets the selected exclusions and equipment constraints."], days: [] };
  }
  const pairs = candidatePairs(scenario, recipes);
  if (pairs.length === 0) {
    return { status: "infeasible", errors: ["No two-option daily menu can meet attendance and budget while including a vegetarian option."], days: [] };
  }
  const history = { cuisines: new Set(), dishes: new Set(), menus: new Set() };
  const days = [];
  for (const dayName of WEEKDAYS) {
    const availablePairs = pairs.filter((pair) => !history.menus.has(pair.ids.slice().sort().join("|")));
    if (availablePairs.length === 0) {
      return { status: "infeasible", errors: ["The eligible recipes cannot form five distinct daily menus under the selected constraints."], days: [] };
    }
    const ranked = availablePairs
      .map((pair) => ({ pair, score: pairScore(pair, scenario, options.signal, weights, history) }))
      .sort((a, b) => b.score - a.score || a.pair.cost - b.pair.cost || a.pair.ids.join().localeCompare(b.pair.ids.join()));
    const selected = ranked[0].pair;
    const items = selected.items.map((item) => ({
      recipeId: item.recipe.id,
      name: item.recipe.name,
      cuisine: item.recipe.cuisine,
      vegetarian: item.recipe.vegetarian,
      servings: item.servings,
      cost: roundMoney(recipeCostPerServing(item.recipe, scenario.priceMultipliers) * item.servings),
      costPerServing: roundMoney(recipeCostPerServing(item.recipe, scenario.priceMultipliers)),
      allergens: [...item.recipe.allergens],
      description: item.recipe.description,
      ingredients: { ...item.recipe.ingredients },
    }));
    for (const item of selected.items) {
      history.dishes.add(item.recipe.id);
      history.cuisines.add(normalizeCuisine(item.recipe.cuisine));
    }
    history.menus.add(selected.ids.slice().sort().join("|"));
    days.push({ day: dayName, items, totalServings: items.reduce((n, item) => n + item.servings, 0), totalCost: roundMoney(selected.cost) });
  }
  const plan = {
    status: "feasible",
    days,
    totalCost: roundMoney(days.reduce((sum, day) => sum + day.totalCost, 0)),
    totalServings: days.reduce((sum, day) => sum + day.totalServings, 0),
    tasteSource: options.signal?.source || "none",
    signal: options.signal || null,
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Math.round(value * 100)])),
  };
  const validation = verifyPlan(plan, scenario, { recipes });
  return validation.valid ? plan : { status: "infeasible", errors: validation.errors, days: [], validation };
}

function normalizeWeights(input = {}) {
  const defaults = { tasteSignal: 40, explicitPreference: 28, affordability: 20, preparation: 12 };
  const raw = Object.fromEntries(Object.keys(defaults).map((key) => [key, Math.max(0, Math.min(100, Number(input[key] ?? defaults[key]) || 0))]));
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const source = total === 0 ? defaults : raw;
  const denominator = total === 0 ? 100 : total;
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value / denominator]));
}

export function verifyPlan(plan, scenarioInput, options = {}) {
  const scenario = normalizeScenario(scenarioInput);
  const recipes = Array.isArray(options.recipes) ? options.recipes : RECIPES;
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const errors = [];
  errors.push(...validateScenario(scenario));
  if (plan?.status !== "feasible") errors.push("The plan is not marked feasible.");
  if (!plan || !Array.isArray(plan.days) || plan.days.length !== 5) errors.push("The plan must contain five days.");
  let weeklyCost = 0;
  let weeklyServings = 0;
  const menuSignatures = new Set();
  for (let index = 0; index < (plan?.days || []).length; index += 1) {
    const day = plan.days[index];
    const label = typeof day?.day === "string" ? day.day : "Day " + (index + 1);
    if (day?.day !== WEEKDAYS[index]) errors.push(label + " is out of order or has an invalid day name.");
    const items = Array.isArray(day?.items) ? day.items : [];
    if (!Array.isArray(day?.items)) errors.push(label + " must contain a list of menu options.");
    if (items.length < 1 || items.length > 2) errors.push(label + " must have one or two options.");

    let dayServings = 0;
    let vegetarianServings = 0;
    let dayCost = 0;
    const menuIds = [];
    for (const item of items) {
      if (!Number.isInteger(item?.servings) || item.servings < 1) {
        errors.push(label + " options must have positive whole-number servings.");
        continue;
      }
      dayServings += item.servings;
      const recipe = recipeById.get(item.recipeId);
      if (!recipe) {
        errors.push(label + " contains an unknown recipe.");
        continue;
      }
      menuIds.push(recipe.id);
      if (recipe.vegetarian) vegetarianServings += item.servings;
      if (item.name !== recipe.name || item.cuisine !== recipe.cuisine || item.vegetarian !== recipe.vegetarian) {
        errors.push(label + " contains recipe details that do not match the catalog.");
      }
      if (!sameStringSet(item.allergens, recipe.allergens) || !sameNumberRecord(item.ingredients, recipe.ingredients)) {
        errors.push(label + " contains safety or ingredient details that do not match the catalog.");
      }
      if (recipe.allergens.some((allergen) => scenario.allergenExclusions.includes(allergen))) {
        errors.push(label + " contains an excluded allergen.");
      }
      if (hasExcludedIngredient(recipe, scenario)) errors.push(label + " contains an excluded ingredient.");
      if (recipe.equipment.some((equipment) => !scenario.equipment.includes(equipment))) {
        errors.push(label + " requires unavailable kitchen equipment.");
      }

      const costPerServing = recipeCostPerServing(recipe, scenario.priceMultipliers);
      const expectedItemCost = roundMoney(costPerServing * item.servings);
      if (!Number.isFinite(costPerServing) || !Number.isFinite(item.costPerServing) || Math.abs(item.costPerServing - roundMoney(costPerServing)) > 0.01 || !Number.isFinite(item.cost) || Math.abs(item.cost - expectedItemCost) > 0.01) {
        errors.push(label + " contains a recipe cost that does not match the current price assumptions.");
      }
      dayCost += costPerServing * item.servings;
    }

    if (new Set(menuIds).size !== menuIds.length) errors.push(label + " repeats the same recipe.");
    const menuSignature = menuIds.slice().sort().join("|");
    if (menuSignatures.has(menuSignature)) errors.push(label + " repeats an identical daily menu.");
    menuSignatures.add(menuSignature);
    if (dayServings !== scenario.attendance || day?.totalServings !== dayServings) {
      errors.push(label + " does not cover planned attendance.");
    }
    if (vegetarianServings !== requiredVegetarianServings(scenario)) {
      errors.push(label + " does not meet the planned vegetarian serving share.");
    }
    const expectedDayCost = roundMoney(dayCost);
    if (!Number.isFinite(day?.totalCost) || Math.abs(day.totalCost - expectedDayCost) > 0.01) {
      errors.push(label + " has an incorrect daily cost total.");
    }
    if (expectedDayCost > scenario.dailyBudget + 0.01) errors.push(label + " exceeds the daily ingredient budget.");
    weeklyCost += expectedDayCost;
    weeklyServings += dayServings;
  }
  if (Number.isFinite(plan?.totalCost) && Math.abs(plan.totalCost - roundMoney(weeklyCost)) > 0.01) errors.push("The weekly cost total is incorrect.");
  else if (!Number.isFinite(plan?.totalCost)) errors.push("The weekly cost total is missing or invalid.");
  if (plan?.totalServings !== weeklyServings) errors.push("The weekly serving total is incorrect.");
  return { valid: errors.length === 0, errors };
}

function requiredVegetarianServings(scenario) {
  return Math.min(scenario.attendance, Math.max(1, Math.round(scenario.attendance * scenario.vegetarianShare)));
}

export function calculateShoppingList(plan, scenarioInput, options = {}) {
  const scenario = normalizeScenario(scenarioInput);
  const recipes = Array.isArray(options.recipes) ? options.recipes : RECIPES;
  const validation = verifyPlan(plan, scenario, { recipes });
  if (!validation.valid) throw new Error("Cannot calculate procurement from an invalid plan: " + validation.errors.join(" "));
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const required = {};
  for (const day of plan?.days || []) {
    for (const item of day.items) {
      const recipe = recipeById.get(item.recipeId);
      for (const [key, amount] of Object.entries(recipe.ingredients)) {
        required[key] = (required[key] || 0) + amount * item.servings;
      }
    }
  }
  return Object.entries(required).map(([key, quantity]) => {
    const info = INGREDIENTS[key];
    const onHand = Math.max(0, Number(scenario.inventory[key]) || 0);
    const buy = Math.max(0, quantity - onHand);
    const multiplier = scenario.priceMultipliers[key] == null ? 1 : scenario.priceMultipliers[key];
    return {
      key,
      name: info.name,
      unit: info.unit,
      required: roundQuantity(quantity),
      onHand: roundQuantity(onHand),
      buy: roundQuantity(buy),
      estimatedCost: roundMoney(buy * info.price * multiplier),
    };
  }).filter((line) => line.required > 0).sort((a, b) => b.estimatedCost - a.estimatedCost);
}

export function summarizePlan(plan) {
  if (!plan || plan.status !== "feasible") return { dishCount: 0, cuisineCount: 0, signalCovered: 0 };
  const items = plan.days.flatMap((day) => day.items);
  const signalRecipes = items.filter((item) => plan.signal?.cuisineSignals?.some((cuisine) => normalizeCuisine(cuisine) === normalizeCuisine(item.cuisine)));
  return {
    dishCount: items.length,
    cuisineCount: new Set(items.map((item) => item.cuisine)).size,
    signalCovered: signalRecipes.length,
  };
}

function normalizeInventory(value) {
  if (Array.isArray(value)) return {};
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => {
    const quantity = Number(amount);
    return [key, Number.isFinite(quantity) ? Math.max(0, quantity) : 0];
  }));
}

function normalizeMultipliers(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => {
    const multiplier = Number(amount);
    return [key, Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1];
  }));
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return false;
  const left = [...new Set(first)].sort();
  const right = [...new Set(second)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumberRecord(first, second) {
  if (!first || typeof first !== "object" || Array.isArray(first) || !second || typeof second !== "object" || Array.isArray(second)) return false;
  const left = Object.keys(first).sort();
  const right = Object.keys(second).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] && Number.isFinite(first[key]) && Math.abs(first[key] - second[key]) < 0.000001);
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || "").trim().slice(0, maxLength);
  return text || fallback;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
