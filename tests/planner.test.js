import test from "node:test";
import assert from "node:assert/strict";
import { INGREDIENTS, RECIPES, SAMPLE_PROFILES } from "../src/recipes.js";
import { calculateShoppingList, generatePlan, normalizeScenario, recipeCostPerServing, summarizePlan, validateScenario, verifyPlan } from "../src/planner.js";
import { sampleSignal } from "../src/qloo.js";

const demo = normalizeScenario({});

test("catalog contains 32 original recipes with ingredient and safety metadata", () => {
  assert.equal(RECIPES.length, 32);
  assert.ok(RECIPES.every((recipe) => recipe.id && recipe.ingredients && Array.isArray(recipe.allergens) && Array.isArray(recipe.equipment)));
  assert.ok(RECIPES.every((recipe) => Object.keys(recipe.ingredients).every((key) => INGREDIENTS[key])));
});

test("demo optimizer returns five days with hard constraints satisfied", () => {
  const signal = sampleSignal("campus");
  const plan = generatePlan(demo, { signal });
  assert.equal(plan.status, "feasible");
  assert.equal(plan.days.length, 5);
  assert.equal(plan.totalServings, 750);
  assert.ok(plan.days.every((day) => day.totalServings === 150));
  assert.ok(plan.days.every((day) => day.totalCost <= 600));
  assert.ok(plan.days.every((day) => day.items.some((item) => item.vegetarian)));
  assert.deepEqual(verifyPlan(plan, demo), { valid: true, errors: [] });
});

test("daily menus do not repeat an identical recipe within the day", () => {
  const plan = generatePlan(demo);
  assert.ok(plan.days.every((day) => new Set(day.items.map((item) => item.recipeId)).size === day.items.length));
  assert.equal(new Set(plan.days.map((day) => day.items.map((item) => item.recipeId).sort().join("|"))).size, 5);
});

test("allergen exclusions are preserved as hard constraints", () => {
  const plan = generatePlan(normalizeScenario({ allergenExclusions: ["peanut", "sesame"] }));
  assert.equal(plan.status, "feasible");
  assert.ok(plan.days.flatMap((day) => day.items).every((item) => !item.allergens.some((allergen) => ["peanut", "sesame"].includes(allergen))));
});

test("ingredient exclusions match catalog names with spaces", () => {
  const plan = generatePlan(normalizeScenario({ ingredientExclusions: ["olive oil"] }));
  assert.equal(plan.status, "feasible");
  assert.ok(plan.days.flatMap((day) => day.items).every((item) => !Object.hasOwn(item.ingredients, "oliveOil")));
});

test("strict equipment and exclusions return infeasible instead of relaxing", () => {
  const scenario = normalizeScenario({ equipment: [], allergenExclusions: ["peanut", "gluten", "dairy", "egg", "soy", "sesame"], ingredientExclusions: ["rice", "lentils", "chickpeas", "tomato"] });
  const result = generatePlan(scenario);
  assert.equal(result.status, "infeasible");
  assert.ok(result.errors.length > 0);
});

test("invalid attendance and budget values are rejected", () => {
  assert.ok(validateScenario(normalizeScenario({ attendance: 0 })).length > 0);
  assert.ok(validateScenario(normalizeScenario({ attendance: -1 })).length > 0);
  assert.ok(validateScenario(normalizeScenario({ dailyBudget: -3 })).length > 0);
  assert.ok(validateScenario(normalizeScenario({ vegetarianShare: 0 })).length > 0);
});

test("daily kitchen serving capacity is a hard planning constraint", () => {
  const scenario = normalizeScenario({ attendance: 188, kitchenCapacity: 180 });
  assert.ok(validateScenario(scenario).some((error) => error.includes("exceeds the stated daily kitchen serving capacity")));
  assert.equal(generatePlan(scenario).status, "invalid");
  assert.ok(validateScenario(normalizeScenario({ attendance: 150, kitchenCapacity: 0 })).some((error) => error.includes("capacity must be a whole number")));
});

