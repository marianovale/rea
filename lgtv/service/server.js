// Minha TV phone server: serves the settings page for the phone and the
// settings API that both the phone and the TV app use. Runs as root on the
// TV, started and restarted by tv/autostart.sh. ES5 and core modules only.
//
//   GET  /                 the phone page (no secrets: the code is in the link)
//   GET  /api/settings     saved settings and the app's defaults     (code)
//   GET  /api/catalog      themes, wallpapers, apps and inputs       (code)
//   POST /api/settings     validate, save and broadcast a change     (code)
//   GET  /api/events       settings and themes pushed live (SSE)     (code)
//   GET  /api/themes       themes made on the phone                  (code)
//   POST /api/themes       create one { name, accent, font }         (code)
//   DELETE /api/themes/ID  delete one and its files                  (code)
//   PUT  /api/themes/ID/media?name=…&fit=fill|fit  upload a photo or video (code)
//   POST /api/themes/ID/media/FILE     { fit: 'fill' | 'fit' }       (code)
//   DELETE /api/themes/ID/media/FILE   remove one                    (code)
//   GET  /media/ID/FILE    an upload, with byte ranges for video     (code)
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
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

function push(event, data) {
  var frame = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (var i = 0; i < listeners.length; i++) listeners[i].write(frame);
}

function broadcast(settings) {
  push('settings', settings);
}

// After a theme or file changes: the themes, and settings that may have
// dropped a reference to what was deleted.
function broadcastThemes() {
  push('themes', common.listCustom());
  push('settings', common.readSettings().settings);
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
    var themes = common.allThemeChoices(common.loadApp());
    var checked = common.validate(input, themes);
    if (checked.errors.length) { sendJson(res, 400, { errors: checked.errors }); return; }
    var next = common.merge(common.readSettings().settings, checked.settings);
    common.writeSettings(next);
    broadcast(next);
    sendJson(res, 200, { settings: next });
  }));
}

function createTheme(req, res) {
  readBody(req, res, guard(res, function (body) {
    var input;
    try { input = JSON.parse(body); } catch (e) { sendJson(res, 400, { errors: ['JSON inválido'] }); return; }
    var result = common.createCustom(input, common.loadApp());
    if (result.errors) { sendJson(res, 400, { errors: result.errors }); return; }
    broadcastThemes();
    sendJson(res, 200, { theme: result.theme });
  }));
}

// Streams the body to a temp file, enforcing the declared size, the upload
// limit and the free space; the file is checked by its bytes afterwards.
function upload(req, res, id, displayName, fit) {
  if (!common.listCustom().some(function (d) { return d.id === id; })) {
    sendJson(res, 404, { error: 'tema não encontrado' });
    return;
  }
  var size = Number(req.headers['content-length']);
  if (!(size > 0)) { sendJson(res, 411, { error: 'falta o tamanho do arquivo' }); return; }
  if (size > common.MAX_UPLOAD) { sendJson(res, 413, { error: 'arquivo grande demais (máximo 50 MB)' }); return; }
  var free = common.freeBytes();
  if (free !== null && free < size + 20 * 1024 * 1024) {
    sendJson(res, 507, { error: 'pouco espaço livre na TV' });
    return;
  }
  var tmp = path.join(common.DATA_DIR, 'upload-' + process.pid + '-' + Date.now());
  var out = fs.createWriteStream(tmp);
  var received = 0;
  var done = false;
  function abort(status, message) {
    if (done) return;
    done = true;
    out.destroy();
    fs.unlink(tmp, function () {});
    sendJson(res, status, { error: message });
  }
  req.on('data', function (chunk) {
    received += chunk.length;
    if (received > size) { abort(413, 'enviou mais do que o tamanho declarado'); req.connection.destroy(); }
  });
  req.on('aborted', function () { abort(400, 'envio interrompido'); });
  out.on('error', function () { abort(500, 'não consegui gravar na TV'); });
  out.on('finish', guard(res, function () {
    if (done) return;
    done = true;
    if (received !== size) {
      fs.unlink(tmp, function () {});
      sendJson(res, 400, { error: 'envio incompleto' });
      return;
    }
    var result = common.addMedia(id, tmp, displayName, fit);
    if (result.error) { sendJson(res, 400, { error: result.error }); return; }
    broadcastThemes();
    sendJson(res, 200, { theme: result.theme, file: result.file });
  }));
  req.pipe(out);
}

