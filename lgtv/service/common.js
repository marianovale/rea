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
  var dirs = fs.readdirSync(path.join(APP_DIR, 'themes')).sort();
  for (var i = 0; i < dirs.length; i++) {
    var file = path.join(APP_DIR, 'themes', dirs[i], 'theme.js');
    if (fs.existsSync(file)) run(file);
  }
  return { config: context.CONFIG, tiles: context.Tiles, themes: themes };
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
  var result = { themes: themeChoices(app), apps: [], inputs: [], defaults: defaults(app) };
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

module.exports = {
  APP_ID: APP_ID,
  APP_DIR: APP_DIR,
  PORT: PORT,
  token: token,
  sameToken: sameToken,
  phoneLink: phoneLink,
  loadApp: loadApp,
  themeChoices: themeChoices,
  defaults: defaults,
  catalog: catalog,
  validate: validate,
  merge: merge,
  readSettings: readSettings,
  writeSettings: writeSettings
};
