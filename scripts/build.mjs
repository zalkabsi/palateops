import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "dist");
const assetPaths = [
  ["index.html", "/index.html", "text/html; charset=utf-8"],
  ["styles.css", "/styles.css", "text/css; charset=utf-8"],
  ["favicon.svg", "/favicon.svg", "image/svg+xml"],
  ["src/app.js", "/src/app.js", "text/javascript; charset=utf-8"],
  ["src/planner.js", "/src/planner.js", "text/javascript; charset=utf-8"],
  ["src/recipes.js", "/src/recipes.js", "text/javascript; charset=utf-8"],
  ["src/qloo.js", "/src/qloo.js", "text/javascript; charset=utf-8"],
  ["src/agent.js", "/src/agent.js", "text/javascript; charset=utf-8"],
];

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
const assets = {};
for (const [source, url, type] of assetPaths) {
  assets[url] = { content: await readFile(resolve(root, source), "utf8"), type };
}
const workerTemplate = await readFile(resolve(root, "worker/index.js"), "utf8");
const builtWorker = workerTemplate.replace("__ASSETS__", JSON.stringify(assets));
if (builtWorker.includes("__ASSETS__")) throw new Error("Worker asset replacement was incomplete.");
await writeFile(resolve(dist, "server/index.js"), builtWorker);
await cp(resolve(root, ".openai/hosting.json"), resolve(dist, ".openai/hosting.json"));
console.log("Built worker and " + assetPaths.length + " web assets into dist/.");
