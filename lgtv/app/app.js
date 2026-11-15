// Minha TV: custom home screen for a rooted LG webOS TV.
// Plain ES5 on purpose: rooted TVs range from webOS 3 (Chromium 38) upward.
(function () {
  var APP_ID = 'io.github.marianovale.lgtv';
  var SERVICE = 'luna://' + APP_ID + '.service/';
  var APPMGR = 'luna://com.webos.applicationManager/';
  var STORE = { favorites: 'lgtv.favorites', theme: 'lgtv.theme', last: 'lgtv.last', wallpaper: 'lgtv.wallpaper' };
  var LONG_PRESS_MS = 700;
  var INPUT_IDS = /hdmi|livetv|externalinput|\.av\d|component|tvhub/i;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, RED: 403, GREEN: 404 };

  var TABS = [
    { id: 'favoritos', label: 'Favoritos' },
    { id: 'apps', label: 'Todos os apps' },
    { id: 'entradas', label: 'Entradas' },
    { id: 'temas', label: 'Temas' },
    { id: 'wallpaper', label: 'Papel de parede' }
  ];

  var state = {
    points: [],          // launch points from the TV, in TV order
    inputs: null,        // TV inputs (Tiles.inputPoints); null until listed or unavailable
    loadError: null,     // text when the list could not be read
    limited: false,      // showing CONFIG.knownApps because the TV refused the list
    listed: false,       // whether the TV answered the first list request
    favorites: [],       // app ids, in the user's order
    tab: 'favoritos',
    theme: null,
    wallpaper: {},       // themeId -> chosen background file, or 'none'
    last: null,          // id of the app opened last
    focusKey: null,      // data-key of the focused element
    trackOffset: 0
  };

  // ---- Storage ------------------------------------------------------------

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* session only */ }
  }

  // ---- Luna bus -----------------------------------------------------------

  var pendingBridges = [];

  function luna(uri, params, done) {
    if (typeof PalmServiceBridge === 'undefined') {
      done({ returnValue: false, errorText: 'Fora da TV: PalmServiceBridge não existe.' });
      return;
    }
    var bridge = new PalmServiceBridge();
    // The bridge must stay referenced until it answers, or it can be
    // garbage-collected and the callback never runs.
    pendingBridges.push(bridge);
    bridge.onservicecallback = function (raw) {
      var i = pendingBridges.indexOf(bridge);
      if (i >= 0) pendingBridges.splice(i, 1);
      var response;
      try { response = JSON.parse(raw); }
      catch (e) { response = { returnValue: false, errorText: 'Resposta inválida: ' + raw }; }
      done(response);
    };
    bridge.call(uri, JSON.stringify(params || {}));
  }

  // What each service method calls on the system when the service is not
  // there (some firmwares still allow these to ordinary apps).
  var DIRECT = {
    listLaunchPoints: APPMGR + 'listLaunchPoints',
    launch: APPMGR + 'launch',
    listInputs: 'luna://com.webos.service.eim/getAllInputStatus'
  };

  // Our root (elevated) service first; then the system directly.
  function system(method, params, done) {
    luna(SERVICE + method, params, function (viaService) {
      if (viaService.returnValue) { done(viaService); return; }
      luna(DIRECT[method], params, function (direct) {
        if (direct.returnValue) { done(direct); return; }
        done({
          returnValue: false,
          errorText: viaService.errorText || direct.errorText || 'erro desconhecido'
        });
      });
    });
  }

  // ---- Apps ---------------------------------------------------------------

  // Inputs first: their names ("XBOX") come from the TV's input manager.
  function findPoint(id) {
    var lists = [state.inputs || [], state.points];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        if (lists[l][i].id === id) return lists[l][i];
      }
    }
    return null;
  }

  function refresh() {
    system('listLaunchPoints', {}, function (r) {
      var hidden = CONFIG.hidden || [];
      var visible = function (p) { return p && p.id && hidden.indexOf(p.id) < 0; };
      if (r.returnValue) {
        state.loadError = null;
        state.limited = false;
        state.points = (r.launchPoints || []).filter(visible);
      } else if (CONFIG.knownApps && CONFIG.knownApps.length) {
        // Without root (Developer Mode only) the TV may refuse the list;
        // launching still works, so fall back to the configured apps.
        state.loadError = null;
        state.limited = true;
        state.points = CONFIG.knownApps.filter(visible);
      } else {
        state.loadError = r.errorText;
      }
      // The first list decides the starting focus ("Continuar" when there
      // is an app to continue); later reloads keep wherever the user is.
      if (!state.listed) { state.listed = true; state.focusKey = null; }
      renderHero();
      renderRow();
    });
    refreshInputs();
    checkRoot();
  }

  // Inputs are not launch points on webOS 4, so they come from the input
  // manager, which also tells which ones have a picture right now.
  function refreshInputs() {
    system('listInputs', {}, function (r) {
      var hidden = CONFIG.hidden || [];
      state.inputs = r.returnValue
        ? Tiles.inputPoints(r.devices).filter(function (p) { return hidden.indexOf(p.id) < 0; })
        : null;
      // Favorites can be inputs too.
      if (state.tab === 'entradas' || state.tab === 'favoritos') renderRow();
      renderHero();
    });
  }

  function checkRoot() {
    luna(SERVICE + 'status', {}, function (r) {
      // Only shown when something is wrong; a working setup stays quiet.
      document.getElementById('root-badge').hidden = r.returnValue && r.uid === 0;
    });
  }

  function launch(id) {
    var point = findPoint(id);
    var params = { id: point && point.appId ? point.appId : id };
    if (point && point.params) params.params = point.params;
    system('launch', params, function (r) {
      if (!r.returnValue) { toast('Não abriu: ' + r.errorText); return; }
      state.last = id;
      save(STORE.last, id);
      renderHero();
    });
  }

  function toggleFavorite(id) {
    var point = findPoint(id);
    var name = point ? point.title : id;
    var i = state.favorites.indexOf(id);
    if (i >= 0) {
      state.favorites.splice(i, 1);
      toast(name + ' saiu dos favoritos');
    } else {
      state.favorites.push(id);
      toast(name + ' foi para os favoritos');
    }
    save(STORE.favorites, state.favorites);
    pushSettings({ favorites: state.favorites });
    renderRow();
  }

  function rowPoints(tab) {
    if (tab === 'favoritos') {
      var out = [];
      for (var f = 0; f < state.favorites.length; f++) {
        var p = findPoint(state.favorites[f]);
        if (p) out.push(p);
      }
      return out;
    }
    if (tab === 'entradas') {
      if (state.inputs && state.inputs.length) return state.inputs;
      // No input manager (e.g. Developer Mode): inputs among the apps.
      return state.points.filter(function (p) { return INPUT_IDS.test(p.id); });
    }
    return state.points;
  }

  // ---- Themes -------------------------------------------------------------

  function useTheme(id, announce) {
    var theme = Themes.find(id) || Themes.find(CONFIG.theme) || Themes.list()[0];
    if (!theme) return;
    state.theme = theme;
    applyTheme(theme);
    renderHero();
    if (announce) {
      save(STORE.theme, theme.id);
      pushSettings({ theme: theme.id });
      toast('Tema: ' + theme.name);
      if (state.tab === 'temas') renderRow();
    }
  }

  function applyTheme(theme) {
    Themes.apply(theme, {
      effects: CONFIG.effects !== false,
      background: effectiveWallpaper(theme)
    });
  }

  // What the picker saved for this theme (a filename or 'none'); undefined
  // lets the engine fall back to CONFIG.background / fundo.*.
  function effectiveWallpaper(theme) {
    return theme ? state.wallpaper[theme.id] : undefined;
  }

  // The choice shown as "Em uso": the saved pick, else the config default.
  function currentWallpaper(theme) {
    if (!theme) return null;
    var saved = state.wallpaper[theme.id];
    if (saved !== undefined) return saved;
    return (CONFIG.background && CONFIG.background[theme.id]) || null;
  }

  // ---- Rendering ----------------------------------------------------------

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderHero() {
    var hero = state.theme ? state.theme.hero : {};
    document.getElementById('kicker').textContent = hero.kicker || '';
    document.getElementById('title').textContent = hero.title || CONFIG.name;
    document.getElementById('tagline').textContent = hero.tagline || '';

    var target = continueTarget();
    var button = document.querySelector('[data-key="btn:continue"]');
    button.hidden = !target;
    if (target) {
      document.getElementById('continue-label').textContent =
        (target.id === state.last ? 'Continuar · ' : 'Abrir · ') + target.title;
    }
  }

  // The app opened last, else the first favorite, else nothing.
  function continueTarget() {
    var last = state.last && findPoint(state.last);
    if (last) return last;
    return rowPoints('favoritos')[0] || null;
  }

  function renderTabs() {
    var nav = document.getElementById('tabs');
    nav.innerHTML = '';
    for (var i = 0; i < TABS.length; i++) {
      var tab = el('div', 'tab focusable' + (TABS[i].id === state.tab ? ' active' : ''), TABS[i].label);
      tab.setAttribute('data-key', 'tab:' + TABS[i].id);
      tab.appendChild(el('span', 'bar'));
      nav.appendChild(tab);
    }
  }

  // Minimal tile: a line icon for the kind of app and its name.
  function appTile(point) {
    var tile = el('div', 'tile focusable');
    tile.setAttribute('data-key', 'app:' + point.id);
    var card = el('div', 'card');
    var top = el('div', 'card-top');
    var glyph = el('div', 'glyph');
    glyph.innerHTML = Tiles.svg(Tiles.glyphFor(point)); // static markup from tiles.js
    top.appendChild(glyph);
    // Markers sit beside the icon, so long names never run under them.
    var marks = el('div', 'marks');
    if (point.live) marks.appendChild(el('span', 'live'));
    if (state.favorites.indexOf(point.id) >= 0 && state.tab !== 'favoritos') {
      marks.appendChild(el('span', 'star', '★'));
    }
    top.appendChild(marks);
    card.appendChild(top);
    card.appendChild(el('div', 'label', point.title || point.id));
    tile.appendChild(card);
    return tile;
  }

  function themeTile(theme) {
    var tile = el('div', 'tile focusable');
    tile.setAttribute('data-key', 'theme:' + theme.id);
    var card = el('div', 'card visual theme-card');
    card.style.background = theme.backdrop;
    card.style.backgroundColor = theme.colors.background;
    // The theme's own image, when it has one, makes the preview.
    Themes.themeImage(theme, function (url) {
      if (!url) return;
      card.style.backgroundImage =
        'linear-gradient(0deg, rgba(0, 0, 0, 0.65) 0%, rgba(0, 0, 0, 0) 60%), url("' + url + '")';
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = theme.imagePosition || 'center';
    });
    var name = el('div', 'theme-name', theme.name);
    name.style.fontFamily = theme.font.display;
    card.appendChild(name);
    if (state.theme && state.theme.id === theme.id) card.appendChild(el('div', 'chip', 'Em uso'));
    tile.appendChild(card);
    return tile;
  }

  // A wallpaper option for the current theme: the drawn backdrop as the
  // preview, its name, and an "Em uso" chip on the active choice.
  function wallpaperTile(theme, file, name) {
    var tile = el('div', 'tile focusable');
    tile.setAttribute('data-key', 'wall:' + file);
    var card = el('div', 'card visual');
    if (theme) {
      card.style.background = theme.backdrop;
      card.style.backgroundColor = theme.colors.background;
    }
    card.appendChild(el('div', 'label', name));
    if (currentWallpaper(theme) === file) card.appendChild(el('div', 'chip', 'Em uso'));
    tile.appendChild(card);
    return tile;
  }

  function renderRow() {
    var track = document.getElementById('track');
    var message = document.getElementById('row-message');
    track.innerHTML = '';
    message.hidden = true;

    if (state.tab === 'temas') {
      var themes = Themes.list();
      for (var t = 0; t < themes.length; t++) track.appendChild(themeTile(themes[t]));
      setHint(phoneHint('OK aplica o tema'));
    } else if (state.tab === 'wallpaper') {
      var theme = state.theme;
      var list = (theme && theme.wallpapers) ? theme.wallpapers : [];
      for (var w = 0; w < list.length; w++) {
        track.appendChild(wallpaperTile(theme, list[w].file, list[w].name));
      }
      track.appendChild(wallpaperTile(theme, 'none', 'Desenhado (sem vídeo)'));
      setHint(phoneHint('OK escolhe o papel de parede de ' + (theme ? theme.name : '')));
      if (!list.length) {
        showRowMessage('O tema <b>' + escapeHtml(theme ? theme.name : '') + '</b> não tem vídeos. ' +
          'Coloque arquivos em <code>themes/' + escapeHtml(theme ? theme.id : '') +
          '/</code> e liste-os em <code>wallpapers</code> no theme.js.');
      }
    } else {
      var points = rowPoints(state.tab);
      for (var i = 0; i < points.length; i++) track.appendChild(appTile(points[i]));
      setHint(state.limited && state.tab !== 'favoritos'
        ? 'Lista básica (sem root): edite knownApps em config.js'
        : points.length ? 'Segure OK para favoritar' : '');
      if (state.loadError) {
        showRowMessage(
          'Não consegui listar os apps da TV (' + escapeHtml(state.loadError) + ').<br>' +
          'O serviço precisa de root: no computador, rode <code>./lgtv/install.sh IP-DA-TV</code>.'
        );
      } else if (!points.length && state.tab === 'favoritos') {
        showRowMessage('Nenhum favorito ainda. Em <b>Todos os apps</b>, segure OK num app para fixá-lo aqui.');
      } else if (!points.length) {
        showRowMessage('Nada por aqui.');
      }
    }

    // Keep focus on the same element when it still exists.
    state.trackOffset = 0;
    track.style.transform = 'translateX(0px)';
    var key = state.focusKey;
    var keep = key && document.querySelector('[data-key="' + cssEscape(key) + '"]');
    if (keep && !keep.hidden) {
      setFocus(keep);
    } else if (key && key.indexOf('btn:') !== 0) {
      // The focused tile is gone (e.g. removed from favorites).
      setFocus(track.querySelector('.focusable') || tabNode(state.tab));
    } else {
      setFocus(topNode());
    }
  }

  function tabNode(id) {
    return document.querySelector('[data-key="tab:' + id + '"]');
  }

  // The natural starting point: the Continuar button when the hero is shown,
  // otherwise the last-used app's tile, the first tile, or the active tab.
  function topNode() {
    var button = document.querySelector('[data-key="btn:continue"]');
    if (button && !button.hidden && button.offsetParent !== null) return button;
    return lastUsedTile() || firstVisibleTile() || tabNode(state.tab);
  }

  function lastUsedTile() {
    if (!state.last) return null;
    var tile = document.querySelector('[data-key="app:' + cssEscape(state.last) + '"]');
    return tile && tile.offsetParent !== null ? tile : null;
  }

  function showRowMessage(html) {
    var message = document.getElementById('row-message');
    message.innerHTML = html;
    message.hidden = false;
  }

  function setHint(text) {
    document.getElementById('hint').textContent = text;
  }

  function cssEscape(text) {
    return String(text).replace(/["\\]/g, '\\$&');
  }

  // ---- Focus --------------------------------------------------------------

  function focusables() {
    return Array.prototype.filter.call(document.querySelectorAll('.focusable'), function (node) {
      // offsetParent is null for anything inside a hidden section (e.g. the
      // hero when showHero is off), so those stop being reachable.
      return !node.hidden && node.offsetParent !== null;
    });
  }

  function setFocus(node) {
    if (!node) return;
    var old = document.querySelectorAll('.focused');
    for (var i = 0; i < old.length; i++) old[i].className = old[i].className.replace(/ ?focused/g, '');
    node.className += ' focused';
    state.focusKey = node.getAttribute('data-key');

    // Moving across tabs switches the row right away.
    if (isTab(state.focusKey)) {
      var tab = state.focusKey.slice(4);
      if (tab !== state.tab) {
        state.tab = tab;
        renderTabs();
        renderRow(); // refocuses the new tab element by its key
        if (tab === 'entradas') refreshInputs(); // pictures come and go
        return;
      }
    }
    if (node.className.indexOf('tile') >= 0) keepInRow(node);
  }

  // Slides the row so the focused tile is fully visible.
  function keepInRow(tile) {
    var row = document.getElementById('row');
    var track = document.getElementById('track');
    // Tile offsets are inside the positioned track and ignore its transform;
    // keep a right margin like the screen's left one.
    var visible = row.clientWidth - track.offsetLeft - 120;
    var left = tile.offsetLeft;
    var right = left + tile.offsetWidth;
    var offset = state.trackOffset;
    if (left < offset) offset = left;
    else if (right > offset + visible) offset = right - visible;
    if (offset !== state.trackOffset) {
      state.trackOffset = offset;
      track.style.transform = 'translateX(' + (-offset) + 'px)';
    }
  }

  function move(direction) {
    var nodes = focusables();
    var from = -1;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-key') === state.focusKey) { from = i; break; }
    }
    if (from < 0) { setFocus(nodes[0]); return; }
    var rects = nodes.map(function (node) {
      var r = node.getBoundingClientRect();
      // Use the resting position of tiles, not the scaled focused one.
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    var next = Nav.pick(rects, from, direction);
    if (next < 0) return;
    var fromTab = isTab(state.focusKey);
    var toKey = nodes[next].getAttribute('data-key');
    // Tabs switch the row on focus, so entering the tab line from above or
    // below lands on the active tab instead of whichever is closest.
    if (isTab(toKey) && !fromTab) { setFocus(tabNode(state.tab)); return; }
    // Leaving the tabs downwards starts at the first tile on screen.
    if (fromTab && direction === 'down') { setFocus(firstVisibleTile() || nodes[next]); return; }
    setFocus(nodes[next]);
  }

  function isTab(key) {
    return !!key && key.indexOf('tab:') === 0;
  }

  function firstVisibleTile() {
    var tiles = document.querySelectorAll('#track .focusable');
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].offsetLeft >= state.trackOffset) return tiles[i];
    }
    return tiles[0] || null;
  }

  function activate(key) {
    if (!key) return;
    if (key === 'btn:continue') {
      var target = continueTarget();
      if (target) launch(target.id);
    } else if (key === 'btn:themes') {
      setFocus(tabNode('temas'));
    } else if (isTab(key)) {
      setFocus(firstVisibleTile() || tabNode(key.slice(4)));
    } else if (key.indexOf('app:') === 0) {
      launch(key.slice(4));
    } else if (key.indexOf('theme:') === 0) {
      useTheme(key.slice(6), true);
    } else if (key.indexOf('wall:') === 0) {
      chooseWallpaper(key.slice(5));
    }
  }

  function chooseWallpaper(file) {
    var theme = state.theme;
    if (!theme) return;
    state.wallpaper[theme.id] = file;
    save(STORE.wallpaper, state.wallpaper);
    var change = {};
    change[theme.id] = file;
    pushSettings({ wallpaper: change });
    applyTheme(theme); // live, over the current screen
    toast(file === 'none' ? 'Papel de parede: desenhado' : 'Papel de parede atualizado');
    renderRow();
  }

  function favoriteAction(key) {
    if (key && key.indexOf('app:') === 0) toggleFavorite(key.slice(4));
  }

  // ---- Messages -----------------------------------------------------------

  var toastTimer = null;
  function toast(text) {
    var node = document.getElementById('toast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2200);
  }

  // ---- Settings shared with the phone --------------------------------------

  // With the phone server running on the TV (server.js, started by
  // autostart.sh), theme, wallpapers, favorites and the idle delay live in its
  // settings file: the phone page and the remote both change them, and each
  // side applies the other's changes live. Without it (e.g. Developer Mode)
  // the app keeps them only in its own storage, as before.
  var sync = { base: null, token: null, url: null };

  function http(method, route, body, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, sync.base + route, true);
    xhr.setRequestHeader('X-Token', sync.token);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      done(xhr.status >= 200 && xhr.status < 300 ? null : (xhr.status || 'rede'), data);
    };
    if (body) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
    } else {
      xhr.send();
    }
  }

  function startSync() {
    luna(SERVICE + 'phoneLink', {}, function (r) {
      if (!r.returnValue || !r.token || !r.port) return;
      sync.base = 'http://127.0.0.1:' + r.port;
      sync.token = r.token;
      sync.url = r.url;
      if (state.tab === 'temas' || state.tab === 'wallpaper') renderRow(); // show the link
      http('GET', '/api/settings', null, function (err, res) {
        if (err || !res) return;
        // First run with the server: it starts from what this TV already has.
        // One field per request, so a stale value cannot block the others.
        if (!res.saved) {
          var local = localSettings();
          for (var field in local) {
            var one = {};
            one[field] = local[field];
            pushSettings(one);
          }
        } else {
          applyRemote(res.settings);
        }
        listen();
      });
    });
  }

  function localSettings() {
    return {
      theme: state.theme ? state.theme.id : CONFIG.theme,
      favorites: state.favorites,
      wallpaper: state.wallpaper,
      idleSeconds: idleSecondsSetting()
    };
  }

  function pushSettings(change) {
    if (!sync.base) return;
    http('POST', '/api/settings', change, function () { /* the event stream echoes it */ });
  }

  function listen() {
    if (typeof EventSource === 'undefined') return;
    var source = new EventSource(sync.base + '/api/events?t=' + sync.token);
    source.addEventListener('settings', function (e) {
      try { applyRemote(JSON.parse(e.data)); } catch (err) { /* ignore a bad frame */ }
    });
  }

  // Applies settings that may come from the phone. Each field only when it
  // changed, so the echo of our own change does nothing.
  function applyRemote(s) {
    if (!s) return;
    var rerender = false;
    if (s.favorites && JSON.stringify(s.favorites) !== JSON.stringify(state.favorites)) {
      state.favorites = s.favorites.slice();
      save(STORE.favorites, state.favorites);
      rerender = true;
    }
    if (s.idleSeconds !== undefined && s.idleSeconds !== idleSecondsSetting()) {
      CONFIG.idleSeconds = s.idleSeconds;
      armIdle();
    }
    var wallChanged = s.wallpaper && JSON.stringify(s.wallpaper) !== JSON.stringify(state.wallpaper);
    if (wallChanged) {
      state.wallpaper = JSON.parse(JSON.stringify(s.wallpaper));
      save(STORE.wallpaper, state.wallpaper);
    }
    if (s.theme && (!state.theme || s.theme !== state.theme.id) && Themes.find(s.theme)) {
      save(STORE.theme, s.theme);
      useTheme(s.theme, false); // also applies the wallpaper
      rerender = true;
    } else if (wallChanged && state.theme) {
      applyTheme(state.theme);
      rerender = true;
    }
    if (rerender) {
      renderRow();
      renderHero();
    }
  }

  function phoneHint(text) {
    return sync.url ? 'Pelo celular: ' + sync.url : text;
  }

  // ---- Clock --------------------------------------------------------------

  var WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var now = new Date();
    var weekday = WEEKDAYS[now.getDay()];
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var date = weekday.charAt(0).toUpperCase() + weekday.slice(1) + ', ' +
      now.getDate() + ' de ' + MONTHS[now.getMonth()];
    document.getElementById('time').textContent = time;
    document.getElementById('date').textContent = date;
    document.getElementById('ambient-time').textContent = time;
    document.getElementById('ambient-date').textContent = date;
  }

  // ---- Idle ---------------------------------------------------------------

  // After CONFIG.idleSeconds without the remote only the wallpaper and the
  // time stay on screen. Any key or pointer move brings the rest back, and
  // that first press only wakes the screen.
  var idleTimer = null;

  function idleSecondsSetting() {
    return CONFIG.idleSeconds === undefined ? 30 : CONFIG.idleSeconds;
  }

  function idleMs() {
    var seconds = idleSecondsSetting();
    return seconds > 0 ? seconds * 1000 : 0;
  }

  function isIdle() {
    return document.body.classList.contains('idle');
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (idleMs() && !document.hidden) {
      idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, idleMs());
    }
  }

  // Returns true when this input only woke the screen.
  function wake() {
    var wasIdle = isIdle();
    document.body.classList.remove('idle');
    armIdle();
    return wasIdle;
  }

  // ---- Keys ---------------------------------------------------------------

  var enterDownAt = 0;
  var longPressTimer = null;
  var longPressFired = false;

  function onKeyDown(e) {
    if (wake()) { e.preventDefault(); return; }
    switch (e.keyCode) {
      case KEY.LEFT: move('left'); break;
      case KEY.RIGHT: move('right'); break;
      case KEY.UP: move('up'); break;
      case KEY.DOWN: move('down'); break;
      case KEY.ENTER:
        if (enterDownAt) break; // auto-repeat while held
        enterDownAt = Date.now();
        longPressFired = false;
        if (state.focusKey && state.focusKey.indexOf('app:') === 0) {
          longPressTimer = setTimeout(function () {
            longPressFired = true;
            favoriteAction(state.focusKey);
          }, LONG_PRESS_MS);
        }
        break;
      case KEY.RED:
        favoriteAction(state.focusKey);
        break;
      case KEY.GREEN:
        toast('Recarregando apps…');
        refresh();
        break;
      case KEY.BACK:
        // This is the home screen: Back returns to the top, never exits.
        setFocus(topNode());
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.keyCode !== KEY.ENTER) return;
    clearTimeout(longPressTimer);
    var wasDown = enterDownAt;
    enterDownAt = 0;
    if (wasDown && !longPressFired) activate(state.focusKey);
    e.preventDefault();
  }

  // Magic Remote pointer: hover focuses, click activates.
  function onPointer(e) {
    if (wake()) return;
    var node = e.target;
    while (node && node !== document.body && !(node.className && /\bfocusable\b/.test(node.className))) {
      node = node.parentNode;
    }
    if (!node || node === document.body) return;
    if (e.type === 'mouseover') {
      if (node.getAttribute('data-key') !== state.focusKey) setFocus(node);
    } else {
      setFocus(node);
      activate(node.getAttribute('data-key'));
    }
  }

  // ---- Start --------------------------------------------------------------

  function start() {
    // Wallpaper-forward home by default: the hero (big title + buttons) is
    // hidden unless CONFIG.showHero is on.
    if (!CONFIG.showHero) document.body.classList.add('wallpaper');
    document.getElementById('brand').textContent = CONFIG.name;
    document.getElementById('clock').hidden = !CONFIG.showClock;
    document.getElementById('ambient').hidden = !CONFIG.showClock;
    var savedFavorites = load(STORE.favorites);
    state.favorites = savedFavorites && savedFavorites.length !== undefined
      ? savedFavorites : CONFIG.favorites.slice();
    state.last = load(STORE.last);
    state.wallpaper = load(STORE.wallpaper) || {};

    Themes.loadFonts();
    useTheme(load(STORE.theme) || CONFIG.theme, false);
    renderTabs();
    renderRow();

    tick();
    setInterval(tick, 15000);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mouseover', onPointer);
    document.addEventListener('click', onPointer);
    document.addEventListener('mousemove', wake);
    // Opened again from the launcher, or brought back to the front: show the
    // whole screen, and apps may have been installed or removed meanwhile.
    document.addEventListener('webOSRelaunch', function () {
      wake();
      refresh();
    });
    document.addEventListener('visibilitychange', function () {
      Themes.onVisibility(CONFIG.effects !== false);
      if (document.hidden) {
        clearTimeout(idleTimer);
      } else {
        wake();
        refresh();
      }
    });

    armIdle();
    refresh();
    startSync();
  }

  start();
})();
