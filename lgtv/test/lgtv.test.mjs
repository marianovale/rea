import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { get as httpGet } from 'node:http';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { buildIpk, iconPng, hasAudioTrack } from '../build.mjs';

// Loaded as the TV browser loads it: a classic script defining a global.
const browser = {};
runInNewContext(readFileSync(new URL('../app/nav.js', import.meta.url), 'utf8'), browser);
const { Nav } = browser;

function readAr(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('ascii'), '!<arch>\n');
  const members = [];
  let offset = 8;
  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + 60).toString('ascii');
    assert.equal(header.slice(58, 60), '`\n', 'ar member header terminator');
    const name = header.slice(0, 16).trim();
    const size = Number(header.slice(48, 58).trim());
    const start = offset + 60;
    members.push({ name, data: buffer.subarray(start, start + size) });
    offset = start + size + (size % 2);
  }
  return members;
}

function readTarGz(buffer) {
  const tar = gunzipSync(buffer);
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii'), 8);
    const stored = parseInt(header.subarray(148, 156).toString('ascii'), 8);
    const copy = Buffer.from(header);
    copy.fill(0x20, 148, 156);
    assert.equal(copy.reduce((s, b) => s + b, 0), stored, `tar checksum of ${name}`);
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test('the ipk has the webOS layout for the app, its root service and packageinfo', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'lgtv-'));
  try {
    const { path, appId, serviceId } = buildIpk({ outDir, mtime: 1700000000 });
    const members = readAr(readFileSync(path));
    assert.deepEqual(members.map((m) => m.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    assert.equal(members[0].data.toString(), '2.0\n');

    const control = readTarGz(members[1].data).get('./control').toString();
    assert.match(control, new RegExp(`^Package: ${appId}$`, 'm'));
    assert.match(control, /^Architecture: all$/m);

    const data = readTarGz(members[2].data);
    const app = `./usr/palm/applications/${appId}/`;
    for (const file of ['appinfo.json', 'index.html', 'app.js', 'nav.js', 'tiles.js', 'theme.js', 'custom.js', 'config.js', 'style.css',
      'themes/diablo4/theme.js', 'themes/noite/theme.js', 'icon.png', 'largeIcon.png']) {
      assert.ok(data.has(app + file), `missing ${file}`);
    }
    const appinfo = JSON.parse(data.get(app + 'appinfo.json'));
    assert.equal(appinfo.id, appId);

    const service = `./usr/palm/services/${serviceId}/`;
    assert.ok(serviceId.startsWith(appId + '.'));
    assert.ok(data.has(service + 'service.js'));
    assert.equal(JSON.parse(data.get(service + 'services.json')).services[0].name, serviceId);

    const info = JSON.parse(data.get(`./usr/palm/packages/${appId}/packageinfo.json`));
    assert.equal(info.app, appId);
    assert.deepEqual(info.services, [serviceId]);
    assert.equal(info.version, appinfo.version);

    // Parent directories come before their files.
    const names = [...data.keys()];
    for (const name of names) {
      const parent = name.replace(/[^/]+\/?$/, '');
      if (parent !== './') assert.ok(names.indexOf(parent) < names.indexOf(name), `${parent} before ${name}`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('generated icons are valid RGBA PNGs of the requested size', () => {
  for (const size of [80, 130]) {
    const png = iconPng(size);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    const idatLength = png.readUInt32BE(33);
    assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    assert.equal(raw.length, (size * 4 + 1) * size);
  }
});

// Two rows: a favorites row of 3 wide tiles, then a grid of 5 per row.
function layout() {
  const rects = [];
  for (let i = 0; i < 3; i++) rects.push({ left: 100 + i * 344, top: 100, width: 320, height: 220 });
  for (let i = 0; i < 8; i++) {
    rects.push({ left: 100 + (i % 5) * 288, top: 400 + Math.floor(i / 5) * 210, width: 264, height: 190 });
  }
  return rects;
}

test('arrows move within a row and stop at its ends', () => {
  const rects = layout();
  assert.equal(Nav.pick(rects, 0, 'right'), 1);
  assert.equal(Nav.pick(rects, 1, 'left'), 0);
  assert.equal(Nav.pick(rects, 0, 'left'), -1);
  assert.equal(Nav.pick(rects, 0, 'up'), -1);
  assert.equal(Nav.pick(rects, 7, 'right'), -1);
  // No apps listed yet (e.g. the service failed): arrows do nothing.
  assert.equal(Nav.pick([], 0, 'right'), -1);
});

test('up and down go to the closest tile in the next row', () => {
  const rects = layout();
  // Favorite 2 (center x 868): grid column 2 (x 808) beats column 3 (x 1096).
  assert.equal(Nav.pick(rects, 2, 'down'), 5);
  assert.equal(Nav.pick(rects, 3, 'down'), 8); // first grid tile -> first of second grid row
  assert.equal(Nav.pick(rects, 8, 'up'), 3);
  assert.equal(Nav.pick(rects, 3, 'up'), 0);
  // Last row has 3 tiles: from grid tile 4 (column 1) down goes to column 1.
  assert.equal(Nav.pick(rects, 4, 'down'), 9);
});

test('every theme folder is valid, loaded by index.html, and the default theme exists', () => {
  const appDir = new URL('../app/', import.meta.url);
  const errors = [];
  const browser = { console: { error: (m) => errors.push(m) } };
  runInNewContext(readFileSync(new URL('theme.js', appDir), 'utf8'), browser);
  runInNewContext(readFileSync(new URL('config.js', appDir), 'utf8'), browser);
  const html = readFileSync(new URL('index.html', appDir), 'utf8');

  const folders = readdirSync(new URL('themes/', appDir));
  assert.ok(folders.length >= 2);
  for (const folder of folders) {
    const script = `themes/${folder}/theme.js`;
    assert.ok(html.includes(`<script src="${script}"></script>`), `index.html must load ${script}`);
    runInNewContext(readFileSync(new URL(script, appDir), 'utf8'), browser);
  }
  assert.deepEqual(errors, []);
  // Array.from: the list comes from the vm context, with its own Array.
  const ids = Array.from(browser.Themes.list(), (t) => t.id);
  assert.deepEqual(ids.slice().sort(), folders.slice().sort(), 'theme id must match its folder');
  assert.ok(browser.Themes.find(browser.CONFIG.theme), `CONFIG.theme ${browser.CONFIG.theme} must exist`);
});

test('a theme missing tokens is rejected with the reasons', () => {
  const errors = [];
  const browser = { console: { error: (m) => errors.push(m) } };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  browser.registerTheme({ id: 'quebrado', name: 'Quebrado', hero: { title: 'x' }, font: {}, backdrop: '#000',
    colors: { background: '#000' } });
  assert.equal(browser.Themes.list().length, 0);
  assert.match(errors[0], /quebrado.*colors\.text/);
});

test('backgrounds: local videos, then local images before online ones', () => {
  const browser = { console };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  const theme = { id: 'x', images: ['https://example.invalid/a.jpg'] };
  const { videos, images } = browser.Themes.backgroundCandidates(theme);
  assert.deepEqual(Array.from(videos), ['themes/x/fundo.mp4', 'themes/x/fundo.webm']);
  assert.deepEqual(Array.from(images), [
    'themes/x/fundo.gif', 'themes/x/fundo.jpg', 'themes/x/fundo.jpeg', 'themes/x/fundo.png',
    'https://example.invalid/a.jpg',
  ]);
});

test('themes list only online images; the local fundo.* file is found by the engine', () => {
  const appDir = new URL('../app/themes/', import.meta.url);
  for (const folder of readdirSync(appDir)) {
    const source = readFileSync(new URL(`${folder}/theme.js`, appDir), 'utf8');
    assert.doesNotMatch(source, /['"][^'"]*fundo\.[a-z0-9]+['"]/, `${folder} should not list its own fundo file`);
  }
});

// Minimal track-handler boxes: size, 'hdlr', version/flags, pre_defined, type.
function hdlr(type) {
  return Buffer.concat([Buffer.from([0, 0, 0, 33]), Buffer.from('hdlr'), Buffer.alloc(8), Buffer.from(type), Buffer.alloc(13)]);
}

test('background videos with an audio track are detected (they would still play muted)', () => {
  assert.equal(hasAudioTrack(Buffer.concat([hdlr('vide'), hdlr('soun')]), 'mp4'), true);
  assert.equal(hasAudioTrack(hdlr('vide'), 'mp4'), false);
  // 'soun' elsewhere in the file is not an audio track.
  assert.equal(hasAudioTrack(Buffer.concat([hdlr('vide'), Buffer.from('soun')]), 'mp4'), false);
  assert.equal(hasAudioTrack(Buffer.from('\x86V_VP9\x86A_OPUS', 'latin1'), 'webm'), true);
  assert.equal(hasAudioTrack(Buffer.from('\x86V_VP9', 'latin1'), 'webm'), false);
  assert.equal(hasAudioTrack(Buffer.from('A_OPUS'), 'gif'), false);
});

test('backgrounds: CONFIG.background picks a specific file per theme', () => {
  const browser = { console, CONFIG: { background: { x: 'escolhido.mp4', y: 'arte.jpg' } } };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  assert.equal(browser.Themes.backgroundCandidates({ id: 'x' }).videos[0], 'themes/x/escolhido.mp4');
  assert.equal(browser.Themes.backgroundCandidates({ id: 'y' }).images[0], 'themes/y/arte.jpg');
  // A theme with no entry keeps the fundo.* convention.
  assert.equal(browser.Themes.backgroundCandidates({ id: 'z' }).videos[0], 'themes/z/fundo.mp4');
});

test('backgrounds: an explicit pick wins and "none" means drawn only', () => {
  const browser = { console, CONFIG: { background: { x: 'padrao.mp4' } } };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  // The on-TV choice (2nd arg) beats the config default.
  assert.equal(browser.Themes.backgroundCandidates({ id: 'x' }, 'escolhido.mp4').videos[0], 'themes/x/escolhido.mp4');
  // 'none' clears every candidate, leaving the drawn backdrop.
  const none = browser.Themes.backgroundCandidates({ id: 'x' }, 'none');
  assert.equal(none.videos.length, 0);
  assert.equal(none.images.length, 0);
  // No choice: the config default still applies.
  assert.equal(browser.Themes.backgroundCandidates({ id: 'x' }).videos[0], 'themes/x/padrao.mp4');
});

test('themes with videos declare matching wallpaper options', () => {
  const browser = { console };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  for (const folder of ['diablo4', 'duna']) {
    runInNewContext(readFileSync(new URL(`../app/themes/${folder}/theme.js`, import.meta.url), 'utf8'), browser);
  }
  for (const theme of browser.Themes.list()) {
    if (!theme.wallpapers) continue;
    for (const w of theme.wallpapers) {
      assert.ok(typeof w.file === 'string' && /\.(mp4|webm)$/.test(w.file), `${theme.id}: ${w.file}`);
      assert.ok(typeof w.name === 'string' && w.name.length, `${theme.id}: name`);
    }
  }
});

// Runs lgtv/tv/home.sh off the TV against a fake luna-send that keeps the
// defaultApps.home setting in a file, like the TV's settings service.
function homeSandbox(initialHome) {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-home-'));
  const bin = join(dir, 'bin');
  const apps = join(dir, 'apps');
  mkdirSync(bin);
  mkdirSync(apps);
  const store = join(dir, 'store');
  writeFileSync(store, initialHome);
  const auto = join(dir, 'auto');
  writeFileSync(auto, 'off');
  writeFileSync(join(bin, 'luna-send'), `#!/bin/sh
case "$3" in
  */getSystemSettings)
    case "$4" in
      *homeAutoLaunch*) printf '{"returnValue":true,"settings":{"homeAutoLaunch":"%s"}}\\n' "$(cat "${auto}")" ;;
      *) printf '{"returnValue":true,"settings":{"defaultApps":{"home":"%s"}}}\\n' "$(cat "${store}")" ;;
    esac ;;
  */setSystemSettings)
    case "$4" in
      *homeAutoLaunch*)
        printf '%s' "$4" | sed -n 's/.*"homeAutoLaunch":"\\([^"]*\\)".*/\\1/p' > "${auto}"
        echo '{"returnValue":true}'; exit 0 ;;
    esac
    v=$(printf '%s' "$4" | sed -n 's/.*"home":"\\([^"]*\\)".*/\\1/p')
    # stuck: claims success but keeps the old value.
    if [ "$STUB_SET_MODE" = stuck ]; then echo '{"returnValue":true}'; exit 0; fi
    printf '%s' "$v" > "${store}"
    # silent: stores the value but prints nothing, as the real TV did over SSH.
    [ "$STUB_SET_MODE" = silent ] || echo '{"returnValue":true}' ;;
esac
`);
  chmodSync(join(bin, 'luna-send'), 0o755);
  const saved = join(dir, 'saved', 'home.orig');
  const savedAuto = join(dir, 'saved', 'autolaunch.orig');
  const script = fileURLToPath(new URL('../tv/home.sh', import.meta.url));
  const run = (cmd, extraEnv = {}) => execFileSync('sh', [script, cmd], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MINHA_TV_HOME_SAVED: saved, MINHA_TV_AUTOLAUNCH_SAVED: savedAuto, MINHA_TV_APPS_DIR: apps, ...extraEnv },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    run,
    home: () => readFileSync(store, 'utf8'),
    auto: () => readFileSync(auto, 'utf8'),
    savedAuto: () => (existsSync(savedAuto) ? readFileSync(savedAuto, 'utf8').trim() : null),
    saved: () => (existsSync(saved) ? readFileSync(saved, 'utf8').trim() : null),
    addLgApp: (id) => mkdirSync(join(apps, id)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('home.sh set saves the original once and restore puts it back', () => {
  const tv = homeSandbox('com.webos.app.fullhome');
  try {
    tv.run('set');
    assert.equal(tv.home(), 'io.github.marianovale.lgtv');
    assert.equal(tv.saved(), 'com.webos.app.fullhome');
    // A reinstall must not overwrite the original with our own id.
    tv.run('set');
    assert.equal(tv.saved(), 'com.webos.app.fullhome');
    assert.match(tv.run('restore'), /devolvido para com\.webos\.app\.fullhome/);
    assert.equal(tv.home(), 'com.webos.app.fullhome');
    assert.equal(tv.saved(), null);
    // Restoring again is harmless when Home is already LG's.
    assert.match(tv.run('restore'), /já é da LG/);
    assert.equal(tv.home(), 'com.webos.app.fullhome');
  } finally {
    tv.cleanup();
  }
});

test('home.sh restore without a saved value falls back to an LG home that exists', () => {
  const withFull = homeSandbox('io.github.marianovale.lgtv');
  const withoutFull = homeSandbox('io.github.marianovale.lgtv');
  try {
    withFull.addLgApp('com.webos.app.fullhome');
    withFull.run('restore');
    assert.equal(withFull.home(), 'com.webos.app.fullhome');
    withoutFull.run('restore');
    assert.equal(withoutFull.home(), 'com.webos.app.home');
  } finally {
    withFull.cleanup();
    withoutFull.cleanup();
  }
});

test('home.sh judges success by reading the setting back, not by the reply text', () => {
  const tv = homeSandbox('com.webos.app.fullhome');
  try {
    // The real TV answered with nothing over SSH; the value still changed.
    assert.match(tv.run('set', { STUB_SET_MODE: 'silent' }), /Botão Home -> Minha TV/);
    assert.equal(tv.home(), 'io.github.marianovale.lgtv');
  } finally {
    tv.cleanup();
  }
  const stuck = homeSandbox('com.webos.app.fullhome');
  try {
    // A reply that says true while the value did not change is a failure.
    assert.throws(() => stuck.run('set', { STUB_SET_MODE: 'stuck' }), (err) => {
      assert.equal(err.status, 1);
      assert.match(String(err.stderr), /não aceitou a mudança/);
      return true;
    });
    assert.equal(stuck.home(), 'com.webos.app.fullhome');
  } finally {
    stuck.cleanup();
  }
});

// Power events recorded on a real UM7520 (webOS 4.10.2): turned off with
// the remote, slept, and turned on with the remote ~15 s later.
const REAL_REMOTE_WAKE = [
  '{ "subscribed": true, "returnValue": true, "state": "Active" }',
  '{ "returnValue": true, "state": "Active", "processing": "Request Power Off" }',
  '{ "returnValue": true, "state": "Active", "processing": "Request Active Standby" }',
  '{ "returnValue": true, "state": "Active", "processing": "Prepare Active Standby" }',
  '{ "returnValue": true, "state": "Active Standby" }',
  '{ "returnValue": true, "state": "Active Standby", "processing": "Request Suspend" }',
  '{ "returnValue": true, "state": "Active Standby", "processing": "Prepare Suspend" }',
  '{ "returnValue": true, "state": "Suspend" }',
  '{ "returnValue": true, "state": "Suspend", "processing": "Prepare Resume" }',
  '{ "returnValue": true, "state": "Suspend", "processing": "LastInput Ready", "powerOnReason": "remoteKey" }',
  '{ "returnValue": true, "state": "Suspend", "processing": "Screen On" }',
  '{ "returnValue": true, "state": "Active" }',
].join('\n') + '\n';

// Loads lgtv/tv/autostart.sh's functions (without starting it) against a
// fake luna-send, feeds power events on stdin, and reports the launches.
function runAutostart(body, { events = '', auto = 'on', home = 'io.github.marianovale.lgtv', front = 'com.webos.app.hdmi3', launchWins = '1' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-auto-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'front'), front);
    writeFileSync(join(dir, 'bin', 'luna-send'), `#!/bin/sh
d="${dir}"
case "$*" in
  *getForegroundAppInfo*) printf '{"appId":"%s","returnValue":true}\\n' "$(cat "$d/front")" ;;
  *applicationManager/launch*)
    echo launch >> "$d/launches"
    if [ "$STUB_LAUNCH_WINS" = 1 ]; then printf '%s' io.github.marianovale.lgtv > "$d/front"; fi
    echo '{"returnValue":true}' ;;
  *homeAutoLaunch*) printf '{"settings":{"homeAutoLaunch":"%s"},"returnValue":true}\\n' "$STUB_AUTO" ;;
  *defaultApps*) printf '{"settings":{"defaultApps":{"home":"%s"}},"returnValue":true}\\n' "$STUB_HOME" ;;
esac
`);
    chmodSync(join(dir, 'bin', 'luna-send'), 0o755);
    const script = fileURLToPath(new URL('../tv/autostart.sh', import.meta.url));
    const out = execFileSync('sh', ['-c', `. "${script}"; ${body}`], {
      input: events,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        MINHA_TV_SOURCE_ONLY: '1',
        MINHA_TV_WAKE_SETTLE: '0',
        MINHA_TV_WAKE_RECHECK: '0',
        STUB_AUTO: auto,
        STUB_HOME: home,
        STUB_LAUNCH_WINS: launchWins,
      },
    });
    const launches = existsSync(join(dir, 'launches'))
      ? readFileSync(join(dir, 'launches'), 'utf8').trim().split('\n').length
      : 0;
    return { out, launches };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('autostart: the real remote wake is detected once, with its reason', () => {
  const { out } = runAutostart('on_wake() { echo "WAKE:$1"; }; detect_wakes', { events: REAL_REMOTE_WAKE });
  // Power-off steps report "Active" too; only Suspend -> Active is a wake.
  assert.equal(out.trim(), 'WAKE:remoteKey');
});

test('autostart: a remote wake opens Minha TV, again if the resumed input won', () => {
  assert.equal(runAutostart('detect_wakes', { events: REAL_REMOTE_WAKE }).launches, 1);
  assert.equal(runAutostart('detect_wakes', { events: REAL_REMOTE_WAKE, launchWins: '0' }).launches, 2);
});

test('autostart: no takeover when home auto launch is off, home is LG, or CEC woke the TV', () => {
  assert.equal(runAutostart('detect_wakes', { events: REAL_REMOTE_WAKE, auto: 'off' }).launches, 0);
  assert.equal(runAutostart('detect_wakes', { events: REAL_REMOTE_WAKE, home: 'com.webos.app.fullhome' }).launches, 0);
  const cecWake = REAL_REMOTE_WAKE.replace('"remoteKey"', '"cecPowerOn"');
  assert.equal(runAutostart('detect_wakes', { events: cecWake }).launches, 0);
});

test('home.sh set turns on home auto launch and restore puts the original back', () => {
  const tv = homeSandbox('com.webos.app.fullhome');
  try {
    assert.match(tv.run('set'), /início automático ligado; antes: off/);
    assert.equal(tv.auto(), 'on');
    assert.equal(tv.savedAuto(), 'off');
    tv.run('set'); // reinstall keeps the first original
    assert.equal(tv.savedAuto(), 'off');
    tv.run('restore');
    assert.equal(tv.auto(), 'off');
    assert.equal(tv.savedAuto(), null);
    assert.equal(tv.home(), 'com.webos.app.fullhome');
  } finally {
    tv.cleanup();
  }
});

// The input manager's devices as read on a real UM7520 (webOS 4.10.2),
// trimmed to the fields that matter: first with the Xbox off, then on.
const EIM_XBOX_OFF = [
  { id: 'AV_1', label: 'AV', activate: false, connected: true, appId: 'com.webos.app.externalinput.av1', icon: 'av.png' },
  { id: 'COMP_1', label: 'Componente', activate: false, connected: false, appId: 'com.webos.app.externalinput.component', icon: 'component.png' },
  { id: 'HDMI_1', label: 'HDMI 1', activate: false, connected: true, appId: 'com.webos.app.hdmi1', icon: 'HDMI_1.png', lastUniqueId: 255, hdmiPlugIn: false },
  { id: 'HDMI_2', label: 'Vivo TV Fibra-IPTV(Minas Gerais)', activate: false, connected: true, appId: 'com.webos.app.hdmi2', icon: 'settopbox.png', lastUniqueId: 255, hdmiPlugIn: false },
  { id: 'HDMI_3', label: 'XBOX', activate: true, connected: true, appId: 'com.webos.app.hdmi3', icon: 'gameconsole.png', lastUniqueId: 255, hdmiPlugIn: true },
  { id: 'HDMI_4', label: 'HDMI 4', activate: true, connected: true, appId: 'com.webos.app.hdmi4', icon: 'HDMI_4.png', lastUniqueId: 255, hdmiPlugIn: true },
];
const EIM_XBOX_ON = EIM_XBOX_OFF.map((d) => (d.id === 'HDMI_3'
  ? { ...d, spdProductDescription: 'Xbox', spdVendorName: 'MSFT', spdSourceDeviceInfo: 'GAME', lastUniqueId: 4 }
  : d));

function loadTiles() {
  const browser = {};
  runInNewContext(readFileSync(new URL('../app/tiles.js', import.meta.url), 'utf8'), browser);
  return browser.Tiles;
}

test('inputs: the TV input list becomes named tiles; unconnected inputs are left out', () => {
  const tiles = Array.from(loadTiles().inputPoints(EIM_XBOX_OFF), (p) => ({ ...p }));
  assert.deepEqual(tiles.map((p) => p.title), ['AV', 'HDMI 1', 'Vivo TV Fibra-IPTV(Minas Gerais)', 'XBOX', 'HDMI 4']);
  assert.deepEqual(tiles.map((p) => p.glyph), ['input', 'input', 'box', 'game', 'input']);
  assert.equal(tiles[3].id, 'com.webos.app.hdmi3');
});

test('inputs: only an input sending a picture is live (SPD or CEC), not a cable alone', () => {
  const Tiles = loadTiles();
  // Off: HDMI 3 and 4 have hdmiPlugIn true, yet no picture.
  assert.deepEqual(Array.from(Tiles.inputPoints(EIM_XBOX_OFF), (p) => p.live), [false, false, false, false, false]);
  const on = Array.from(Tiles.inputPoints(EIM_XBOX_ON), (p) => [p.title, p.live]);
  assert.deepEqual(on.filter(([, live]) => live), [['XBOX', true]]);
});

test('tiles: each kind of app gets a line icon, streaming apps the play icon', () => {
  const Tiles = loadTiles();
  const glyph = (id, title = '') => Tiles.glyphFor({ id, title });
  assert.equal(glyph('com.webos.app.livetv', 'TV ao vivo'), 'tv');
  assert.equal(glyph('com.webos.app.hdmi1', 'HDMI 1'), 'input');
  assert.equal(glyph('com.webos.app.hdmi3', 'XBOX'), 'game');
  assert.equal(glyph('spotify-beehive', 'Spotify'), 'music');
  assert.equal(glyph('com.webos.app.browser', 'Navegador'), 'globe');
  assert.equal(glyph('com.palm.app.settings', 'Configurações'), 'gear');
  assert.equal(glyph('netflix', 'Netflix'), 'play');
  assert.equal(glyph('youtube.leanback.v4', 'YouTube'), 'play');
  // Every icon is valid SVG markup with no external references.
  for (const name of Tiles.glyphs) {
    const markup = Tiles.svg(name);
    assert.match(markup, /^<svg [^>]*viewBox="0 0 24 24"[^>]*>.*<\/svg>$/s);
    assert.doesNotMatch(markup, /href|url\(|<script/i);
  }
});

// ---- Phone settings (lgtv/service/common.js and server.js) -----------------

const requireCjs = createRequire(import.meta.url);
const APP_DIR_IN_REPO = fileURLToPath(new URL('../app/', import.meta.url));

// common.js reads its folders from the environment when it loads.
function loadCommon(dataDir) {
  const modulePath = requireCjs.resolve('../service/common.js');
  delete requireCjs.cache[modulePath];
  const saved = { data: process.env.MINHA_TV_DATA_DIR, app: process.env.MINHA_TV_APP_DIR };
  process.env.MINHA_TV_DATA_DIR = dataDir;
  process.env.MINHA_TV_APP_DIR = APP_DIR_IN_REPO;
  try {
    return requireCjs(modulePath);
  } finally {
    for (const [key, name] of [['data', 'MINHA_TV_DATA_DIR'], ['app', 'MINHA_TV_APP_DIR']]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  }
}

test('phone settings: the app\'s own themes, wallpapers and defaults are the choices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-common-'));
  try {
    const common = loadCommon(dir);
    const app = common.loadApp();
    const themes = Array.from(common.themeChoices(app), (t) => ({ ...t, wallpapers: Array.from(t.wallpapers, (w) => ({ ...w })) }));
    assert.deepEqual(themes.map((t) => t.id).sort(), ['diablo4', 'duna', 'noite', 'vangogh']);
    assert.equal(themes.find((t) => t.id === 'diablo4').wallpapers.length, 5);
    assert.equal(common.defaults(app).theme, 'diablo4');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('phone settings: changes are validated against what the app offers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-common-'));
  try {
    const common = loadCommon(dir);
    const themes = common.themeChoices(common.loadApp());
    const ok = common.validate({
      theme: 'duna',
      wallpaper: { duna: 'dune-film-2021-1080.mp4', diablo4: 'none', noite: null },
      favorites: ['netflix', 'com.webos.app.hdmi3', 'netflix'],
      idleSeconds: 60,
      somethingElse: true,
    }, themes);
    assert.deepEqual(Array.from(ok.errors), []);
    assert.deepEqual(JSON.parse(JSON.stringify(ok.settings)), {
      theme: 'duna',
      wallpaper: { duna: 'dune-film-2021-1080.mp4', diablo4: 'none', noite: null },
      favorites: ['netflix', 'com.webos.app.hdmi3'], // duplicates dropped
      idleSeconds: 60,
    });
    const bad = common.validate({
      theme: 'nope',
      wallpaper: { duna: '../../etc/passwd', nope: 'x.mp4' },
      favorites: ['ok', 'not ok!'],
      idleSeconds: 99999,
    }, themes);
    assert.equal(bad.errors.length, 5);
    assert.equal(bad.settings.theme, undefined);
    assert.equal(bad.settings.favorites, undefined);
    // null puts a theme's wallpaper back to its default.
    const merged = common.merge({ wallpaper: { duna: 'a.mp4', diablo4: 'b.mp4' } }, { wallpaper: { duna: null } });
    assert.deepEqual(merged, { wallpaper: { diablo4: 'b.mp4' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('phone settings: the access code is created once, readable only by its owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-common-'));
  try {
    const common = loadCommon(join(dir, 'minha-tv'));
    const first = common.token();
    assert.match(first, /^[0-9a-f]{24}$/);
    assert.equal(common.token(), first);
    assert.equal(statSync(join(dir, 'minha-tv', 'token')).mode & 0o777, 0o600);
    assert.equal(common.sameToken(first), true);
    assert.equal(common.sameToken(''), false);
    assert.equal(common.sameToken(undefined), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Starts the real server against a fake luna-send; returns helpers to call it.
async function startPhoneServer() {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-server-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'luna-send'), `#!/bin/sh
case "$3" in
  *listLaunchPoints) echo '${JSON.stringify({ returnValue: true, launchPoints: [
    { id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' },
    { id: 'io.github.marianovale.lgtv', title: 'Minha TV' }] })}' ;;
  *getAllInputStatus) echo '${JSON.stringify({ returnValue: true, devices: EIM_XBOX_ON })}' ;;
esac
`);
  chmodSync(join(dir, 'bin', 'luna-send'), 0o755);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../service/server.js', import.meta.url))], {
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      MINHA_TV_DATA_DIR: join(dir, 'data'),
      MINHA_TV_APP_DIR: APP_DIR_IN_REPO,
      MINHA_TV_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const m = /listening on (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  const code = readFileSync(join(dir, 'data', 'token'), 'utf8').trim();
  const base = `http://127.0.0.1:${port}`;
  return {
    dir,
    code,
    base,
    call: (route, { method = 'GET', body, token = code } = {}) => fetch(base + route, {
      method,
      headers: { ...(token ? { 'X-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    }),
    stop: () => { child.kill(); rmSync(dir, { recursive: true, force: true }); },
  };
}

// Reads Server-Sent Events from the server until `want` returns true.
function readEvents(url, want) {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      let buffer = '';
      const seen = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const data = /^data: (.*)$/m.exec(frame);
          if (/^event: settings$/m.test(frame) && data) {
            seen.push(JSON.parse(data[1]));
            if (want(seen)) { req.destroy(); resolve(seen); }
          }
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => { req.destroy(); reject(new Error('no event')); }, 5000);
  });
}

test('phone server: page is public, the API needs the access code', async () => {
  const s = await startPhoneServer();
  try {
    const page = await s.call('/', { token: null });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Minha TV/);
    assert.equal((await s.call('/tiles.js', { token: null })).status, 200);
    assert.equal((await s.call('/api/settings', { token: null })).status, 401);
    assert.equal((await s.call('/api/settings', { token: 'f'.repeat(24) })).status, 401);
    const settings = await (await s.call('/api/settings')).json();
    assert.equal(settings.saved, false);
    assert.equal(settings.defaults.theme, 'diablo4');
  } finally {
    s.stop();
  }
});

test('phone server: a valid change is saved and pushed live; a bad one changes nothing', async () => {
  const s = await startPhoneServer();
  try {
    const bad = await s.call('/api/settings', { method: 'POST', body: { theme: 'nope' } });
    assert.equal(bad.status, 400);
    assert.equal(existsSync(join(s.dir, 'data', 'settings.json')), false);

    const pushed = readEvents(`${s.base}/api/events?t=${s.code}`, (seen) => seen.some((x) => x.theme === 'duna'));
    await new Promise((r) => setTimeout(r, 200)); // let the listener connect
    const change = { theme: 'duna', favorites: ['netflix', 'com.webos.app.hdmi3'], wallpaper: { duna: 'dune-film-2021-1080.mp4' } };
    const ok = await s.call('/api/settings', { method: 'POST', body: change });
    assert.equal(ok.status, 200);
    const frames = await pushed;
    assert.deepEqual(frames[frames.length - 1], change);

    const stored = await (await s.call('/api/settings')).json();
    assert.equal(stored.saved, true);
    assert.deepEqual(stored.settings, change);
    assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'data', 'settings.json'), 'utf8')), change);

    // Oversized bodies are refused.
    const huge = await s.call('/api/settings', { method: 'POST', body: '{"x":"' + 'a'.repeat(70 * 1024) + '"}' }).catch(() => ({ status: 413 }));
    assert.equal(huge.status, 413);
  } finally {
    s.stop();
  }
});

test('phone server: the catalog lists themes, apps (minus hidden) and named inputs', async () => {
  const s = await startPhoneServer();
  try {
    const catalog = await (await s.call('/api/catalog')).json();
    assert.deepEqual(catalog.themes.map((t) => t.id).sort(), ['diablo4', 'duna', 'noite', 'vangogh']);
    assert.deepEqual(catalog.apps.map((a) => a.id), ['netflix', 'youtube.leanback.v4']);
    assert.deepEqual(catalog.inputs.map((i) => i.title), ['AV', 'HDMI 1', 'Vivo TV Fibra-IPTV(Minas Gerais)', 'XBOX', 'HDMI 4']);
    assert.equal(catalog.inputs.find((i) => i.title === 'XBOX').live, true);
  } finally {
    s.stop();
  }
});

// ---- Themes made on the phone ----------------------------------------------

// Minimal MP4 boxes: what inspectMedia reads (brand, track size, codec tag).
function mp4Box(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}
function fakeMp4({ width = 1920, height = 1080, brand = 'isom', codec = 'avc1' } = {}) {
  const tkhd = Buffer.alloc(4 + 20 + 52 + 8); // version 0: flags, times/ids, layer…matrix, size
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([
    mp4Box('ftyp', Buffer.from(brand.padEnd(4) + '\0\0\0\0isom', 'latin1')),
    mp4Box('moov', Buffer.concat([mp4Box('trak', mp4Box('tkhd', tkhd)), mp4Box('stsd', Buffer.from(codec))])),
  ]);
}
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('custom themes: a name, color and font become a valid theme for the engine', () => {
  const browser = { console };
  runInNewContext(readFileSync(new URL('../app/theme.js', import.meta.url), 'utf8'), browser);
  runInNewContext(readFileSync(new URL('../app/custom.js', import.meta.url), 'utf8'), browser);
  const theme = browser.CustomThemes.build(
    { id: 'custom-praia-1a2b3c', name: 'Praia', accent: '#e8a33d', font: 'classica',
      wallpapers: [{ file: '0123456789abcdef.mp4', name: 'Mar' }, { file: 'fedcba9876543210.jpg', name: 'Areia', fit: 'fit' }] },
    { base: 'http://127.0.0.1:8787/media/custom-praia-1a2b3c/', query: '?t=abc' });
  assert.deepEqual(Array.from(browser.Themes.problems(theme)), []);
  assert.equal(theme.colors.accent, 'rgb(232, 163, 61)');
  assert.equal(theme.colors.onAccent, '#111114'); // light accent -> dark text
  assert.match(theme.font.display, /Cormorant/);
  // Its uploads come from the server: the chosen one, else the first; its
  // first photo makes the preview; "none" leaves the drawn backdrop.
  const first = browser.Themes.backgroundCandidates(theme);
  assert.deepEqual(Array.from(first.videos), ['http://127.0.0.1:8787/media/custom-praia-1a2b3c/0123456789abcdef.mp4?t=abc']);
  assert.deepEqual(Array.from(first.images), ['http://127.0.0.1:8787/media/custom-praia-1a2b3c/fedcba9876543210.jpg?t=abc']);
  // Each file keeps its framing: the video fills, the photo under it shows whole.
  assert.equal(first.videoFit, 'fill');
  assert.equal(first.imageFit, 'fit');
  const photo = browser.Themes.backgroundCandidates(theme, 'fedcba9876543210.jpg');
  assert.equal(photo.videos.length, 0);
  assert.equal(photo.images[0], 'http://127.0.0.1:8787/media/custom-praia-1a2b3c/fedcba9876543210.jpg?t=abc');
  assert.equal(photo.imageFit, 'fit');
  assert.equal(browser.Themes.backgroundCandidates(theme, 'none').images.length, 0);
  // Registering it again replaces it.
  assert.equal(browser.registerTheme(theme), true);
  assert.equal(browser.registerTheme({ ...theme, name: 'Praia 2' }), true);
  assert.deepEqual(Array.from(browser.Themes.list(), (t) => t.name), ['Praia 2']);
});

test('custom themes: uploads are checked by their bytes (format, codec, size)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-media-'));
  try {
    const common = loadCommon(join(dir, 'data'));
    const check = (name, bytes) => {
      const file = join(dir, name);
      writeFileSync(file, bytes);
      return { ...common.inspectMedia(file) };
    };
    assert.deepEqual(check('a', FAKE_JPEG), { ext: 'jpg', kind: 'image' });
    assert.deepEqual(check('b', Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')), { ext: 'png', kind: 'image' });
    assert.deepEqual(check('c', fakeMp4()), { ext: 'mp4', kind: 'video', width: 1920, height: 1080 });
    assert.match(check('d', fakeMp4({ width: 3840, height: 2160 })).error, /3840×2160/);
    assert.match(check('e', fakeMp4({ codec: 'hvc1' })).error, /HEVC/);
    assert.match(check('f', fakeMp4({ brand: 'qt' })).error, /\.MOV/);
    assert.match(check('g', Buffer.from('not media at all')).error, /Formato não suportado/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('custom themes: create, add and remove files, delete; settings forget what is gone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lgtv-custom-'));
  try {
    const common = loadCommon(join(dir, 'data'));
    const app = common.loadApp();
    const bad = common.createCustom({ name: '  ', accent: 'red', font: 'comic' }, app);
    assert.deepEqual(Array.from(bad.errors), ['falta o nome do tema', 'cor inválida', 'fonte inválida']);
    const { theme } = common.createCustom({ name: 'Praia à Noite', accent: '#E8A33D', font: 'serifa' }, app);
    assert.match(theme.id, /^custom-praia-a-noite-[0-9a-f]{6}$/);
    assert.equal(theme.accent, '#e8a33d');

    const upload = (bytes, name, fit) => {
      const tmp = join(dir, 'data', 'upload-test');
      writeFileSync(tmp, bytes);
      return common.addMedia(theme.id, tmp, name, fit);
    };
    const video = upload(fakeMp4(), 'Mar');
    assert.match(video.file, /^[0-9a-f]{16}\.mp4$/);
    const refused = upload(fakeMp4({ width: 3840, height: 2160 }), 'Grande');
    assert.match(refused.error, /1080p/);
    assert.equal(existsSync(join(dir, 'data', 'upload-test')), false); // temp file consumed either way
    const photo = upload(FAKE_JPEG, 'Areia', 'fit');
    assert.deepEqual(common.listCustom()[0].wallpapers.map((w) => [w.name, w.fit]), [['Mar', 'fill'], ['Areia', 'fit']]);
    // Framing can change later; only known values and files are accepted.
    assert.equal(common.setFit(theme.id, video.file, 'fit'), true);
    assert.equal(common.listCustom()[0].wallpapers[0].fit, 'fit');
    assert.equal(common.setFit(theme.id, video.file, 'stretch'), false);
    assert.equal(common.setFit(theme.id, 'missing.jpg', 'fill'), false);

    // Its files are valid wallpaper choices for the settings.
    const choices = common.allThemeChoices(app);
    const ok = common.validate({ theme: theme.id, wallpaper: { [theme.id]: photo.file } }, choices);
    assert.deepEqual(Array.from(ok.errors), []);
    common.writeSettings(common.merge({}, ok.settings));

    assert.equal(common.removeMedia(theme.id, photo.file), true);
    assert.equal(common.readSettings().settings.wallpaper[theme.id], undefined); // forgotten
    assert.equal(common.readSettings().settings.theme, theme.id);
    assert.equal(common.removeMedia(theme.id, '../../token'), false);
    assert.equal(common.mediaPath(theme.id, '../theme.json'), null);

    assert.equal(common.deleteCustom(theme.id), true);
    assert.equal(common.readSettings().settings.theme, undefined); // back to the default theme
    assert.equal(existsSync(join(dir, 'data', 'themes', theme.id)), false);
    assert.equal(common.deleteCustom('custom-x/../..'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('phone server: create a theme, upload, serve with byte ranges, delete', async () => {
  const s = await startPhoneServer();
  try {
    const pushed = readEvents(`${s.base}/api/events?t=${s.code}`, (seen) => seen.length >= 2);
    const created = await (await s.call('/api/themes', { method: 'POST', body: { name: 'Praia', accent: '#e8a33d', font: 'simples' } })).json();
    const id = created.theme.id;

    const put = (bytes, name, token = s.code) => fetch(`${s.base}/api/themes/${id}/media?name=${encodeURIComponent(name)}&fit=fit`, {
      method: 'PUT', headers: token ? { 'X-Token': token } : {}, body: bytes,
    });
    assert.equal((await put(fakeMp4(), 'Mar', null)).status, 401);
    const big = await put(fakeMp4({ width: 3840, height: 2160 }), 'Grande');
    assert.equal(big.status, 400);
    assert.match((await big.json()).error, /1080p/);
    const ok = await (await put(fakeMp4(), 'Mar')).json();
    assert.match(ok.file, /^[0-9a-f]{16}\.mp4$/);
    await pushed; // settings + themes frames were pushed

    const listed = await (await s.call('/api/themes')).json();
    assert.deepEqual(listed.themes[0].wallpapers.map((w) => [w.name, w.fit]), [['Mar', 'fit']]);
    const refit = (fit) => s.call(`/api/themes/${id}/media/${ok.file}`, { method: 'POST', body: { fit } });
    assert.equal((await refit('fill')).status, 200);
    assert.equal((await refit('zoom')).status, 400);
    assert.equal((await (await s.call('/api/themes')).json()).themes[0].wallpapers[0].fit, 'fill');
    const catalog = await (await s.call('/api/catalog')).json();
    assert.ok(catalog.themes.some((t) => t.id === id && t.custom));
    assert.deepEqual(catalog.fonts.map((f) => f.id), ['simples', 'serifa', 'classica', 'geometrica']);

    const media = `/media/${id}/${ok.file}`;
    assert.equal((await s.call(media, { token: null })).status, 401);
    const whole = await s.call(media);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await whole.arrayBuffer()).length, fakeMp4().length);
    const part = await fetch(`${s.base}${media}?t=${s.code}`, { headers: { Range: 'bytes=4-11' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 4-11/${fakeMp4().length}`);
    assert.equal(Buffer.from(await part.arrayBuffer()).toString('latin1'), 'ftypisom');

    assert.equal((await s.call(`/api/themes/${id}/media/${ok.file}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.call(media)).status, 404);
    assert.equal((await s.call(`/api/themes/${id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await s.call('/api/themes')).json()).themes, []);
  } finally {
    s.stop();
  }
});
