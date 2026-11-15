// Theme engine. Each theme in themes/<id>/theme.js calls registerTheme();
// Themes.apply() turns its tokens into a stylesheet and sets up its backdrop,
// optional photo, rune circle and particles. Plain ES5 (webOS 3+).
(function (root) {
  var themes = [];
  var REQUIRED = ['id', 'name', 'hero', 'font', 'colors', 'backdrop'];
  var COLORS = ['background', 'text', 'muted', 'accent', 'onAccent', 'glow', 'shade'];

  // Returns the list of problems; empty when the theme is usable.
  function problems(theme) {
    var out = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (!theme || theme[REQUIRED[i]] === undefined) out.push('falta ' + REQUIRED[i]);
    }
    if (theme && theme.colors) {
      for (var c = 0; c < COLORS.length; c++) {
        if (typeof theme.colors[COLORS[c]] !== 'string') out.push('falta colors.' + COLORS[c]);
      }
    }
    if (theme && theme.hero && typeof theme.hero.title !== 'string') out.push('falta hero.title');
    return out;
  }

  root.registerTheme = function (theme) {
    var issues = problems(theme);
    if (issues.length) {
      if (root.console) console.error('Tema ignorado (' + (theme && theme.id) + '): ' + issues.join(', '));
      return;
    }
    themes.push(theme);
  };

  function find(id) {
    for (var i = 0; i < themes.length; i++) if (themes[i].id === id) return themes[i];
    return null;
  }

  // ---- Stylesheet from tokens ----------------------------------------------

  function css(theme) {
    var c = theme.colors;
    var shade = c.shade;
    return [
      'body { background: ' + c.background + '; color: ' + c.text + '; font-family: ' + theme.font.ui + '; }',
      '.display { font-family: ' + theme.font.display + '; }',
      '.muted, .tab, #date, #hint { color: ' + c.muted + '; }',
      '#backdrop { background: ' + theme.backdrop + '; }',
      '#shade { background:' +
        ' linear-gradient(90deg, rgba(' + shade + ', 0.88) 0%, rgba(' + shade + ', 0.45) 42%, rgba(' + shade + ', 0) 72%),' +
        ' linear-gradient(0deg, rgba(' + shade + ', 0.96) 0%, rgba(' + shade + ', 0.6) 30%, rgba(' + shade + ', 0) 58%),' +
        ' linear-gradient(180deg, rgba(' + shade + ', 0.6) 0%, rgba(' + shade + ', 0) 22%); }',
      '.btn.primary { background: ' + c.accent + '; color: ' + c.onAccent + '; }',
      '.btn.focused { box-shadow: 0 0 0 3px ' + c.text + ', 0 14px 40px ' + c.glow + '; }',
      '.tab.active, .tab.focused { color: ' + c.text + '; }',
      '.tab.active .bar { background: ' + c.accent + '; }',
      '.tab.focused .bar { background: ' + c.text + '; }',
      '.card .live { background: ' + c.accent + '; box-shadow: 0 0 12px ' + c.glow + '; }',
      '#ambient-date { color: ' + c.muted + '; }',
      '.tile.focused .card { border-color: ' + c.text + '; box-shadow: 0 18px 50px ' + c.glow + '; }',
      '.chip { background: ' + c.accent + '; color: ' + c.onAccent + '; }'
    ].join('\n');
  }

  // ---- Ornaments (original drawings, plain SVG) ----------------------------

  function svg(parts) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="100%" height="100%">' +
      parts.join('') + '</svg>';
  }

  // Rune circle: rings, ticks, a diamond and a triangle.
  function runesSvg(color) {
    var parts = [];
    var cx = 400, cy = 400;
    parts.push('<circle cx="400" cy="400" r="390" fill="none" stroke="' + color + '" stroke-width="2"/>');
    parts.push('<circle cx="400" cy="400" r="350" fill="none" stroke="' + color + '" stroke-width="6"/>');
    parts.push('<circle cx="400" cy="400" r="330" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-dasharray="4 14"/>');
    parts.push('<circle cx="400" cy="400" r="170" fill="none" stroke="' + color + '" stroke-width="3"/>');
    // Rune ticks around the ring.
    for (var i = 0; i < 24; i++) {
      var a = (i / 24) * Math.PI * 2;
      var long = i % 3 === 0;
      var r1 = 350, r2 = long ? 300 : 322;
      parts.push('<line x1="' + (cx + Math.cos(a) * r1).toFixed(1) + '" y1="' + (cy + Math.sin(a) * r1).toFixed(1) +
        '" x2="' + (cx + Math.cos(a) * r2).toFixed(1) + '" y2="' + (cy + Math.sin(a) * r2).toFixed(1) +
        '" stroke="' + color + '" stroke-width="' + (long ? 5 : 2) + '"/>');
    }
    // A diamond and a triangle between the rings: abstract, not a real symbol.
    function polygon(sides, radius, offset, width) {
      var pts = [];
      for (var k = 0; k < sides; k++) {
        var t = offset + (k / sides) * Math.PI * 2;
        pts.push((cx + Math.cos(t) * radius).toFixed(1) + ',' + (cy + Math.sin(t) * radius).toFixed(1));
      }
      return '<polygon points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/>';
    }
    parts.push(polygon(4, 300, -Math.PI / 2, 3));
    parts.push(polygon(3, 240, Math.PI / 2, 2));
    parts.push('<circle cx="400" cy="400" r="18" fill="' + color + '"/>');
    return svg(parts);
  }

  // Swirls: several Archimedean spirals with brush-like strokes, like the
  // sky of a night painting.
  function swirlsSvg(color) {
    var parts = [];
    var spirals = [
      { x: 400, y: 400, turns: 3.2, radius: 330, width: 7 },
      { x: 400, y: 400, turns: 3.2, radius: 300, width: 3, offset: Math.PI },
      { x: 170, y: 170, turns: 2.2, radius: 120, width: 4 },
      { x: 640, y: 600, turns: 2, radius: 110, width: 4, offset: 1.5 }
    ];
    for (var i = 0; i < spirals.length; i++) {
      var sp = spirals[i];
      var points = [];
      var steps = Math.round(sp.turns * 48);
      for (var k = 0; k <= steps; k++) {
        var t = k / steps;
        var angle = (sp.offset || 0) + t * sp.turns * Math.PI * 2;
        var r = 12 + t * sp.radius;
        points.push((sp.x + Math.cos(angle) * r).toFixed(1) + ',' + (sp.y + Math.sin(angle) * r).toFixed(1));
      }
      parts.push('<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color +
        '" stroke-width="' + sp.width + '" stroke-linecap="round" stroke-dasharray="26 10"/>');
    }
    return svg(parts);
  }

  var ORNAMENTS = { runes: runesSvg, swirls: swirlsSvg };

  // ---- Particles (embers rising) -------------------------------------------

  var particles = { running: false, list: [], config: null, frame: 0 };

  function spawn(fromBottom) {
    if (particles.config.motion === 'twinkle') {
      return {
        x: Math.random() * 1920,
        y: Math.random() * 700,
        vx: 0.04 + Math.random() * 0.12, // slow drift along a circle
        vy: 0,
        r: 1 + Math.random() * 2.2,
        life: 0.5 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2
      };
    }
    return {
      x: Math.random() * 1920,
      y: fromBottom ? 1080 + Math.random() * 60 : Math.random() * 1080,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -(0.35 + Math.random() * 0.9),
      r: 1 + Math.random() * 2.4,
      life: 0.4 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2
    };
  }

  function drawParticles() {
    if (!particles.running) return;
    var canvas = document.getElementById('particles');
    var ctx = canvas.getContext('2d');
    var rgb = particles.config.color;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    particles.frame++;
    for (var i = 0; i < particles.list.length; i++) {
      var p = particles.list[i];
      var alpha;
      if (particles.config.motion === 'twinkle') {
        // Stars: circle slowly around where they were born and pulse.
        var angle = particles.frame / 600 * p.vx * 10 + p.phase;
        var x = p.x + Math.cos(angle) * 14;
        var y = p.y + Math.sin(angle) * 14;
        alpha = p.life * (0.45 + 0.55 * Math.abs(Math.sin(particles.frame / 50 + p.phase)));
        glow(ctx, rgb, x, y, p.r, alpha);
        continue;
      }
      p.x += p.vx + Math.sin((particles.frame / 40) + p.phase) * 0.25;
      p.y += p.vy;
      if (p.y < -20) { particles.list[i] = spawn(true); continue; }
      // Embers: fade in from the bottom, out towards the top, with a flicker.
      var height = Math.max(0, Math.min(1, p.y / 1080));
      var flicker = 0.75 + 0.25 * Math.sin(particles.frame / 6 + p.phase * 3);
      alpha = p.life * height * flicker;
      glow(ctx, rgb, p.x, p.y, p.r, alpha);
    }
    // ~30 fps is plenty for these effects and halves the work on TV CPUs.
    setTimeout(function () { requestAnimationFrame(drawParticles); }, 33);
  }

  // A soft halo plus a bright core.
  function glow(ctx, rgb, x, y, r, alpha) {
    ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (alpha * 0.18).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,' + Math.min(255, rgb[1] + 90) + ',' + Math.min(255, rgb[2] + 90) + ',' + alpha.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }


  function startParticles(config) {
    stopParticles();
    var canvas = document.getElementById('particles');
    canvas.hidden = false;
    particles.config = config;
    particles.list = [];
    for (var i = 0; i < (config.count || 40); i++) particles.list.push(spawn(false));
    particles.running = true;
    drawParticles();
  }

  function stopParticles() {
    particles.running = false;
    var canvas = document.getElementById('particles');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
  }

  // ---- Apply ---------------------------------------------------------------

  var current = null;

  function apply(theme, options) {
    var effects = !options || options.effects !== false;
    current = theme;

    var style = document.getElementById('theme-style');
    style.textContent = css(theme);

    // The drawn ornament shows while there is no photo or video, which carry
    // their own artwork, so the ornament steps aside when one loads.
    var ornament = document.getElementById('ornament');
    var draw = theme.ornament && ORNAMENTS[theme.ornament.type];
    if (draw) {
      ornament.innerHTML = draw(theme.ornament.color);
      ornament.style.opacity = String(theme.ornament.opacity || 0.2);
      ornament.classList.toggle('spin', effects);
      ornament.hidden = false;
    } else {
      ornament.innerHTML = '';
      ornament.hidden = true;
    }

    // options.background: the on-TV picker's choice (a filename, or 'none'
    // for the drawn backdrop); undefined falls back to CONFIG.background.
    loadBackground(theme, function () {
      // A photo or video carries its own artwork, so the drawn ornament and
      // particles step aside once one is on screen.
      ornament.hidden = true;
      stopParticles();
    }, options && options.background);

    if (theme.particles && effects && !document.hidden && !backgroundShown()) startParticles(theme.particles);
    else if (!theme.particles || !effects) stopParticles();
  }

  function backgroundShown() {
    return document.getElementById('backdrop-image').classList.contains('loaded') ||
      document.getElementById('backdrop-video').classList.contains('loaded');
  }

  // ---- Background photo or video ------------------------------------------

  // The user's own files in the theme folder, by format preference. This
  // file owns the "fundo.<ext>" convention. An image and a video can both
  // be used: the image shows at once (and in the theme's preview tile), the
  // video fades in over it once it can play.
  var VIDEO_FORMATS = ['mp4', 'webm'];
  var IMAGE_FORMATS = ['gif', 'jpg', 'jpeg', 'png'];

  function localFiles(theme, formats) {
    var out = [];
    for (var i = 0; i < formats.length; i++) out.push('themes/' + theme.id + '/fundo.' + formats[i]);
    return out;
  }

  function backgroundCandidates(theme, chosen) {
    var videos = localFiles(theme, VIDEO_FORMATS);
    var images = localFiles(theme, IMAGE_FORMATS).concat(theme.images || []);
    // 'none' means the drawn backdrop only (the on-TV picker's "Desenhado").
    if (chosen === 'none') return { videos: [], images: [] };
    // An explicit choice wins, so several files can live in the folder and
    // one is picked without renaming. The on-TV pick (chosen) comes first,
    // then CONFIG.background. (typeof guards the tests, which have no CONFIG.)
    var pick = chosen || ((typeof CONFIG !== 'undefined' && CONFIG.background) ? CONFIG.background[theme.id] : null);
    if (pick) {
      var url = 'themes/' + theme.id + '/' + pick;
      if (/\.(mp4|webm)$/i.test(pick)) videos = [url].concat(videos);
      else images = [url].concat(images);
    }
    return { videos: videos, images: images };
  }

  // First image that loads, per theme, probed once and shared by the
  // backdrop and the preview tile. done(url) gets null when none loads.
  var imageCache = {};

  function themeImage(theme, done) {
    var entry = imageCache[theme.id];
    if (entry && entry.settled) { done(entry.url); return; }
    if (entry) { entry.waiters.push(done); return; }
    entry = imageCache[theme.id] = { settled: false, url: null, waiters: [done] };
    var urls = backgroundCandidates(theme).images;
    (function next(index) {
      if (index >= urls.length) { settle(null); return; }
      var probe = new Image();
      probe.onload = function () { settle(urls[index]); };
      probe.onerror = function () { next(index + 1); };
      probe.src = urls[index];
    })(0);
    function settle(url) {
      entry.settled = true;
      entry.url = url;
      var waiters = entry.waiters;
      entry.waiters = [];
      for (var i = 0; i < waiters.length; i++) waiters[i](url);
    }
  }

  var backgroundToken = 0;
  var suspendedVideo = null; // video URL unloaded while the app is hidden

  // State is the "loaded" class only: the layers also carry "layer", which
  // places them over the whole screen, so className is never replaced.

  // The drawn backdrop stays when nothing loads. onShown runs when an image
  // or a video is on screen.
  function loadBackground(theme, onShown, chosen) {
    var photo = document.getElementById('backdrop-image');
    var video = document.getElementById('backdrop-video');
    var token = ++backgroundToken;
    var position = theme.imagePosition || 'center';
    photo.classList.remove('loaded');
    photo.style.backgroundImage = '';
    unloadVideo(video);
    video.classList.remove('loaded');
    suspendedVideo = null;

    var cand = backgroundCandidates(theme, chosen);

    // The image shows underneath, first one that loads.
    (function tryImage(index) {
      if (token !== backgroundToken || index >= cand.images.length) return;
      var probe = new Image();
      probe.onload = function () {
        if (token !== backgroundToken) return;
        photo.style.backgroundImage = 'url("' + cand.images[index] + '")';
        photo.style.backgroundPosition = position;
        photo.classList.add('loaded');
        onShown();
      };
      probe.onerror = function () { if (token === backgroundToken) tryImage(index + 1); };
      probe.src = cand.images[index];
    })(0);

    // The video fades in over it.
    var videos = cand.videos;
    (function next(index) {
      if (token !== backgroundToken || index >= videos.length) return;
      var settled = false;
      video.oncanplay = function () {
        if (settled || token !== backgroundToken) return;
        settled = true;
        video.style.objectPosition = position;
        video.classList.add('loaded');
        playVideo(video);
        onShown();
      };
      video.onerror = function () {
        if (settled || token !== backgroundToken) return;
        settled = true;
        unloadVideo(video); // leave no failed source behind
        next(index + 1);
      };
      video.src = videos[index];
      video.load();
    })(0);
  }

  function playVideo(video) {
    // Backgrounds never make sound, whatever the file holds.
    video.defaultMuted = true;
    video.muted = true;
    video.volume = 0;
    var started = video.play();
    // Newer browsers return a promise; a refused autoplay is not an error
    // worth reporting (the first frame stays on screen).
    if (started && started.catch) started.catch(function () {});
  }

  function unloadVideo(video) {
    video.oncanplay = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  // A paused <video> still holds the TV's hardware decoder, which the app
  // the user opens next may need; so the video is unloaded while hidden and
  // loaded again on return.
  function suspendVideo() {
    var video = document.getElementById('backdrop-video');
    if (!video.classList.contains('loaded') || !video.currentSrc) return;
    suspendedVideo = video.currentSrc;
    unloadVideo(video);
    video.classList.remove('loaded');
  }

  function resumeVideo() {
    if (!suspendedVideo) return;
    var video = document.getElementById('backdrop-video');
    var token = backgroundToken;
    video.oncanplay = function () {
      if (token !== backgroundToken) return;
      video.oncanplay = null;
      video.classList.add('loaded');
      playVideo(video);
    };
    video.src = suspendedVideo;
    suspendedVideo = null;
    video.load();
  }

  // Loads every theme's web font once, so the theme previews use them too.
  function loadFonts() {
    for (var i = 0; i < themes.length; i++) {
      var url = themes[i].font && themes[i].font.url;
      if (!url) continue;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
  }

  // Animations and video stop while the app is in the background.
  function onVisibility(effects) {
    if (document.hidden) {
      suspendVideo();
      stopParticles();
      return;
    }
    resumeVideo();
    if (current && current.particles && effects && !backgroundShown()) startParticles(current.particles);
  }

  root.Themes = {
    list: function () { return themes.slice(); },
    find: find,
    problems: problems,
    backgroundCandidates: backgroundCandidates,
    themeImage: themeImage,
    apply: apply,
    loadFonts: loadFonts,
    onVisibility: onVisibility
  };
})(this);
