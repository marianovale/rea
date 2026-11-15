import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    for (const file of ['appinfo.json', 'index.html', 'app.js', 'nav.js', 'theme.js', 'config.js', 'style.css',
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