function setFit(req, res, id, file) {
  readBody(req, res, guard(res, function (body) {
    var input;
    try { input = JSON.parse(body); } catch (e) { sendJson(res, 400, { error: 'JSON inválido' }); return; }
    if (!common.setFit(id, file, input && input.fit)) {
      sendJson(res, 400, { error: 'arquivo ou enquadramento inválido' });
      return;
    }
    broadcastThemes();
    sendJson(res, 200, { file: file, fit: input.fit });
  }));
}

var MEDIA_TYPES = { mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

function serveMedia(req, res, file) {
  var size = fs.statSync(file).size;
  var h = headers(MEDIA_TYPES[path.extname(file).slice(1)] || 'application/octet-stream');
  h['Accept-Ranges'] = 'bytes';
  h['Cache-Control'] = 'private, max-age=3600';
  var range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range) {
    h['Content-Length'] = size;
    res.writeHead(200, h);
    fs.createReadStream(file).pipe(res);
    return;
  }
  var start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
  var end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
  if (!(start >= 0) || start > end || end >= size) {
    h['Content-Range'] = 'bytes */' + size;
    res.writeHead(416, h);
    res.end();
    return;
  }
  h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  h['Content-Length'] = end - start + 1;
  res.writeHead(206, h);
  fs.createReadStream(file, { start: start, end: end }).pipe(res);
}

function events(req, res) {
  var h = headers('text/event-stream');
  h.Connection = 'keep-alive';
  res.writeHead(200, h);
  res.write('retry: 3000\n\n');
  res.write('event: themes\ndata: ' + JSON.stringify(common.listCustom()) + '\n\n');
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

  var media = /^\/media\/([^/]+)\/([^/]+)$/.exec(route);
  if (!media && route.indexOf('/api/') !== 0) { sendJson(res, 404, { error: 'não encontrado' }); return; }
  if (!common.sameToken(req.headers['x-token'] || parsed.query.t)) {
    sendJson(res, 401, { error: 'código de acesso inválido' });
    return;
  }
  if (media) {
    var mediaFile = req.method === 'GET' && common.mediaPath(decodeURIComponent(media[1]), decodeURIComponent(media[2]));
    if (!mediaFile) { sendJson(res, 404, { error: 'não encontrado' }); return; }
    serveMedia(req, res, mediaFile);
    return;
  }

  if (req.method === 'GET' && route === '/api/settings') { sendJson(res, 200, settingsBody()); return; }
  if (req.method === 'GET' && route === '/api/catalog') {
    common.catalog(guard(res, function (result) { sendJson(res, 200, result); }));
    return;
  }
  if (req.method === 'POST' && route === '/api/settings') { saveChange(req, res); return; }
  if (req.method === 'GET' && route === '/api/events') { events(req, res); return; }

  if (route === '/api/themes') {
    if (req.method === 'GET') { sendJson(res, 200, { themes: common.listCustom() }); return; }
    if (req.method === 'POST') { createTheme(req, res); return; }
  }
  var parts = route.split('/'); // ['', 'api', 'themes', ID, 'media', FILE]
  if (parts[2] === 'themes' && parts[3]) {
    var id = decodeURIComponent(parts[3]);
    if (parts.length === 4 && req.method === 'DELETE') {
      if (!common.deleteCustom(id)) { sendJson(res, 404, { error: 'tema não encontrado' }); return; }
      broadcastThemes();
      sendJson(res, 200, { deleted: id });
      return;
    }
    if (parts[4] === 'media' && parts.length === 5 && req.method === 'PUT') {
      upload(req, res, id, parsed.query.name, parsed.query.fit);
      return;
    }
    if (parts[4] === 'media' && parts.length === 6 && req.method === 'POST') {
      setFit(req, res, id, decodeURIComponent(parts[5]));
      return;
    }
    if (parts[4] === 'media' && parts.length === 6 && req.method === 'DELETE') {
      if (!common.removeMedia(id, decodeURIComponent(parts[5]))) {
        sendJson(res, 404, { error: 'arquivo não encontrado' });
        return;
      }
      broadcastThemes();
      sendJson(res, 200, { deleted: parts[5] });
      return;
    }
  }
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
