// Minha TV: custom home screen for a rooted LG webOS TV.
// Plain ES5 on purpose: rooted TVs range from webOS 3 (Chromium 38) upward.
(function () {
  var APP_ID = 'io.github.marianovale.lgtv';
  var SERVICE = 'luna://' + APP_ID + '.service/';
  var APPMGR = 'luna://com.webos.applicationManager/';
  var STORE = { favorites: 'lgtv.favorites', theme: 'lgtv.theme', last: 'lgtv.last' };
  var LONG_PRESS_MS = 700;
  var INPUT_IDS = /hdmi|livetv|externalinput|\.av\d|component|tvhub/i;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, RED: 403, GREEN: 404 };

  var TABS = [
    { id: 'favoritos', label: 'Favoritos' },
    { id: 'apps', label: 'Todos os apps' },
    { id: 'entradas', label: 'Entradas' },
    { id: 'temas', label: 'Temas' }
  ];

  var state = {
    points: [],          // launch points from the TV, in TV order
    loadError: null,     // text when the list could not be read
    limited: false,      // showing CONFIG.knownApps because the TV refused the list
    listed: false,       // whether the TV answered the first list request
    favorites: [],       // app ids, in the user's order
    tab: 'favoritos',
    theme: null,
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

  // Our root (elevated) service first; then the system directly, which some
  // firmwares still allow to ordinary apps.
  function system(method, params, done) {
    luna(SERVICE + method, params, function (viaService) {
      if (viaService.returnValue) { done(viaService); return; }
      luna(APPMGR + method, params, function (direct) {
        if (direct.returnValue) { done(direct); return; }
        done({
          returnValue: false,
          errorText: viaService.errorText || direct.errorText || 'erro desconhecido'
        });
      });
    });
  }

  // ---- Apps ---------------------------------------------------------------

  function findPoint(id) {
    for (var i = 0; i < state.points.length; i++) {
      if (state.points[i].id === id) return state.points[i];
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
    checkRoot();
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
      return state.points.filter(function (p) { return INPUT_IDS.test(p.id); });
    }
    return state.points;
  }

  // ---- Themes -------------------------------------------------------------

  function useTheme(id, announce) {
    var theme = Themes.find(id) || Themes.find(CONFIG.theme) || Themes.list()[0];
    if (!theme) return;
    state.theme = theme;
    Themes.apply(theme, { effects: CONFIG.effects !== false });
    renderHero();
    if (announce) {
      save(STORE.theme, theme.id);
      toast('Tema: ' + theme.name);
      if (state.tab === 'temas') renderRow();
    }
  }

  // ---- Rendering ----------------------------------------------------------

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function iconUrl(path) {
    if (!path) return '';
    return path.charAt(0) === '/' ? 'file://' + path : path;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function initial(title) {
    return el('span', 'initial', (title || '?').charAt(0).toUpperCase());
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

  function appTile(point) {
    var tile = el('div', 'tile focusable');
    tile.setAttribute('data-key', 'app:' + point.id);
    var card = el('div', 'card');
    if (point.bgColor) card.style.backgroundColor = point.bgColor;

    var src = iconUrl(point.largeIcon || point.icon);
    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.onerror = function () {
        if (img.parentNode) card.replaceChild(initial(point.title), img);
      };
      card.appendChild(img);
    } else {
      card.appendChild(initial(point.title));
    }
    if (state.favorites.indexOf(point.id) >= 0 && state.tab !== 'favoritos') {
      card.appendChild(el('div', 'star', '★'));
    }
    card.appendChild(el('div', 'label', point.title || point.id));
    tile.appendChild(card);
    return tile;
  }

  function themeTile(theme) {
    var tile = el('div', 'tile focusable');
    tile.setAttribute('data-key', 'theme:' + theme.id);
    var card = el('div', 'card theme-card');
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

  function renderRow() {
    var track = document.getElementById('track');
    var message = document.getElementById('row-message');
    track.innerHTML = '';
    message.hidden = true;

    if (state.tab === 'temas') {
      var themes = Themes.list();
      for (var t = 0; t < themes.length; t++) track.appendChild(themeTile(themes[t]));
      setHint('OK aplica o tema');
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
    }
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

  // ---- Clock --------------------------------------------------------------

  var WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var now = new Date();
    var weekday = WEEKDAYS[now.getDay()];
    document.getElementById('time').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
    document.getElementById('date').textContent =
      weekday.charAt(0).toUpperCase() + weekday.slice(1) + ', ' +
      now.getDate() + ' de ' + MONTHS[now.getMonth()];
  }

  // ---- Keys ---------------------------------------------------------------

  var enterDownAt = 0;
  var longPressTimer = null;
  var longPressFired = false;

  function onKeyDown(e) {
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
    if (!CONFIG.showHero) document.body.className = 'wallpaper';
    document.getElementById('brand').textContent = CONFIG.name;
    document.getElementById('clock').hidden = !CONFIG.showClock;
    var savedFavorites = load(STORE.favorites);
    state.favorites = savedFavorites && savedFavorites.length !== undefined
      ? savedFavorites : CONFIG.favorites.slice();
    state.last = load(STORE.last);

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
    // Opened again from the launcher, or brought back to the front: apps may
    // have been installed or removed meanwhile.
    document.addEventListener('webOSRelaunch', refresh);
    document.addEventListener('visibilitychange', function () {
      Themes.onVisibility(CONFIG.effects !== false);
      if (!document.hidden) refresh();
    });

    refresh();
  }

  start();
})();
