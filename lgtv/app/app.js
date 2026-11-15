// Minha TV: custom home screen for a rooted LG webOS TV.
// Plain ES5 on purpose: rooted TVs range from webOS 3 (Chromium 38) upward.
(function () {
  var APP_ID = 'io.github.marianovale.lgtv';
  var SERVICE = 'luna://' + APP_ID + '.service/';
  var APPMGR = 'luna://com.webos.applicationManager/';
  var FAVORITES_KEY = 'lgtv.favorites';
  var LONG_PRESS_MS = 700;

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, RED: 403, GREEN: 404 };

  var state = {
    points: [],      // launch points from the TV, in TV order
    favorites: [],   // ids, in the user's order
    tiles: [],       // rendered focusable elements, document order
    focus: 0,
    focusedId: null
  };

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

  // ---- Favorites ----------------------------------------------------------

  function loadFavorites() {
    try {
      var saved = JSON.parse(localStorage.getItem(FAVORITES_KEY));
      if (saved && saved.length !== undefined) return saved;
    } catch (e) { /* storage unavailable: use the config list */ }
    return CONFIG.favorites.slice();
  }

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites)); }
    catch (e) { /* stays for this session only */ }
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
    saveFavorites();
    render();
  }

  // ---- Data ---------------------------------------------------------------

  function findPoint(id) {
    for (var i = 0; i < state.points.length; i++) {
      if (state.points[i].id === id) return state.points[i];
    }
    return null;
  }

  function iconUrl(path) {
    if (!path) return '';
    if (path.charAt(0) === '/') return 'file://' + path;
    return path;
  }

  function refresh() {
    system('listLaunchPoints', {}, function (r) {
      if (!r.returnValue) {
        showMessage(
          'Não consegui listar os apps da TV (' + escapeHtml(r.errorText) + ').<br>' +
          'O serviço do app precisa de root. No computador, rode de novo ' +
          '<code>./lgtv/install.sh IP-DA-TV</code>.'
        );
        return;
      }
      var hidden = CONFIG.hidden || [];
      state.points = (r.launchPoints || []).filter(function (p) {
        return p && p.id && hidden.indexOf(p.id) < 0;
      });
      showMessage('');
      render();
    });
    checkRoot();
  }

  function checkRoot() {
    var badge = document.getElementById('root-badge');
    luna(SERVICE + 'status', {}, function (r) {
      badge.hidden = false;
      if (r.returnValue && r.uid === 0) {
        badge.className = 'badge ok';
        badge.textContent = 'root';
      } else {
        badge.className = 'badge warn';
        badge.textContent = 'sem root';
      }
    });
  }

  function launch(id) {
    var point = findPoint(id);
    var params = { id: point && point.appId ? point.appId : id };
    if (point && point.params) params.params = point.params;
    system('launch', params, function (r) {
      if (!r.returnValue) toast('Não abriu: ' + r.errorText);
    });
  }

  // ---- Rendering ----------------------------------------------------------

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function tile(point, isFavorite) {
    var el = document.createElement('div');
    el.className = 'tile';
    el.setAttribute('data-id', point.id);

    var card = document.createElement('div');
    card.className = 'card';
    if (point.bgColor) card.style.background = point.bgColor;

    var src = iconUrl(point.largeIcon || point.icon);
    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.onerror = function () {
        card.removeChild(img);
        card.appendChild(initial(point.title));
      };
      card.appendChild(img);
    } else {
      card.appendChild(initial(point.title));
    }
    el.appendChild(card);

    if (isFavorite) {
      var star = document.createElement('div');
      star.className = 'star';
      star.textContent = '★';
      el.appendChild(star);
    }

    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = point.title || point.id;
    el.appendChild(label);

    // Magic Remote pointer.
    el.addEventListener('mouseover', function () { focusId(point.id); });
    el.addEventListener('click', function () { launch(point.id); });
    return el;
  }

  function initial(title) {
    var span = document.createElement('span');
    span.className = 'initial';
    span.textContent = (title || '?').charAt(0).toUpperCase();
    return span;
  }

  function render() {
    var favRow = document.getElementById('favorites');
    var grid = document.getElementById('apps');
    favRow.innerHTML = '';
    grid.innerHTML = '';

    var favCount = 0;
    for (var f = 0; f < state.favorites.length; f++) {
      var point = findPoint(state.favorites[f]);
      if (point) { favRow.appendChild(tile(point, true)); favCount++; }
    }
    document.getElementById('favorites-section').hidden = favCount === 0;

    for (var i = 0; i < state.points.length; i++) {
      var p = state.points[i];
      grid.appendChild(tile(p, state.favorites.indexOf(p.id) >= 0));
    }

    state.tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));
    // Keep focus on the same app after a re-render, when it is still there.
    var next = 0;
    if (state.focusedId) {
      for (var t = 0; t < state.tiles.length; t++) {
        if (state.tiles[t].getAttribute('data-id') === state.focusedId) { next = t; break; }
      }
    }
    setFocus(next);
  }

  function setFocus(index) {
    if (!state.tiles.length) return;
    var old = state.tiles[state.focus];
    if (old) { old.className = old.className.replace(' focused', ''); clearAccent(old); }
    state.focus = Math.max(0, Math.min(index, state.tiles.length - 1));
    var el = state.tiles[state.focus];
    el.className += ' focused';
    el.querySelector('.card').style.borderColor = CONFIG.accent;
    state.focusedId = el.getAttribute('data-id');
    scrollIntoView(el);
  }

  function clearAccent(el) {
    el.querySelector('.card').style.borderColor = 'transparent';
  }

  function focusId(id) {
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].getAttribute('data-id') === id) {
        if (i !== state.focus) setFocus(i);
        return;
      }
    }
  }

  // Keeps the focused tile, its label and the section title above it on
  // screen. Measured on screen, so tile scaling and nesting do not matter.
  function scrollIntoView(el) {
    var content = document.getElementById('content');
    var view = content.getBoundingClientRect();
    var box = el.getBoundingClientRect();
    var above = 90; // room for the section title
    var below = 40;
    if (box.top - above < view.top) {
      content.scrollTop = Math.max(0, content.scrollTop - (view.top - (box.top - above)));
    } else if (box.bottom + below > view.bottom) {
      content.scrollTop += box.bottom + below - view.bottom;
    }
  }

  function move(direction) {
    var rects = state.tiles.map(function (el) {
      var r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    var next = Nav.pick(rects, state.focus, direction);
    if (next >= 0) setFocus(next);
  }

  // ---- Messages -----------------------------------------------------------

  function showMessage(html) {
    var el = document.getElementById('message');
    el.innerHTML = html;
    el.hidden = !html;
  }

  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  // ---- Clock --------------------------------------------------------------

  var WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function tick() {
    var now = new Date();
    document.getElementById('time').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var weekday = WEEKDAYS[now.getDay()];
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
        longPressTimer = setTimeout(function () {
          longPressFired = true;
          if (state.focusedId) toggleFavorite(state.focusedId);
        }, LONG_PRESS_MS);
        break;
      case KEY.RED:
        if (state.focusedId) toggleFavorite(state.focusedId);
        break;
      case KEY.GREEN:
        toast('Recarregando apps…');
        refresh();
        break;
      case KEY.BACK:
        // This is the home screen: Back goes to the first tile, never exits.
        setFocus(0);
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
    if (wasDown && !longPressFired && state.focusedId) launch(state.focusedId);
    e.preventDefault();
  }

  // ---- Start --------------------------------------------------------------

  function start() {
    document.getElementById('name').textContent = CONFIG.name;
    document.getElementById('screen').style.background = CONFIG.background;
    document.getElementById('clock').hidden = !CONFIG.showClock;
    state.favorites = loadFavorites();

    tick();
    setInterval(tick, 15000);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    // Opened again from the launcher, or brought back to the front: apps may
    // have been installed or removed meanwhile.
    document.addEventListener('webOSRelaunch', refresh);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh();
    });

    refresh();
  }

  start();
})();
