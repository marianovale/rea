import { execFile, spawn } from "node:child_process";
import net from "node:net";

// Friendly button names the phone UI sends, mapped to Android key codes.
export const KEYS = Object.freeze({
  up: "KEYCODE_DPAD_UP",
  down: "KEYCODE_DPAD_DOWN",
  left: "KEYCODE_DPAD_LEFT",
  right: "KEYCODE_DPAD_RIGHT",
  ok: "KEYCODE_DPAD_CENTER",
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  menu: "KEYCODE_MENU",
  recents: "KEYCODE_APP_SWITCH",
  settings: "KEYCODE_SETTINGS",
  search: "KEYCODE_SEARCH",
  info: "KEYCODE_INFO",
  guide: "KEYCODE_GUIDE",
  power: "KEYCODE_POWER",
  // Screen off and on without toggling, so a voice command cannot invert it.
  sleep: "KEYCODE_SLEEP",
  wakeup: "KEYCODE_WAKEUP",
  volup: "KEYCODE_VOLUME_UP",
  voldown: "KEYCODE_VOLUME_DOWN",
  mute: "KEYCODE_VOLUME_MUTE",
  chup: "KEYCODE_CHANNEL_UP",
  chdown: "KEYCODE_CHANNEL_DOWN",
  playpause: "KEYCODE_MEDIA_PLAY_PAUSE",
  rewind: "KEYCODE_MEDIA_REWIND",
  forward: "KEYCODE_MEDIA_FAST_FORWARD",
  prev: "KEYCODE_MEDIA_PREVIOUS",
  next: "KEYCODE_MEDIA_NEXT",
  enter: "KEYCODE_ENTER",
  del: "KEYCODE_DEL",
});

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const MAX_TEXT = 200;
const MONKEY_PORT = 1080;
const LOST_DEVICE_RE =
  /offline|not found|no devices|closed|connection reset|broken pipe/i;

export function isValidPackage(name) {
  return (
    typeof name === "string" && name.length <= 255 && PACKAGE_RE.test(name)
  );
}

export function isValidHost(host) {
  return typeof host === "string" && host.length <= 255 && HOST_RE.test(host);
}

// `adb shell` joins its arguments into one command line for the device's
// shell, so user text must be quoted for that shell. `input text` only types
// ASCII and reads "%s" as a space, so accents are stripped first.
function toAsciiText(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const ascii = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, MAX_TEXT);
  if (ascii.trim() === "") throw new RangeError("text is empty");
  return ascii;
}

