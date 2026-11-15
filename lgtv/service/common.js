// Shared by the luna service (service.js) and the phone server (server.js):
// where Minha TV keeps its settings and access code on the TV, how settings
// are validated and merged, and what can be chosen (themes, wallpapers,
// apps, inputs). ES5 and core modules only: the TV's Node.js can be old.
var fs = require('fs');
var path = require('path');
var os = require('os');
var vm = require('vm');
var crypto = require('crypto');
var childProcess = require('child_process');

var APP_ID = 'io.github.marianovale.lgtv';
// On /var (writable, survives reboots and reinstalls of the app).
var DATA_DIR = process.env.MINHA_TV_DATA_DIR || '/var/lib/webosbrew/minha-tv';
var PORT = process.env.MINHA_TV_PORT !== undefined ? Number(process.env.MINHA_TV_PORT) : 8787;
// Installed layout: .../services/<id>.service/ next to .../applications/<id>/.
var APP_DIR = process.env.MINHA_TV_APP_DIR ||
  path.join(__dirname, '..', '..', 'applications', APP_ID);

var MAX_FAVORITES = 60;
var ID = /^[A-Za-z0-9._-]{1,128}$/;
// Themes made on the phone, and their uploads.
var MAX_UPLOAD = 50 * 1024 * 1024;
var MAX_CUSTOM_THEMES = 30;
var MAX_FILES_PER_THEME = 12;
var CUSTOM_ID = /^custom-[a-z0-9-]{1,60}$/;
var MEDIA_FILE = /^[0-9a-f]{16}\.(mp4|webm|jpg|png|gif)$/;

function dataPath(name) {
  return path.join(DATA_DIR, name);
}

function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}

// ---- Access code -----------------------------------------------------------

