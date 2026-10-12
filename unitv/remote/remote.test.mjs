import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAdb,
  isValidPackage,
  parseActivityPackages,
  toInputTextCommand,
} from "./adb.mjs";
import { createServer } from "./server.mjs";

test("quotes typed text for the device shell", () => {
  assert.equal(toInputTextCommand("ola mundo"), "input text 'ola%smundo'");
  assert.equal(
    toInputTextCommand("it's; reboot"),
    "input text 'it'\\''s;%sreboot'",
  );
  assert.equal(toInputTextCommand("ação $(id)"), "input text 'acao%s$(id)'");
  assert.throws(() => toInputTextCommand("   "), RangeError);
});

test("accepts only package-shaped names", () => {
  assert.ok(isValidPackage("com.netflix.ninja"));
  assert.ok(!isValidPackage("netflix"));
  assert.ok(!isValidPackage("com.x; reboot"));
  assert.ok(!isValidPackage("com.x -c foo"));
});

test("parses packages from query-activities output", () => {
  const brief = [
    "3 activities found:",
    "  Activity #0:",
    "    com.netflix.ninja/.MainActivity",
    "  Activity #1:",
    "    com.android.tv.settings/com.android.tv.settings.MainSettings",
  ].join("\n");
  assert.deepEqual(parseActivityPackages(brief), [
    "com.android.tv.settings",
    "com.netflix.ninja",
  ]);
  assert.deepEqual(parseActivityPackages("packageName=org.videolan.vlc"), [
    "org.videolan.vlc",
  ]);
});

