import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = resolve(root, relative);
    if (!file.startsWith(root + "/")) throw new Error("invalid path");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log("PalateOps preview listening on http://localhost:" + (process.env.PORT || 4173));
});