export function toInputTextCommand(text) {
  const quoted = toAsciiText(text).replace(/ /g, "%s").replace(/'/g, "'\\''");
  return `input text '${quoted}'`;
}

// Monkey's `type` takes one space-free word per command and its parser
// treats quotes specially, so words are sent one by one with SPACE presses
// between them, and text with quotes or backslashes returns null so the
// caller uses `input text` instead.
export function toMonkeyTypeCommands(text) {
  const ascii = toAsciiText(text);
  if (/["'\\]/.test(ascii)) return null;
  const commands = [];
  ascii.split(" ").forEach((word, index) => {
    if (index > 0) commands.push("press KEYCODE_SPACE");
    if (word) commands.push(`type ${word}`);
  });
  return commands;
}

// Collects package names from `cmd package query-activities` output, which
// lists components as "pkg/.Activity" or as "packageName=pkg" lines.
export function parseActivityPackages(output) {
  const found = new Set();
  for (const match of output.matchAll(
    /([A-Za-z][\w]*(?:\.[\w]+)+)\/[\w.$]+/g,
  )) {
    found.add(match[1]);
  }
  for (const match of output.matchAll(/packageName=([\w.]+)/g)) {
    found.add(match[1]);
  }
  return [...found].filter(isValidPackage).sort();
}

export function parsePackageList(output) {
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^package:/, ""))
    .filter(isValidPackage)
    .sort();
}

const LAUNCHER_CATEGORIES = [
  "android.intent.category.LEANBACK_LAUNCHER",
  "android.intent.category.LAUNCHER",
];

// Opens a line-based connection to `monkey --port`, the input injector that
// ships with Android. It stays running on the box, so each key costs one
// socket round trip instead of starting `input` (a fresh JVM) per press.
async function openMonkeyChannel({ adbPath, serialArgs, exec, timeoutMs }) {
  const forwarded = (
    await exec([...serialArgs, "forward", "tcp:0", `tcp:${MONKEY_PORT}`])
  ).trim();
  const localPort = Number(forwarded);
  if (!Number.isInteger(localPort) || localPort <= 0) {
    throw new Error(`adb forward failed: ${forwarded}`);
  }
  const child = spawn(
    adbPath,
    [...serialArgs, "shell", `monkey --port ${MONKEY_PORT}`],
    { stdio: "ignore" },
  );
  child.on("error", () => {});

  // adb accepts on the local port before monkey listens on the box, so a
  // channel only counts as open once monkey answers a command.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const channel = await connectLineChannel(localPort, timeoutMs);
      await channel.send("getvar build.version.release");
      // Give monkey a moment to act on "quit" before stopping its session.
      channel.onClose(() => setTimeout(() => child.kill(), 1000).unref());
      return channel;
    } catch (error) {
      if (Date.now() > deadline || child.exitCode !== null) {
        child.kill();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

function connectLineChannel(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buffer = "";
    let pending = null;
    let closed = false;
    const closeHandlers = [];

    const fail = (error, farewell) => {
      if (closed) return;
      closed = true;
      if (farewell) socket.end(farewell);
      else socket.destroy();
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      pending = null;
      for (const handler of closeHandlers) handler();
    };

    socket.setNoDelay(true);
    socket.on("error", (error) => {
      fail(error);
      reject(error);
    });
    socket.on("close", () => fail(new Error("monkey connection closed")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const current = pending;
        pending = null;
        if (!current) continue;
        clearTimeout(current.timer);
        if (line.startsWith("OK")) current.resolve(line);
        else current.reject(new Error(`monkey: ${line}`));
      }
    });
    socket.on("connect", () =>
      resolve({
        send(command) {
          if (closed) return Promise.reject(new Error("monkey closed"));
          return new Promise((resolveSend, rejectSend) => {
            const timer = setTimeout(
              () => fail(new Error("monkey timed out")),
              timeoutMs,
            );
            pending = { resolve: resolveSend, reject: rejectSend, timer };
            socket.write(`${command}\n`);
          });
        },
        onClose(handler) {
          closeHandlers.push(handler);
        },
        close() {
          fail(new Error("monkey closed"), "quit\n");
        },
      }),
    );
  });
}

// Uses the fast monkey channel when it is available and falls back to
// `input keyevent`. A box where monkey cannot start is retried a minute
// later instead of on every press.
function createFastKeys({ adbPath, exec, enabled, timeoutMs }) {
  let channel = null;
  let retryAt = 0;

  const close = () => {
    channel?.close();
    channel = null;
  };

  return {
    close,
    retryNow() {
      retryAt = 0;
    },
    // Sends the commands in order. Returns false when nothing reached the
    // box, so the caller can fall back; throws when only part was sent,
    // because repeating it another way would duplicate input.
    async send(commands, serialArgs) {
      if (!enabled || Date.now() < retryAt) return false;
      let sent = 0;
      try {
        if (!channel) {
          channel = await openMonkeyChannel({
            adbPath,
            serialArgs,
            exec,
            timeoutMs,
          });
          channel.onClose(() => {
            channel = null;
          });
        }
        for (const command of commands) {
          await channel.send(command);
          sent += 1;
        }
        return true;
      } catch (error) {
        close();
        retryAt = Date.now() + 60_000;
        if (sent > 0) {
          throw new Error(
            `input interrupted after ${sent} steps: ${error.message}`,
          );
        }
        return false;
      }
    },
  };
}

