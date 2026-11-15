// Minha TV phone server: serves the settings page for the phone and the
// settings API that both the phone and the TV app use. Runs as root on the
// TV, started and restarted by tv/autostart.sh. ES5 and core modules only.
//
//   GET  /                 the phone page (no secrets: the code is in the link)
//   GET  /api/settings     saved settings and the app's defaults     (code)
//   GET  /api/catalog      themes, wallpapers, apps and inputs       (code)
//   POST /api/settings     validate, save and broadcast a change     (code)
//   GET  /api/events       settings pushed live (Server-Sent Events) (code)
//
// "code" = the access code from the link, as ?t= or an X-Token header.
var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var common = require('./common');

var MAX_BODY = 64 * 1024;
var PHONE_DIR = path.join(__dirname, 'phone');
var STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/phone.js': ['phone.js', 'application/javascript; charset=utf-8'],
  '/phone.css': ['phone.css', 'text/css; charset=utf-8']
};

var listeners = [];

function headers(type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    // The TV app is a file:// page talking to 127.0.0.1.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(JSON.stringify(body));
}

function sendFile(res, file, type) {
  fs.readFile(file, function (err, data) {
    if (err) { sendJson(res, 404, { error: 'não encontrado' }); return; }
    res.writeHead(200, headers(type));
    res.end(data);
  });
}

function settingsBody() {
  var stored = common.readSettings();
  return { saved: stored.saved, settings: stored.settings, defaults: common.defaults(common.loadApp()) };
}

function broadcast(settings) {
  var frame = 'event: settings\ndata: ' + JSON.stringify(settings) + '\n\n';
  for (var i = 0; i < listeners.length; i++) listeners[i].write(frame);
}

// Wraps a callback that runs later, outside handle()'s try/catch.
function guard(res, fn) {
  return function () {
    try {
      fn.apply(null, arguments);
    } catch (e) {
      sendJson(res, 500, { error: String(e && e.message || e) });
    }
  };
}

function readBody(req, res, done) {
  var body = '';
  var tooBig = false;
  req.setEncoding('utf8');
  req.on('data', function (chunk) {
    if (tooBig) return;
    body += chunk;
    if (body.length > MAX_BODY) {
      tooBig = true;
      sendJson(res, 413, { error: 'pedido grande demais' });
      req.connection.destroy();
    }
  });
  req.on('end', function () { if (!tooBig) done(body); });
}

function saveChange(req, res) {
  readBody(req, res, guard(res, function (body) {
    var input;
    try { input = JSON.parse(body); } catch (e) { sendJson(res, 400, { errors: ['JSON inválido'] }); return; }
    var themes = common.themeChoices(common.loadApp());
    var checked = common.validate(input, themes);
    if (checked.errors.length) { sendJson(res, 400, { errors: checked.errors }); return; }
    var next = common.merge(common.readSettings().settings, checked.settings);
    common.writeSettings(next);
    broadcast(next);
    sendJson(res, 200, { settings: next });
  }));
}

function events(req, res) {
  var h = headers('text/event-stream');
  h.Connection = 'keep-alive';
  res.writeHead(200, h);
  res.write('retry: 3000\n\n');
  res.write('event: settings\ndata: ' + JSON.stringify(common.readSettings().settings) + '\n\n');
  listeners.push(res);
  // A comment every 25 s keeps idle connections from being dropped.
  var ping = setInterval(function () { res.write(': ping\n\n'); }, 25000);
  req.on('close', function () {
    clearInterval(ping);
    var i = listeners.indexOf(res);
    if (i >= 0) listeners.splice(i, 1);
  });
}

function handle(req, res) {
  var parsed = url.parse(req.url, true);
  var route = parsed.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, headers('text/plain')); res.end(); return; }

  if (req.method === 'GET' && STATIC[route]) {
    sendFile(res, path.join(PHONE_DIR, STATIC[route][0]), STATIC[route][1]);
    return;
  }
  // The same icons as the TV.
  if (req.method === 'GET' && route === '/tiles.js') {
    sendFile(res, path.join(common.APP_DIR, 'tiles.js'), 'application/javascript; charset=utf-8');
    return;
  }

  if (route.indexOf('/api/') !== 0) { sendJson(res, 404, { error: 'não encontrado' }); return; }
  if (!common.sameToken(req.headers['x-token'] || parsed.query.t)) {
    sendJson(res, 401, { error: 'código de acesso inválido' });
    return;
  }

  if (req.method === 'GET' && route === '/api/settings') { sendJson(res, 200, settingsBody()); return; }
  if (req.method === 'GET' && route === '/api/catalog') {
    common.catalog(guard(res, function (result) { sendJson(res, 200, result); }));
    return;
  }
  if (req.method === 'POST' && route === '/api/settings') { saveChange(req, res); return; }
  if (req.method === 'GET' && route === '/api/events') { events(req, res); return; }
  sendJson(res, 404, { error: 'não encontrado' });
}

if (require.main === module) {
  common.token(); // create the access code before anyone asks for the link
  var server = http.createServer(function (req, res) {
    try {
      handle(req, res);
    } catch (e) {
      sendJson(res, 500, { error: String(e && e.message || e) });
    }
  });
  // Anything unexpected: exit, and autostart.sh starts a fresh server.
  process.on('uncaughtException', function (e) {
    console.error('minha-tv server: ' + (e && e.stack || e));
    process.exit(1);
  });
  server.listen(common.PORT, '0.0.0.0', function () {
    console.log('minha-tv server listening on ' + server.address().port);
  });
}

module.exports = { handle: handle };