// Fake adb: logs each argv as a JSON line and prints canned output.
const FAKE_ADB = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(args) + "\\n");
const cmd = args.join(" ");
const offlineFlag = process.env.FAKE_ADB_OFFLINE;
if (args.includes("shell") && offlineFlag && fs.existsSync(offlineFlag)) {
  fs.unlinkSync(offlineFlag);
  console.error("error: device offline");
  process.exit(1);
} else if (args.includes("forward")) {
  if (!process.env.FAKE_MONKEY_PORT) {
    console.error("error: cannot bind listener");
    process.exit(1);
  }
  console.log(process.env.FAKE_MONKEY_PORT);
} else if (cmd.includes("monkey --port")) {
  // Stand-in for monkey's network mode: one command per line, OK replies.
  const server = require("node:net").createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        fs.appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(["monkey", line]) + "\\n");
        if (line === "quit") { socket.end("OK\\n"); process.exit(0); }
        socket.write(line.startsWith("getvar") ? "OK:10\\n" : "OK\\n");
      }
    });
  });
  server.listen(Number(process.env.FAKE_MONKEY_PORT), "127.0.0.1");
} else if (args[0] === "disconnect") {
  console.log("disconnected " + args[1]);
} else if (args[0] === "connect") {
  console.log("connected to " + args[1]);
} else if (cmd.includes("getprop")) {
  console.log("UniTV\\nBox X\\n9");
} else if (cmd.includes("LEANBACK_LAUNCHER") && cmd.includes("query-activities")) {
  console.log("  com.netflix.ninja/.Main");
} else if (cmd.includes("query-activities")) {
  console.log("  com.android.tv.settings/.Main");
} else if (cmd.includes("monkey") && cmd.includes("com.missing.app")) {
  console.log("** No activities found to run, monkey aborted.");
}
`;

let dir;
let log;
let server;
let base;
const TOKEN = "test-token";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "unitv-"));
  log = join(dir, "log");
  writeFileSync(log, "");
  const adbPath = join(dir, "adb");
  writeFileSync(adbPath, FAKE_ADB);
  chmodSync(adbPath, 0o755);
  process.env.FAKE_ADB_LOG = log;
  process.env.FAKE_ADB_OFFLINE = join(dir, "offline");
  server = createServer({
    adb: createAdb({ adbPath, fastKeys: false }),
    token: TOKEN,
    html: "<p>ok</p>",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (method, path, body, token = TOKEN) =>
  fetch(base + path, {
    method,
    headers: { "x-token": token, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const lastCall = () => {
  const lines = readFileSync(log, "utf8").trim().split("\n");
  return JSON.parse(lines.at(-1));
};

test("serves the page without a token", async () => {
  const response = await fetch(base + "/");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<p>ok</p>");
});

test("rejects API calls without the right token", async () => {
  assert.equal((await call("GET", "/api/status", null, "nope")).status, 401);
  assert.equal((await call("GET", "/api/status", null, "")).status, 401);
});

test("connects and then targets that device", async () => {
  const response = await call("POST", "/api/connect", { host: "192.168.0.50" });
  assert.equal(response.status, 200);
  assert.deepEqual(lastCall(), ["connect", "192.168.0.50:5555"]);

  const status = await (await call("GET", "/api/status")).json();
  assert.deepEqual(status, {
    serial: "192.168.0.50:5555",
    manufacturer: "UniTV",
    model: "Box X",
    android: "9",
  });
});

test("rejects a malformed host", async () => {
  const response = await call("POST", "/api/connect", { host: "1.2.3.4;id" });
  assert.equal(response.status, 400);
});

test("sends key presses as keyevents", async () => {
  assert.equal((await call("POST", "/api/key", { key: "up" })).status, 200);
  assert.deepEqual(lastCall(), [
    "-s",
    "192.168.0.50:5555",
    "shell",
    "input keyevent KEYCODE_DPAD_UP",
  ]);
  assert.equal((await call("POST", "/api/key", { key: "reboot" })).status, 400);
});

test("reconnects once when the box drops off the network", async () => {
  writeFileSync(log, "");
  writeFileSync(process.env.FAKE_ADB_OFFLINE, "");
  const response = await call("POST", "/api/key", { key: "home" });
  assert.equal(response.status, 200);
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const retry = [
    "-s",
    "192.168.0.50:5555",
    "shell",
    "input keyevent KEYCODE_HOME",
  ];
  assert.deepEqual(calls, [
    retry,
    ["disconnect", "192.168.0.50:5555"],
    ["connect", "192.168.0.50:5555"],
    retry,
  ]);
});

test("types text quoted for the device shell", async () => {
  await call("POST", "/api/text", { text: "a'b c" });
  assert.equal(lastCall()[3], "input text 'a'\\''b%sc'");
});

test("launches valid packages and reports missing ones", async () => {
  const ok = await call("POST", "/api/launch", {
    package: "com.netflix.ninja",
  });
  assert.equal(ok.status, 200);
  assert.match(lastCall()[3], /^monkey -p com\.netflix\.ninja /);

  const bad = await call("POST", "/api/launch", { package: "x; reboot" });
  assert.equal(bad.status, 400);

  const missing = await call("POST", "/api/launch", {
    package: "com.missing.app",
  });
  assert.equal(missing.status, 502);
});

test("lists TV and phone launcher apps", async () => {
  const { apps } = await (await call("GET", "/api/apps")).json();
  assert.deepEqual(apps, ["com.android.tv.settings", "com.netflix.ninja"]);
});

test("rejects oversized and invalid bodies", async () => {
  const big = await call("POST", "/api/text", { text: "x".repeat(5000) });
  assert.equal(big.status, 400);
  const invalid = await fetch(base + "/api/key", {
    method: "POST",
    headers: { "x-token": TOKEN },
    body: "{not json",
  });
  assert.equal(invalid.status, 400);
});

const readCalls = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

test("sends keys through a persistent monkey channel", async () => {
  writeFileSync(log, "");
  process.env.FAKE_MONKEY_PORT = String(await freePort());
  const adb = createAdb({ adbPath: join(dir, "adb") });
  try {
    await adb.connect("10.0.0.9");
    await adb.key("up");
    await adb.key("ok");
  } finally {
    adb.close();
    delete process.env.FAKE_MONKEY_PORT;
  }
  // close() sends "quit" without waiting for monkey to process it.
  const monkeyLines = () =>
    readCalls()
      .filter((c) => c[0] === "monkey")
      .map((c) => c[1]);
  for (let i = 0; i < 40 && !monkeyLines().includes("quit"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const calls = readCalls();
  const monkey = monkeyLines();
  assert.deepEqual(monkey.slice(-3), [
    "press KEYCODE_DPAD_UP",
    "press KEYCODE_DPAD_CENTER",
    "quit",
  ]);
  assert.equal(
    calls.filter((c) => c.includes("forward")).length,
    1,
    "the channel is opened once and reused",
  );
  assert.ok(!calls.some((c) => String(c.at(-1)).startsWith("input keyevent")));
});

test("falls back to input keyevent when monkey is unavailable", async () => {
  writeFileSync(log, "");
  const adb = createAdb({ adbPath: join(dir, "adb") });
  await adb.connect("10.0.0.9");
  await adb.key("up");
  await adb.key("down");
  const calls = readCalls();
  assert.equal(calls.filter((c) => c.includes("forward")).length, 1);
  assert.deepEqual(
    calls.filter((c) => c[2] === "shell").map((c) => c[3]),
    ["input keyevent KEYCODE_DPAD_UP", "input keyevent KEYCODE_DPAD_DOWN"],
  );
});
