// Theme engine. Each theme in themes/<id>/theme.js calls registerTheme();
// Themes.apply() turns its tokens into a stylesheet and sets up its backdrop,
// optional photo, rune circle and particles. Plain ES5 (webOS 3+).
(function (root) {
  var themes = [];
  var REQUIRED = ['id', 'name', 'hero', 'font', 'colors', 'backdrop'];
  var COLORS = ['background', 'text', 'muted', 'accent', 'onAccent', 'glow', 'shade', 'card'];

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
        ' linear-gradient(0deg, rgba(' + shade + ', 0.96) 0%, rgba(' + shade + ', 0.6) 30%, rgba(' + shade + ', 0) 58%); }',
      '.btn.primary { background: ' + c.accent + '; color: ' + c.onAccent + '; }',
      '.btn.focused { box-shadow: 0 0 0 3px ' + c.text + ', 0 14px 40px ' + c.glow + '; }',
      '.tab.active, .tab.focused { color: ' + c.text + '; }',
      '.tab.active .bar { background: ' + c.accent + '; }',
      '.tab.focused .bar { background: ' + c.text + '; }',
      '.card { background-color: ' + c.card + '; }',
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
      ornament.className = effects ? 'spin' : '';
      ornament.hidden = false;
    } else {
      ornament.innerHTML = '';
      ornament.hidden = true;
    }

    loadBackground(theme, function () { ornament.hidden = true; });

    if (theme.particles && effects && !document.hidden) startParticles(theme.particles);
    else stopParticles();
  }

  // ---- Background photo or video ------------------------------------------

  // The user's own file in the theme folder, by format preference, then the
  // theme's online images. This file owns the "fundo.<ext>" convention.
  var LOCAL_FORMATS = ['mp4', 'webm', 'gif', 'jpg', 'jpeg', 'png'];
  var VIDEO_URL = /\.(mp4|webm)([?#]|$)/i;

  function backgroundCandidates(theme) {
    var out = [];
    for (var i = 0; i < LOCAL_FORMATS.length; i++) {
      out.push('themes/' + theme.id + '/fundo.' + LOCAL_FORMATS[i]);
    }
    return out.concat(theme.images || []);
  }

  var backgroundToken = 0;
  var suspendedVideo = null; // video URL unloaded while the app is hidden

  // Tries each candidate in order; the drawn backdrop stays when none loads.
  // onShown runs once something is on screen.
  function loadBackground(theme, onShown) {
    var photo = document.getElementById('backdrop-image');
    var video = document.getElementById('backdrop-video');
    var token = ++backgroundToken;
    photo.className = '';
    photo.style.backgroundImage = '';
    unloadVideo(video);
    video.className = '';
    suspendedVideo = null;

    var candidates = backgroundCandidates(theme);
    var position = theme.imagePosition || 'center';
    (function next(index) {
      if (token !== backgroundToken || index >= candidates.length) return;
      var url = candidates[index];
      var settled = false;
      function fail() {
        if (settled || token !== backgroundToken) return;
        settled = true;
        next(index + 1);
      }
      if (VIDEO_URL.test(url)) {
        video.oncanplay = function () {
          if (settled || token !== backgroundToken) return;
          settled = true;
          video.style.objectPosition = position;
          video.className = 'loaded';
          playVideo(video);
          onShown();
        };
        video.onerror = function () {
          unloadVideo(video); // leave no failed source behind
          fail();
        };
        video.src = url;
        video.load();
      } else {
        var probe = new Image();
        probe.onload = function () {
          if (settled || token !== backgroundToken) return;
          settled = true;
          photo.style.backgroundImage = 'url("' + url + '")';
          photo.style.backgroundPosition = position;
          photo.className = 'loaded';
          onShown();
        };
        probe.onerror = fail;
        probe.src = url;
      }
    })(0);
  }

  function playVideo(video) {
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
    if (video.className !== 'loaded' || !video.currentSrc) return;
    suspendedVideo = video.currentSrc;
    unloadVideo(video);
    video.className = '';
  }

  function resumeVideo() {
    if (!suspendedVideo) return;
    var video = document.getElementById('backdrop-video');
    var token = backgroundToken;
    video.oncanplay = function () {
      if (token !== backgroundToken) return;
      video.oncanplay = null;
      video.className = 'loaded';
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
    if (current && current.particles && effects) startParticles(current.particles);
  }

  root.Themes = {
    list: function () { return themes.slice(); },
    find: find,
    problems: problems,
    backgroundCandidates: backgroundCandidates,
    apply: apply,
    loadFonts: loadFonts,
    onVisibility: onVisibility
  };
})(this);
