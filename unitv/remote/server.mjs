import http from "node:http";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createAdb } from "./adb.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 4096;

function sameToken(given, expected) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    // Oversized bodies are drained and refused, so the client still gets a
    // 400 instead of a dropped connection.
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY) return reject(new RangeError("body too large"));
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {});
      } catch {
        reject(new RangeError("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function routes(adb) {
  return {
    "GET /api/status": () => adb.status(),
    "GET /api/apps": async () => ({ apps: await adb.apps() }),
    "POST /api/connect": async ({ host }) => ({
      message: await adb.connect(host),
    }),
    "POST /api/key": async ({ key }) => {
      await adb.key(key);
      return { ok: true };
    },
    "POST /api/text": async ({ text }) => {
      await adb.text(text);
      return { ok: true };
    },
    "POST /api/launch": async ({ package: pkg }) => {
      await adb.launch(pkg);
      return { ok: true };
    },
  };
}

export function createServer({ adb, token, html }) {
  const table = routes(adb);

  return http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url, "http://localhost");

    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }

    const handler = table[`${request.method} ${pathname}`];
    if (!handler) return send(response, 404, { error: "not found" });
    if (!sameToken(request.headers["x-token"], token)) {
      return send(response, 401, { error: "invalid token" });
    }

    try {
      const body = request.method === "POST" ? await readJson(request) : {};
      send(response, 200, await handler(body));
    } catch (error) {
      const status = error instanceof RangeError ? 400 : 502;
      send(response, status, { error: error.message });
    }
  });
}

// The token survives restarts so the bookmark on the phone keeps working.
function loadToken() {
  if (process.env.UNITV_TOKEN) return process.env.UNITV_TOKEN;
  const file = join(here, ".token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const token = randomBytes(12).toString("hex");
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface.address);
}

async function main() {
  const port = Number(process.env.PORT ?? 8787);
  const token = loadToken();
  const adb = createAdb({ adbPath: process.env.ADB_PATH ?? "adb" });
  const html = readFileSync(join(here, "public", "index.html"), "utf8");

  const host = process.env.UNITV_HOST ?? process.argv[2];
  if (host) {
    try {
      console.log(await adb.connect(host));
    } catch (error) {
      console.error(`Could not connect to ${host}: ${error.message}`);
    }
  }

  createServer({ adb, token, html }).listen(port, "0.0.0.0", () => {
    console.log("\nOpen on your phone (same Wi-Fi):");
    for (const address of lanAddresses()) {
      console.log(`  http://${address}:${port}/#t=${token}`);
    }
    console.log("");
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
