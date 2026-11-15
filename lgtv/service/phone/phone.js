// Minha TV phone page: changes the TV's settings through the TV's own
// server (server.js). Every tap saves at once; changes made on the TV with
// the remote arrive here live.
(function () {
  var code = (location.hash.match(/t=([0-9a-f]+)/) || [])[1] || '';
  var IDLE = [[0, 'Desligado'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']];
  var state = { settings: {}, defaults: {}, catalog: null };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(glyph) {
    var span = el('span', 'icon');
    span.innerHTML = window.Tiles ? Tiles.svg(glyph || 'play') : ''; // static markup from tiles.js
    return span;
  }

  function status(text, kind) {
    var node = $('status');
    node.textContent = text;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function fail(message) {
    status('erro', 'bad');
    var node = $('error');
    node.textContent = message;
    node.hidden = false;
  }

  function api(method, route, body) {
    var options = { method: method, cache: 'no-store', headers: { 'X-Token': code } };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(route, options).then(function (res) {
      return res.json().then(function (data) {
        if (res.status === 401) throw new Error('Este link não tem o código de acesso. Abra o link que aparece na TV (aba Temas).');
        if (!res.ok) throw new Error((data.errors || [data.error]).join(', '));
        return data;
      });
    });
  }

  // What the TV is using: saved choices over the app's defaults.
  function effective() {
    var s = state.settings;
    var d = state.defaults;
    var wallpaper = {};
    var k;
    for (k in d.wallpaper || {}) wallpaper[k] = d.wallpaper[k];
    for (k in s.wallpaper || {}) wallpaper[k] = s.wallpaper[k];
    return {
      theme: s.theme || d.theme,
      favorites: s.favorites || d.favorites || [],
      idleSeconds: s.idleSeconds !== undefined ? s.idleSeconds : d.idleSeconds,
      wallpaper: wallpaper
    };
  }

  function save(change) {
    status('salvando…');
    return api('POST', '/api/settings', change).then(function (res) {
      state.settings = res.settings;
      render();
      status('salvo na TV', 'ok');
    }).catch(function (e) { fail(e.message); });
  }

  function items() {
    var c = state.catalog;
    return c.inputs.map(function (p) { p.kind = 'Entrada'; return p; })
      .concat(c.apps.map(function (p) { p.kind = 'App'; return p; }));
  }

  function byId(id) {
    var all = items();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function renderThemes(eff) {
    var box = $('themes');
    box.innerHTML = '';
    state.catalog.themes.forEach(function (t) {
      var b = el('button', 'chip' + (t.id === eff.theme ? ' on' : ''), t.name);
      b.onclick = function () { save({ theme: t.id }); };
      box.appendChild(b);
    });
  }

  function renderWalls(eff) {
    var theme = state.catalog.themes.filter(function (t) { return t.id === eff.theme; })[0];
    var box = $('walls');
    box.innerHTML = '';
    if (!theme) return;
    $('wall-title').textContent = 'Papel de parede — ' + theme.name;
    var options = theme.wallpapers.concat([{ file: 'none', name: 'Desenhado (sem vídeo)' }]);
    options.forEach(function (w) {
      var on = eff.wallpaper[theme.id] === w.file;
      var row = el('button', 'row' + (on ? ' on' : ''));
      row.appendChild(icon(w.file === 'none' ? 'image' : 'play'));
      row.appendChild(el('span', 'name', w.name));
      if (on) row.appendChild(el('span', 'check', '✓'));
      row.onclick = function () {
        var change = {};
        change[theme.id] = w.file;
        save({ wallpaper: change });
      };
      box.appendChild(row);
    });
  }

  function renderFavorites(eff) {
    var list = $('favs');
    list.innerHTML = '';
    var favs = eff.favorites;
    favs.forEach(function (id, i) {
      var item = byId(id);
      var row = el('li', 'row' + (item ? '' : ' missing'));
      row.appendChild(icon(item ? item.glyph : 'play'));
      row.appendChild(el('span', 'name', item ? item.title : id));
      // Outside the name, so a long id never cuts it off.
      if (!item) row.appendChild(el('span', 'sub', 'não encontrado'));
      if (item && item.live) row.appendChild(el('span', 'dot'));
      var actions = el('span', 'actions');
      function button(label, title, disabled, next) {
        var b = el('button', 'icon-btn', label);
        b.title = title;
        b.disabled = disabled;
        b.onclick = function () { save({ favorites: next() }); };
        actions.appendChild(b);
      }
      button('↑', 'Subir', i === 0, function () {
        var copy = favs.slice(); copy.splice(i - 1, 0, copy.splice(i, 1)[0]); return copy;
      });
      button('↓', 'Descer', i === favs.length - 1, function () {
        var copy = favs.slice(); copy.splice(i + 1, 0, copy.splice(i, 1)[0]); return copy;
      });
      button('✕', 'Tirar dos favoritos', false, function () {
        return favs.filter(function (x) { return x !== id; });
      });
      row.appendChild(actions);
      list.appendChild(row);
    });

    var add = $('add');
    add.innerHTML = '';
    items().filter(function (p) { return favs.indexOf(p.id) < 0; }).forEach(function (p) {
      var row = el('button', 'row');
      row.appendChild(icon(p.glyph));
      row.appendChild(el('span', 'name', p.title));
      row.appendChild(el('span', 'sub', p.kind));
      if (p.live) row.appendChild(el('span', 'dot'));
      row.appendChild(el('span', 'check', '+'));
      row.onclick = function () { save({ favorites: favs.concat([p.id]) }); };
      add.appendChild(row);
    });
  }

  function renderIdle(eff) {
    var box = $('idle');
    box.innerHTML = '';
    IDLE.forEach(function (opt) {
      var b = el('button', 'chip' + (opt[0] === eff.idleSeconds ? ' on' : ''), opt[1]);
      b.onclick = function () { save({ idleSeconds: opt[0] }); };
      box.appendChild(b);
    });
  }

  function render() {
    var eff = effective();
    renderThemes(eff);
    renderWalls(eff);
    renderFavorites(eff);
    renderIdle(eff);
  }

  // Changes made on the TV (or another phone) arrive here.
  function listen() {
    var source = new EventSource('/api/events?t=' + code);
    source.addEventListener('settings', function (e) {
      state.settings = JSON.parse(e.data);
      render();
      status('conectado', 'ok');
    });
    source.onerror = function () { status('reconectando…'); };
  }

  if (!code) {
    fail('Este link não tem o código de acesso. Abra o link que aparece na TV (aba Temas).');
    return;
  }

  Promise.all([api('GET', '/api/settings'), api('GET', '/api/catalog')]).then(function (res) {
    state.settings = res[0].settings;
    state.defaults = res[0].defaults;
    state.catalog = res[1];
    $('main').hidden = false;
    render();
    status('conectado', 'ok');
    listen();
  }).catch(function (e) { fail(e.message); });
})();
