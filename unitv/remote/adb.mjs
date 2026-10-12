import { execFile } from "node:child_process";

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
export function toInputTextCommand(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const ascii = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, MAX_TEXT);
  if (ascii.trim() === "") throw new RangeError("text is empty");
  const quoted = ascii.replace(/ /g, "%s").replace(/'/g, "'\\''");
  return `input text '${quoted}'`;
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

export function createAdb({ adbPath = "adb", timeoutMs = 8000 } = {}) {
  let serial = null;
  // Commands run one at a time so key presses reach the box in order.
  let queue = Promise.resolve();

  const exec = (args) =>
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

  const shell = (command) => {
    const args = serial ? ["-s", serial, "shell", command] : ["shell", command];
    const result = queue.then(() => execWithReconnect(args));
    queue = result.catch(() => {});
    return result;
  };

  return {
    get serial() {
      return serial;
    },

    async connect(host) {
      if (!isValidHost(host)) throw new RangeError("invalid host");
      const target = host.includes(":") ? host : `${host}:5555`;
      const output = (await exec(["connect", target])).trim();
      if (!/connected to/i.test(output)) throw new Error(output);
      serial = target;
      return output;
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
      return shell(`input keyevent ${code}`);
    },

    text(value) {
      return shell(toInputTextCommand(value));
    },

    async launch(pkg) {
      if (!isValidPackage(pkg)) throw new RangeError("invalid package");
      const categories = LAUNCHER_CATEGORIES.map((c) => `-c ${c}`).join(" ");
      const output = await shell(`monkey -p ${pkg} ${categories} 1 2>&1`);
      if (/monkey aborted|No activities found/i.test(output)) {
        throw new Error(`${pkg} has no launchable activity`);
      }
    },

    async apps() {
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
        for (const pkg of parsePackageList(
          await shell("pm list packages -3"),
        )) {
          found.add(pkg);
        }
      }
      return [...found].sort();
    },
  };
}