test("infeasible budget is explicit and never returns an over-budget menu", () => {
  const plan = generatePlan(normalizeScenario({ dailyBudget: 1 }));
  assert.equal(plan.status, "infeasible");
  assert.equal(plan.days.length, 0);
});

test("serving counts track changed attendance and the 35 percent planning assumption", () => {
  const plan = generatePlan(normalizeScenario({ attendance: 200 }));
  assert.equal(plan.status, "feasible");
  assert.ok(plan.days.every((day) => day.totalServings === 200));
  assert.ok(plan.days.every((day) => day.items.find((item) => item.vegetarian).servings === 70));
});

test("a one-person plan still serves its required vegetarian portion", () => {
  const scenario = normalizeScenario({ attendance: 1, vegetarianShare: 0.35 });
  const plan = generatePlan(scenario);
  assert.equal(plan.status, "feasible");
  assert.ok(plan.days.every((day) => day.totalServings === 1));
  assert.ok(plan.days.every((day) => day.items.length === 1 && day.items[0].vegetarian && day.items[0].servings === 1));
  assert.deepEqual(verifyPlan(plan, scenario), { valid: true, errors: [] });
});

test("plan verification enforces the configured vegetarian share", () => {
  const scenario = normalizeScenario({ attendance: 200 });
  const plan = generatePlan(scenario);
  const vegetarian = plan.days[0].items.find((item) => item.vegetarian);
  const flexible = plan.days[0].items.find((item) => !item.vegetarian);
  vegetarian.servings -= 1;
  flexible.servings += 1;
  const result = verifyPlan(plan, scenario);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("vegetarian serving share")));
});

test("plan verification independently checks excluded ingredients and unavailable equipment", () => {
  const ingredientScenario = normalizeScenario({ ingredientExclusions: ["chicken"] });
  const ingredientPlan = structuredClone(generatePlan(demo));
  const chickenRecipe = RECIPES.find((recipe) => recipe.id === "chicken-donburi");
  replaceMealRecipe(ingredientPlan.days[0].items.find((item) => !item.vegetarian), chickenRecipe, ingredientScenario);
  const ingredientResult = verifyPlan(ingredientPlan, ingredientScenario);
  assert.ok(ingredientResult.errors.some((error) => error.includes("excluded ingredient")));

  const equipmentScenario = normalizeScenario({ equipment: ["stovetop", "rice cooker"] });
  const equipmentPlan = structuredClone(generatePlan(demo));
  const ovenRecipe = RECIPES.find((recipe) => recipe.vegetarian && recipe.equipment.includes("oven"));
  replaceMealRecipe(equipmentPlan.days[0].items.find((item) => item.vegetarian), ovenRecipe, equipmentScenario);
  const equipmentResult = verifyPlan(equipmentPlan, equipmentScenario);
  assert.ok(equipmentResult.errors.some((error) => error.includes("unavailable kitchen equipment")));
});

test("verification recomputes attendance and cost instead of trusting reported totals", () => {
  const plan = structuredClone(generatePlan(demo));
  plan.days[0].items[0].servings += 1;
  plan.days[0].totalCost = 0;
  const result = verifyPlan(plan, demo);
  assert.ok(result.errors.some((error) => error.includes("does not cover planned attendance")));
  assert.ok(result.errors.some((error) => error.includes("incorrect daily cost total")));
});

test("procurement rejects stale or edited ingredient details", () => {
  const plan = structuredClone(generatePlan(demo));
  const item = plan.days[0].items[0];
  item.ingredients[Object.keys(item.ingredients)[0]] = 0;
  assert.throws(() => calculateShoppingList(plan, demo), /Cannot calculate procurement from an invalid plan/);
});