// The code in the phone link. Created once (exclusively, so the service and
// the server never end up with different codes) and readable only by root.
function token() {
  var file = dataPath('token');
  try {
    var existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{16,}$/.test(existing)) return existing;
  } catch (e) { /* not created yet */ }
  mkdirp(DATA_DIR);
  try {
    fs.writeFileSync(file, crypto.randomBytes(12).toString('hex') + '\n', { flag: 'wx', mode: 384 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

function sameToken(given) {
  return typeof given === 'string' && given.length > 0 && given === token();
}

function lanAddress() {
  var nets = os.networkInterfaces();
  var names = Object.keys(nets);
  for (var i = 0; i < names.length; i++) {
    var addrs = nets[names[i]] || [];
    for (var j = 0; j < addrs.length; j++) {
      var a = addrs[j];
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
    }
  }
  return null;
}

function phoneLink() {
  var code = token();
  var ip = lanAddress();
  return {
    port: PORT,
    token: code,
    url: ip ? 'http://' + ip + ':' + PORT + '/#t=' + code : null
  };
}

// ---- What can be chosen ----------------------------------------------------

// Runs the installed app's own config.js, tiles.js and themes/*/theme.js in a
// sandbox, so the choices offered on the phone are exactly the app's.
function loadApp() {
  var themes = [];
  var sandbox = {
    console: console,
    registerTheme: function (theme) { themes.push(theme); }
  };
  var context = vm.createContext(sandbox);
  function run(file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  run(path.join(APP_DIR, 'config.js'));
  run(path.join(APP_DIR, 'tiles.js'));
  run(path.join(APP_DIR, 'custom.js'));
  var dirs = fs.readdirSync(path.join(APP_DIR, 'themes')).sort();
  for (var i = 0; i < dirs.length; i++) {
    var file = path.join(APP_DIR, 'themes', dirs[i], 'theme.js');
    if (fs.existsSync(file)) run(file);
  }
  return { config: context.CONFIG, tiles: context.Tiles, custom: context.CustomThemes, themes: themes };
}

function themeChoices(app) {
  return app.themes.map(function (t) {
    return {
      id: t.id,
      name: t.name,
      wallpapers: (t.wallpapers || []).map(function (w) { return { file: w.file, name: w.name }; })
    };
  });
}

// The app's themes and the ones made on the phone, as settings choices.
function allThemeChoices(app) {
  return themeChoices(app).concat(listCustom().map(function (def) {
    return { id: def.id, name: def.name, custom: true, wallpapers: def.wallpapers };
  }));
}

function defaults(app) {
  var c = app.config || {};
  return {
    theme: c.theme,
    favorites: c.favorites || [],
    idleSeconds: c.idleSeconds === undefined ? 30 : c.idleSeconds,
    wallpaper: c.background || {}
  };
}

// One luna call through the luna-send tool (the server is not a luna service).
function luna(uri, payload, done) {
  childProcess.execFile('luna-send', ['-n', '1', uri, JSON.stringify(payload || {})],
    { timeout: 8000 }, function (err, stdout) {
      if (err) { done(err); return; }
      var parsed;
      try { parsed = JSON.parse(stdout); } catch (e) { done(e); return; }
      done(parsed.returnValue === false ? new Error(parsed.errorText || 'luna falhou') : null, parsed);
    });
}

// Apps and inputs the favorites can hold, with the app's own icon choice.
function catalog(done) {
  var app = loadApp();
  var hidden = (app.config && app.config.hidden) || [];
  var result = {
    themes: allThemeChoices(app),
    fonts: app.custom.fontIds.map(function (id) { return { id: id, name: app.custom.fonts[id].name }; }),
    apps: [],
    inputs: [],
    defaults: defaults(app)
  };
  luna('luna://com.webos.applicationManager/listLaunchPoints', {}, function (err, r) {
    if (!err) {
      result.apps = (r.launchPoints || []).filter(function (p) {
        return p && p.id && hidden.indexOf(p.id) < 0;
      }).map(function (p) {
        return { id: p.id, title: p.title || p.id, glyph: app.tiles.glyphFor(p) };
      });
    }
    luna('luna://com.webos.service.eim/getAllInputStatus', {}, function (err2, r2) {
      if (!err2) {
        result.inputs = app.tiles.inputPoints(r2.devices).map(function (p) {
          return { id: p.id, title: p.title, glyph: p.glyph, live: p.live };
        });
      }
      done(result);
    });
  });
}

// ---- Settings --------------------------------------------------------------

// Checks a (partial) change against what the app offers. Unknown fields are
// ignored; a bad value is reported, never stored.
function validate(input, themes) {
  var errors = [];
  var out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { settings: out, errors: ['corpo inválido'] };
  }
  var byId = {};
  for (var i = 0; i < themes.length; i++) byId[themes[i].id] = themes[i];

  if (input.theme !== undefined) {
    if (typeof input.theme === 'string' && byId[input.theme]) out.theme = input.theme;
    else errors.push('tema desconhecido');
  }

  if (input.wallpaper !== undefined) {
    if (!input.wallpaper || typeof input.wallpaper !== 'object' || Array.isArray(input.wallpaper)) {
      errors.push('papel de parede inválido');
    } else {
      out.wallpaper = {};
      var keys = Object.keys(input.wallpaper);
      for (var k = 0; k < keys.length; k++) {
        var theme = byId[keys[k]];
        var value = input.wallpaper[keys[k]];
        if (!theme) { errors.push('papel de parede de um tema desconhecido'); continue; }
        var files = (theme.wallpapers || []).map(function (w) { return w.file; });
        // null = back to the theme's default; 'none' = drawn backdrop only.
        if (value === null || value === 'none' || files.indexOf(value) >= 0) out.wallpaper[keys[k]] = value;
        else errors.push('vídeo desconhecido para ' + theme.name);
      }
    }
  }

  if (input.favorites !== undefined) {
    var list = input.favorites;
    var ok = Array.isArray(list) && list.length <= MAX_FAVORITES;
    var clean = [];
    for (var f = 0; ok && f < list.length; f++) {
      if (typeof list[f] !== 'string' || !ID.test(list[f])) ok = false;
      else if (clean.indexOf(list[f]) < 0) clean.push(list[f]);
    }
    if (ok) out.favorites = clean;
    else errors.push('favoritos inválidos');
  }

  if (input.idleSeconds !== undefined) {
    var n = input.idleSeconds;
    if (typeof n === 'number' && n % 1 === 0 && n >= 0 && n <= 3600) out.idleSeconds = n;
    else errors.push('tempo de descanso inválido');
  }

  return { settings: out, errors: errors };
}

// Applies a validated change. A wallpaper set to null goes back to default.
function merge(current, change) {
  var next = JSON.parse(JSON.stringify(current || {}));
  if (change.theme !== undefined) next.theme = change.theme;
  if (change.favorites !== undefined) next.favorites = change.favorites;
  if (change.idleSeconds !== undefined) next.idleSeconds = change.idleSeconds;
  if (change.wallpaper) {
    next.wallpaper = next.wallpaper || {};
    var keys = Object.keys(change.wallpaper);
    for (var i = 0; i < keys.length; i++) {
      if (change.wallpaper[keys[i]] === null) delete next.wallpaper[keys[i]];
      else next.wallpaper[keys[i]] = change.wallpaper[keys[i]];
    }
  }
  return next;
}

function readSettings() {
  try {
    return { saved: true, settings: JSON.parse(fs.readFileSync(dataPath('settings.json'), 'utf8')) };
  } catch (e) {
    return { saved: false, settings: {} };
  }
}

// Atomic: a reader never sees a half-written file.
function writeSettings(settings) {
  mkdirp(DATA_DIR);
  var file = dataPath('settings.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

// ---- Themes made on the phone ----------------------------------------------

function customDir(id) {
  return path.join(DATA_DIR, 'themes', id);
}

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  if (fs.statSync(target).isDirectory()) {
    fs.readdirSync(target).forEach(function (name) { rmrf(path.join(target, name)); });
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

function readCustom(id) {
  try {
    var def = JSON.parse(fs.readFileSync(path.join(customDir(id), 'theme.json'), 'utf8'));
    return def && def.id === id ? def : null;
  } catch (e) {
    return null;
  }
}

function writeCustom(def) {
  var file = path.join(customDir(def.id), 'theme.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(def, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

function listCustom() {
  var root = path.join(DATA_DIR, 'themes');
  var names;
  try { names = fs.readdirSync(root).sort(); } catch (e) { return []; }
  var out = [];
  for (var i = 0; i < names.length; i++) {
    if (!CUSTOM_ID.test(names[i])) continue;
    var def = readCustom(names[i]);
    if (def) out.push(def);
  }
  return out;
}

function cleanName(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slug(name) {
  var plain = name.toLowerCase();
  if (plain.normalize) plain = plain.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'tema';
}

// input: { name, accent, font }. Returns { theme } or { errors }.
function createCustom(input, app) {
  var errors = [];
  var name = cleanName(input && input.name, 40);
  if (!name) errors.push('falta o nome do tema');
  if (!app.custom.validAccent(input && input.accent)) errors.push('cor inválida');
  if (app.custom.fontIds.indexOf(input && input.font) < 0) errors.push('fonte inválida');
  if (listCustom().length >= MAX_CUSTOM_THEMES) errors.push('limite de ' + MAX_CUSTOM_THEMES + ' temas');
  if (errors.length) return { errors: errors };
  var def = {
    id: 'custom-' + slug(name) + '-' + crypto.randomBytes(3).toString('hex'),
    name: name,
    accent: input.accent.toLowerCase(),
    font: input.font,
    wallpapers: []
  };
  mkdirp(customDir(def.id));
  writeCustom(def);
  return { theme: def };
}

// Drops what pointed at a theme or file that is gone.
function forget(id, file) {
  var stored = readSettings();
  if (!stored.saved) return;
  var s = stored.settings;
  var changed = false;
  if (!file && s.theme === id) { delete s.theme; changed = true; }
  if (s.wallpaper && s.wallpaper[id] !== undefined && (!file || s.wallpaper[id] === file)) {
    delete s.wallpaper[id];
    changed = true;
  }
  if (changed) writeSettings(s);
}

function deleteCustom(id) {
  if (!CUSTOM_ID.test(id) || !readCustom(id)) return false;
  rmrf(customDir(id));
  forget(id);
  return true;
}

function removeMedia(id, file) {
  var def = CUSTOM_ID.test(id) && readCustom(id);
  if (!def || !MEDIA_FILE.test(file)) return false;
  var before = def.wallpapers.length;
  def.wallpapers = def.wallpapers.filter(function (w) { return w.file !== file; });
  if (def.wallpapers.length === before) return false;
  try { fs.unlinkSync(path.join(customDir(id), file)); } catch (e) { /* already gone */ }
  writeCustom(def);
  forget(id, file);
  return true;
}

// Reads a file in chunks; calls visit(buffer, start) where start is where
// new bytes begin (earlier bytes overlap the previous chunk, so a pattern
// across the boundary is still seen).
// Buffer.alloc where it exists (newer Node), the old constructor otherwise.
function alloc(size) {
  return Buffer.alloc ? Buffer.alloc(size) : new Buffer(size);
}

function scan(file, visit) {
  var fd = fs.openSync(file, 'r');
  var CHUNK = 1024 * 1024;
  var OVERLAP = 128;
  var tail = null;
  try {
    for (;;) {
      var chunk = alloc(CHUNK);
      var read = fs.readSync(fd, chunk, 0, CHUNK, null);
      if (read <= 0) break;
      var fresh = chunk.slice(0, read);
      var buf = tail ? Buffer.concat([tail, fresh]) : fresh;
      if (visit(buf, tail ? tail.length : 0) === false) break;
      tail = buf.slice(Math.max(0, buf.length - OVERLAP));
    }
  } finally {
    fs.closeSync(fd);
  }
}

// What a file really is, from its bytes. Videos must be MP4/WebM the TV can
// play: not QuickTime .MOV, not HEVC, at most 1080p (a 4K H.264 clip fell
// back to the drawn backdrop on a UM7520, while the same clip at 1080p
// played).
function inspectMedia(file) {
  var head = alloc(16);
  var fd = fs.openSync(file, 'r');
  var n = fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  head = head.slice(0, n);
  var hex = head.toString('hex');
  if (hex.indexOf('ffd8ff') === 0) return { ext: 'jpg', kind: 'image' };
  if (hex.indexOf('89504e47') === 0) return { ext: 'png', kind: 'image' };
  if (head.slice(0, 4).toString('binary') === 'GIF8') return { ext: 'gif', kind: 'image' };
  if (hex.indexOf('1a45dfa3') === 0) return { ext: 'webm', kind: 'video' };
  if (head.slice(4, 8).toString('binary') !== 'ftyp') {
    return { error: 'Formato não suportado: use foto JPG, PNG ou GIF, ou vídeo MP4.' };
  }
  if (head.slice(8, 12).toString('binary') === 'qt  ') {
    return { error: 'Vídeo .MOV (do iPhone): a TV não toca. Use um MP4 H.264 de até 1080p.' };
  }
  var hevc = false;
  var width = 0;
  var height = 0;
  scan(file, function (buf) {
    if (buf.indexOf('hvc1') >= 0 || buf.indexOf('hev1') >= 0) hevc = true;
    // Track headers ('tkhd'): the width and height are 16.16 fixed point
    // after the times, ids, layer, volume and matrix.
    for (var at = buf.indexOf('tkhd'); at >= 0; at = buf.indexOf('tkhd', at + 4)) {
      var v1 = buf[at + 4] === 1;
      var w = at + 8 + (v1 ? 32 : 20) + 52;
      if (w + 8 > buf.length) continue;
      width = Math.max(width, buf.readUInt32BE(w) >>> 16);
      height = Math.max(height, buf.readUInt32BE(w + 4) >>> 16);
    }
    return !hevc;
  });
  if (hevc) return { error: 'Vídeo em HEVC (H.265): a TV não toca. Use um MP4 H.264 de até 1080p.' };
  if (width > 1920 || height > 1088) {
    return { error: 'Vídeo em ' + width + '×' + height + ': a TV só toca até 1080p. Converta para 1920×1080.' };
  }
  return { ext: 'mp4', kind: 'video', width: width, height: height };
}

// Free space where the uploads go, in bytes; null when unknown.
function freeBytes() {
  try {
    var out = childProcess.execFileSync('df', ['-k', DATA_DIR], { encoding: 'utf8' });
    var fields = out.trim().split('\n').pop().trim().split(/\s+/);
    var kb = Number(fields[fields.length - 3]);
    return isFinite(kb) ? kb * 1024 : null;
  } catch (e) {
    return null;
  }
}

// Takes an uploaded temp file into a theme. Returns { theme, file } or
// { error }; the temp file is always consumed.
// How a file sits on the 16:9 screen: 'fill' covers it (edges cropped),
// 'fit' shows it whole with black around it.
function cleanFit(value) {
  return value === 'fit' ? 'fit' : 'fill';
}

function addMedia(id, tmpFile, displayName, fit) {
  var def = CUSTOM_ID.test(id) && readCustom(id);
  try {
    if (!def) return { error: 'tema não encontrado' };
    if (def.wallpapers.length >= MAX_FILES_PER_THEME) {
      return { error: 'limite de ' + MAX_FILES_PER_THEME + ' arquivos por tema' };
    }
    var info = inspectMedia(tmpFile);
    if (info.error) return { error: info.error };
    var file = crypto.randomBytes(8).toString('hex') + '.' + info.ext;
    fs.renameSync(tmpFile, path.join(customDir(id), file));
    def.wallpapers.push({
      file: file,
      name: cleanName(displayName, 60) || (info.kind === 'video' ? 'Vídeo' : 'Foto'),
      fit: cleanFit(fit)
    });
    writeCustom(def);
    return { theme: def, file: file };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* moved or never written */ }
  }
}

function setFit(id, file, fit) {
  var def = CUSTOM_ID.test(id) && readCustom(id);
  if (!def || (fit !== 'fit' && fit !== 'fill')) return false;
  var found = false;
  def.wallpapers.forEach(function (w) {
    if (w.file === file) { w.fit = fit; found = true; }
  });
  if (found) writeCustom(def);
  return found;
}

function mediaPath(id, file) {
  if (!CUSTOM_ID.test(id) || !MEDIA_FILE.test(file)) return null;
  var full = path.join(customDir(id), file);
  return fs.existsSync(full) ? full : null;
}

module.exports = {
  APP_ID: APP_ID,
  APP_DIR: APP_DIR,
  PORT: PORT,
  token: token,
  sameToken: sameToken,
  phoneLink: phoneLink,
  loadApp: loadApp,
  themeChoices: themeChoices,
  allThemeChoices: allThemeChoices,
  MAX_UPLOAD: MAX_UPLOAD,
  DATA_DIR: DATA_DIR,
  listCustom: listCustom,
  setFit: setFit,
  createCustom: createCustom,
  deleteCustom: deleteCustom,
  removeMedia: removeMedia,
  inspectMedia: inspectMedia,
  freeBytes: freeBytes,
  addMedia: addMedia,
  mediaPath: mediaPath,
  defaults: defaults,
  catalog: catalog,
  validate: validate,
  merge: merge,
  readSettings: readSettings,
  writeSettings: writeSettings
};
