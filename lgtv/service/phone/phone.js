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

  function isVideo(file) {
    return /\.(mp4|webm)$/i.test(file);
  }

  function renderWalls(eff) {
    var theme = state.catalog.themes.filter(function (t) { return t.id === eff.theme; })[0];
    var box = $('walls');
    box.innerHTML = '';
    $('wall-actions').innerHTML = '';
    if (!theme) return;
    $('wall-title').textContent = 'Papel de parede — ' + theme.name;
    var current = eff.wallpaper[theme.id];
    // A phone-made theme shows its first file until one is chosen.
    if (theme.custom && current === undefined && theme.wallpapers.length) current = theme.wallpapers[0].file;
    var options = theme.wallpapers.concat([{ file: 'none', name: 'Desenhado (sem vídeo)' }]);
    options.forEach(function (w) {
      var on = current === w.file;
      var row = el('div', 'row pick' + (on ? ' on' : ''));
      row.appendChild(icon(w.file === 'none' || !isVideo(w.file) ? 'image' : 'play'));
      row.appendChild(el('span', 'name', w.name));
      if (on) row.appendChild(el('span', 'check', '✓'));
      if (theme.custom && w.file !== 'none') {
        var fit = el('button', 'mini', FIT_LABEL[w.fit === 'fit' ? 'fit' : 'fill']);
        fit.title = 'Trocar entre preencher a tela e mostrar inteira';
        fit.onclick = function (e) {
          e.stopPropagation();
          api('POST', '/api/themes/' + encodeURIComponent(theme.id) + '/media/' + encodeURIComponent(w.file),
            { fit: w.fit === 'fit' ? 'fill' : 'fit' })
            .then(function () { status('salvo na TV', 'ok'); })
            .catch(function (err) { fail(err.message); });
        };
        row.appendChild(fit);
        var del = el('button', 'icon-btn', '✕');
        del.title = 'Apagar este arquivo da TV';
        del.onclick = function (e) {
          e.stopPropagation();
          if (!confirm('Apagar "' + w.name + '" da TV?')) return;
          api('DELETE', '/api/themes/' + encodeURIComponent(theme.id) + '/media/' + encodeURIComponent(w.file))
            .then(function () { status('apagado', 'ok'); })
            .catch(function (err) { fail(err.message); });
        };
        row.appendChild(del);
      }
      row.onclick = function () {
        var change = {};
        change[theme.id] = w.file;
        save({ wallpaper: change });
      };
      box.appendChild(row);
    });
    if (theme.custom) renderThemeActions(theme);
  }

  // A phone-made theme: add more photos/videos, or delete it.
  function renderThemeActions(theme) {
    var box = $('wall-actions');
    var add = el('label', 'file-btn');
    var label = el('span', '', 'Adicionar foto ou vídeo');
    var input = el('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = function () {
      var file = input.files[0];
      var problem = checkFile(file);
      if (problem) { fail(problem); return; }
      label.textContent = 'Preparando…';
      measure(file)
        .then(function (size) {
          return uploadFile(theme.id, file, suggestFit(size), function (p) {
            label.textContent = 'Enviando… ' + Math.round(p * 100) + '%';
          });
        })
        .then(function () { status('enviado', 'ok'); })
        .catch(function (err) { fail(err.message); })
        .then(function () { label.textContent = 'Adicionar foto ou vídeo'; });
    };
    add.appendChild(label);
    add.appendChild(input);
    box.appendChild(add);
    var del = el('button', 'danger', 'Apagar este tema');
    del.type = 'button';
    del.onclick = function () {
      if (!confirm('Apagar o tema "' + theme.name + '" e os arquivos dele da TV?')) return;
      api('DELETE', '/api/themes/' + encodeURIComponent(theme.id))
        .then(function () { status('tema apagado', 'ok'); })
        .catch(function (err) { fail(err.message); });
    };
    box.appendChild(del);
  }

  // ---- Creating themes -----------------------------------------------------

  var ACCEPT = 'image/jpeg,image/png,image/gif,video/mp4,video/webm';
  var MAX_UPLOAD = 50 * 1024 * 1024;
  var draft = { font: 'simples', file: null, fit: 'fill' };
  var FIT_LABEL = { fill: 'Preencher', fit: 'Inteira' };
  var SCREEN = [1920, 1080];

  // The TV checks again by the file's bytes; this only saves a pointless upload.
  function checkFile(file) {
    if (!file) return 'Escolha uma foto ou um vídeo.';
    if (/\.mov$/i.test(file.name) || file.type === 'video/quicktime') {
      return 'Vídeo .MOV (do iPhone): a TV não toca. Use um MP4 H.264 de até 1080p.';
    }
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return 'Foto HEIC: a TV não mostra. Use JPG ou PNG.';
    if (file.size > MAX_UPLOAD) return 'Arquivo grande demais (máximo 50 MB).';
    return null;
  }

  function uploadFile(themeId, file, fit, onProgress) {
    var name = file.name.replace(/\.[^.]+$/, '');
    return shrink(file).then(function (body) { return send(themeId, body, name, fit, onProgress); });
  }

  function send(themeId, body, name, fit, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', '/api/themes/' + encodeURIComponent(themeId) + '/media?name=' + encodeURIComponent(name) +
        '&fit=' + fit);
      xhr.setRequestHeader('X-Token', code);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || (data.errors || []).join(', ') || 'erro ' + xhr.status));
      };
      xhr.onerror = function () { reject(new Error('A conexão com a TV caiu durante o envio.')); };
      xhr.send(body);
    });
  }

  function isPhoto(file) {
    return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('imagem ilegível')); };
      img.src = url;
    });
  }

  // Width and height of a photo or video; null when the phone cannot tell.
  function measure(file) {
    if (!isVideo(file.name) && !/^video\//.test(file.type)) {
      return loadImage(file)
        .then(function (img) { return { width: img.naturalWidth, height: img.naturalHeight }; })
        .catch(function () { return null; });
    }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var timer = setTimeout(function () { finish(null); }, 8000);
      function finish(size) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(size);
      }
      video.muted = true;
      video.preload = 'metadata';
      video.onloadedmetadata = function () { finish({ width: video.videoWidth, height: video.videoHeight }); };
      video.onerror = function () { finish(null); };
      video.src = url;
    });
  }

  // Close to the TV's shape: fill the screen. Square or standing up (a
  // phone photo held upright): show it whole, or most of it would be cut.
  function suggestFit(size) {
    if (!size || !size.width || !size.height) return 'fill';
    return size.width / size.height < 1.25 ? 'fit' : 'fill';
  }

  // A phone photo has far more pixels than the TV shows (12 MP against
  // 2 MP): shrink it to what still fills the 1920×1080 screen, so it is
  // sent faster and the TV decodes less. GIFs (maybe animated) and videos
  // go as they are; so does a photo that comes out no smaller.
  function shrink(file) {
    if (!isPhoto(file)) return Promise.resolve(file);
    return loadImage(file).then(function (img) {
      var scale = Math.max(SCREEN[0] / img.naturalWidth, SCREEN[1] / img.naturalHeight);
      if (!(scale < 1)) return file;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; // transparent PNG areas become black, like the frame
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob && blob.size < file.size ? blob : file); }, 'image/jpeg', 0.9);
      });
    }).catch(function () { return file; });
  }

  // A vivid color from the picture (or a video frame): the average of its
  // most colorful mid-bright pixels.
  function vivid(data) {
    var pixels = [];
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var v = max / 255, sat = max ? (max - min) / max : 0;
      pixels.push([sat * (1 - Math.abs(v - 0.65)), r, g, b]);
    }
    pixels.sort(function (a, b) { return b[0] - a[0]; });
    var top = pixels.slice(0, Math.max(1, Math.floor(pixels.length / 5)));
    var sum = [0, 0, 0];
    top.forEach(function (p) { sum[0] += p[1]; sum[1] += p[2]; sum[2] += p[3]; });
    var avg = sum.map(function (x) { return x / top.length; });
    var peak = Math.max(avg[0], avg[1], avg[2]) || 1;
    var lift = peak < 150 ? 150 / peak : 1; // never a muddy dark accent
    return '#' + avg.map(function (x) {
      var c = Math.min(255, Math.round(x * lift)).toString(16);
      return c.length < 2 ? '0' + c : c;
    }).join('');
  }

  function suggestColor(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 27;
      var ctx = canvas.getContext('2d');
      var settled = false;
      function finish(hex) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(hex);
      }
      function pick(source) {
        try {
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          finish(vivid(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
        } catch (e) {
          finish(null);
        }
      }
      setTimeout(function () { finish(null); }, 8000);
      if (isVideo(file.name) || /^video\//.test(file.type)) {
        var video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadeddata = function () { video.currentTime = Math.min(1, (video.duration || 2) / 2); };
        video.onseeked = function () { pick(video); };
        video.onerror = function () { finish(null); };
        video.src = url;
      } else {
        var img = new Image();
        img.onload = function () { pick(img); };
        img.onerror = function () { finish(null); };
        img.src = url;
      }
    });
  }

  function renderFonts() {
    var box = $('new-fonts');
    box.innerHTML = '';
    state.catalog.fonts.forEach(function (f) {
      var b = el('button', 'chip' + (f.id === draft.font ? ' on' : ''), f.name);
      b.type = 'button';
      b.onclick = function () { draft.font = f.id; renderFonts(); };
      box.appendChild(b);
    });
  }

  function renderFit() {
    var box = $('new-fit');
    box.innerHTML = '';
    [['fill', 'Preencher a tela'], ['fit', 'Inteira, com preto']].forEach(function (opt) {
      var b = el('button', 'chip' + (opt[0] === draft.fit ? ' on' : ''), opt[1]);
      b.type = 'button';
      b.onclick = function () { draft.fit = opt[0]; $('fit-hint').textContent = ''; renderFit(); };
      box.appendChild(b);
    });
  }

  function initCreate() {
    renderFonts();
    renderFit();
    var progress = $('new-progress');
    $('new-file').onchange = function () {
      var file = this.files[0] || null;
      draft.file = file;
      $('new-file-label').textContent = file ? file.name : 'Escolher foto ou vídeo';
      var problem = file && checkFile(file);
      progress.textContent = problem || '';
      if (file && !problem) {
        measure(file).then(function (size) {
          if (draft.file !== file || !size) return;
          draft.fit = suggestFit(size);
          $('fit-hint').textContent = 'sugerido pelo formato (' + size.width + '×' + size.height + ')';
          renderFit();
        });
        suggestColor(file).then(function (hex) {
          if (!hex) return;
          $('new-color').value = hex;
          $('color-hint').textContent = 'sugerida pela imagem';
        });
      }
    };
    $('new-create').onclick = function () {
      var button = this;
      var name = $('new-name').value.trim();
      var problem = name ? checkFile(draft.file) : 'Dê um nome ao tema.';
      if (problem) { progress.textContent = problem; return; }
      button.disabled = true;
      progress.textContent = 'Criando…';
      var created = null;
      api('POST', '/api/themes', { name: name, accent: $('new-color').value, font: draft.font })
        .then(function (res) {
          created = res.theme;
          progress.textContent = 'Preparando…';
          return uploadFile(created.id, draft.file, draft.fit, function (p) {
            progress.textContent = 'Enviando para a TV… ' + Math.round(p * 100) + '%';
          });
        })
        .then(function () { return save({ theme: created.id }); })
        .then(function () {
          progress.textContent = 'Pronto: "' + name + '" já está na TV.';
          $('new-name').value = '';
          $('new-file').value = '';
          $('new-file-label').textContent = 'Escolher foto ou vídeo';
          $('color-hint').textContent = '';
          $('fit-hint').textContent = '';
          draft.file = null;
          draft.fit = 'fill';
          renderFit();
        })
        .catch(function (err) {
          progress.textContent = err.message;
          // No empty theme left behind when the file is refused.
          if (created) api('DELETE', '/api/themes/' + encodeURIComponent(created.id)).catch(function () {});
        })
        .then(function () { button.disabled = false; });
    };
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
    // Themes made on the phone (by this page or another).
    source.addEventListener('themes', function (e) {
      if (!state.catalog) return;
      var defs = JSON.parse(e.data);
      state.catalog.themes = state.catalog.themes.filter(function (t) { return !t.custom; }).concat(
        defs.map(function (d) { return { id: d.id, name: d.name, custom: true, wallpapers: d.wallpapers }; }));
      render();
    });
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
    initCreate();
    render();
    status('conectado', 'ok');
    listen();
  }).catch(function (e) { fail(e.message); });
})();