async function listLauncherApps(shell) {
  const found = new Set();
  for (const category of LAUNCHER_CATEGORIES) {
    try {
      const output = await shell(
        `cmd package query-activities --brief -a android.intent.action.MAIN -c ${category}`,
      );
      for (const pkg of parseActivityPackages(output)) found.add(pkg);
    } catch {
      // Older Android lacks `cmd package`; fall back to pm below.
    }
  }
  if (found.size === 0) {
    for (const pkg of parsePackageList(await shell("pm list packages -3"))) {
      found.add(pkg);
    }
  }
  return [...found].sort();
}

function createExec(adbPath, timeoutMs) {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        adbPath,
        args,
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message).trim()));
          } else {
            resolve(stdout);
          }
        },
      );
    });
}

export function createAdb({
  adbPath = "adb",
  timeoutMs = 8000,
  fastKeys = true,
} = {}) {
  let serial = null;
  // Commands run one at a time so key presses reach the box in order.
  let queue = Promise.resolve();

  const exec = createExec(adbPath, timeoutMs);

  // Network adb drops when the box sleeps or Wi-Fi blips, leaving a stale
  // "offline" entry; drop it, reconnect, and retry the command once.
  const execWithReconnect = async (args) => {
    try {
      return await exec(args);
    } catch (error) {
      if (!serial || !LOST_DEVICE_RE.test(error.message)) throw error;
      await exec(["disconnect", serial]).catch(() => {});
      await exec(["connect", serial]).catch(() => {});
      return exec(args);
    }
  };

  const serialArgs = () => (serial ? ["-s", serial] : []);

  const enqueue = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  const shell = (command) =>
    enqueue(() => execWithReconnect([...serialArgs(), "shell", command]));

  const fast = createFastKeys({
    adbPath,
    exec,
    enabled: fastKeys,
    timeoutMs: Math.min(timeoutMs, 6000),
  });

  return {
    get serial() {
      return serial;
    },

    async connect(host) {
      if (!isValidHost(host)) throw new RangeError("invalid host");
      const target = host.includes(":") ? host : `${host}:5555`;
      const output = (await exec(["connect", target])).trim();
      if (!/connected to/i.test(output)) throw new Error(output);
      if (serial !== target) fast.close();
      serial = target;
      fast.retryNow();
      return output;
    },

    close() {
      fast.close();
    },

    async status() {
      const output = await shell(
        "getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release",
      );
      const [manufacturer = "", model = "", android = ""] = output
        .split("\n")
        .map((line) => line.trim());
      return { serial, manufacturer, model, android };
    },

    key(name) {
      const code = KEYS[name];
      if (!code) throw new RangeError(`unknown key: ${name}`);
      return enqueue(async () => {
        if (await fast.send([`press ${code}`], serialArgs())) return;
        await execWithReconnect([
          ...serialArgs(),
          "shell",
          `input keyevent ${code}`,
        ]);
      });
    },

    text(value) {
      const typed = toMonkeyTypeCommands(value);
      const fallback = toInputTextCommand(value);
      return enqueue(async () => {
        if (typed && (await fast.send(typed, serialArgs()))) return;
        await execWithReconnect([...serialArgs(), "shell", fallback]);
      });
    },

    async launch(pkg) {
      if (!isValidPackage(pkg)) throw new RangeError("invalid package");
      const categories = LAUNCHER_CATEGORIES.map((c) => `-c ${c}`).join(" ");
      const output = await shell(`monkey -p ${pkg} ${categories} 1 2>&1`);
      if (/monkey aborted|No activities found/i.test(output)) {
        throw new Error(`${pkg} has no launchable activity`);
      }
    },

    apps() {
      return listLauncherApps(shell);
    },
  };
}