test("verification and procurement reject plans not marked feasible", () => {
  const plan = structuredClone(generatePlan(demo));
  plan.status = "infeasible";
  const result = verifyPlan(plan, demo);
  assert.ok(result.errors.includes("The plan is not marked feasible."));
  assert.throws(() => calculateShoppingList(plan, demo), /Cannot calculate procurement from an invalid plan/);
});

test("verification rejects an identical daily menu repeated across weekdays", () => {
  const plan = structuredClone(generatePlan(demo));
  plan.days[1].items = structuredClone(plan.days[0].items);
  plan.days[1].totalCost = plan.days[0].totalCost;
  plan.totalCost = plan.days.reduce((sum, day) => sum + day.totalCost, 0);
  const result = verifyPlan(plan, demo);
  assert.ok(result.errors.some((error) => error.includes("repeats an identical daily menu")));
});

test("invalid stock and price multiplier values are normalized safely", () => {
  const scenario = normalizeScenario({ inventory: { rice: Infinity, chickpeas: 5 }, priceMultipliers: { chicken: Infinity, rice: 0 } });
  assert.equal(scenario.inventory.rice, 0);
  assert.equal(scenario.inventory.chickpeas, 5);
  assert.equal(scenario.priceMultipliers.chicken, 1);
  assert.equal(scenario.priceMultipliers.rice, 0);
});

test("procurement totals ingredient requirements and nets available stock", () => {
  const plan = generatePlan(demo);
  const emptyStock = calculateShoppingList(plan, demo);
  const withStock = calculateShoppingList(plan, normalizeScenario({ inventory: { rice: 999 } }));
  const rice = emptyStock.find((line) => line.key === "rice");
  const stockedRice = withStock.find((line) => line.key === "rice");
  assert.ok(rice.required > 0);
  assert.equal(rice.buy, rice.required);
  assert.equal(stockedRice.buy, 0);
  assert.ok(stockedRice.onHand > 0);
});

test("ingredient cost math applies price changes deterministically", () => {
  const chicken = RECIPES.find((recipe) => recipe.id === "chicken-donburi");
  const before = recipeCostPerServing(chicken);
  const after = recipeCostPerServing(chicken, { chicken: 1.2 });
  assert.ok(after > before);
  assert.equal(Math.round((after - before) * 100), Math.round(chicken.ingredients.chicken * INGREDIENTS.chicken.price * 0.2 * 100));
});

test("comparison summary reports catalog coverage, not a Qloo affinity score", () => {
  const plan = generatePlan(demo, { signal: sampleSignal("eastAsian") });
  assert.equal(plan.status, "feasible");
  const summary = summarizePlan(plan);
  assert.equal(summary.dishCount, 10);
  assert.ok(summary.cuisineCount > 0);
  assert.ok(summary.signalCovered >= 0 && summary.signalCovered <= 10);
  assert.deepEqual(Object.keys(SAMPLE_PROFILES).sort(), ["campus", "eastAsian", "latin", "mediterranean"]);
});

test("planning weights are configurable and normalized to one hundred", () => {
  const plan = generatePlan(demo, { signal: sampleSignal("campus"), weights: { tasteSignal: 5, explicitPreference: 0, affordability: 0, preparation: 0 } });
  assert.equal(plan.status, "feasible");
  assert.deepEqual(plan.weights, { tasteSignal: 100, explicitPreference: 0, affordability: 0, preparation: 0 });
});

function replaceMealRecipe(item, recipe, scenario) {
  const costPerServing = recipeCostPerServing(recipe, scenario.priceMultipliers);
  Object.assign(item, {
    recipeId: recipe.id,
    name: recipe.name,
    cuisine: recipe.cuisine,
    vegetarian: recipe.vegetarian,
    allergens: [...recipe.allergens],
    ingredients: { ...recipe.ingredients },
    costPerServing: Math.round(costPerServing * 100) / 100,
    cost: Math.round(costPerServing * item.servings * 100) / 100,
  });
}
