// Themes made on the phone: a name, an accent color, a font and uploaded
// photos/videos. This file turns that short description into a full theme
// for the engine (theme.js). The TV app and the phone server (which loads it
// in a sandbox to validate) both use it, so they always agree.
// Plain ES5 (webOS 3+). Defines the global CustomThemes.
(function (root) {
  var UI = '"Helvetica Neue", Arial, sans-serif';
  var FONTS = {
    simples: { name: 'Simples', display: UI, ui: UI },
    serifa: {
      name: 'Serifa',
      display: '"Cinzel", "Trajan Pro", Georgia, serif',
      ui: UI,
      url: 'https://fonts.googleapis.com/css?family=Cinzel:400,700&display=swap'
    },
    classica: {
      name: 'Clássica',
      display: '"Cormorant Garamond", Garamond, Georgia, serif',
      ui: UI,
      url: 'https://fonts.googleapis.com/css?family=Cormorant+Garamond:600,700&display=swap'
    },
    geometrica: {
      name: 'Geométrica',
      display: '"Syncopate", "Futura", "Century Gothic", Arial, sans-serif',
      ui: UI,
      url: 'https://fonts.googleapis.com/css?family=Syncopate:400,700&display=swap'
    }
  };

  var ACCENT = /^#[0-9a-fA-F]{6}$/;

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); });
  }

  function css(c, alpha) {
    return alpha === undefined
      ? 'rgb(' + c.join(', ') + ')'
      : 'rgba(' + c.join(', ') + ', ' + alpha + ')';
  }

  // Relative luminance, to pick black or white text on the accent.
  function light(c) {
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55;
  }

  // def: { id, name, accent, font, wallpapers: [{ file, name, fit }] }
  // fit: 'fill' covers the screen (edges cropped), 'fit' shows it whole.
  // media: where the uploads are served, { base: 'http://…/media/<id>/', query: '?t=…' }
  function build(def, media) {
    var accent = rgb(ACCENT.test(def.accent || '') ? def.accent : '#8a8aa0');
    var ink = [5, 5, 8];
    var bg = mix(ink, accent, 0.08);
    var deep = mix(ink, accent, 0.22);
    var font = FONTS[def.font] || FONTS.simples;
    return {
      id: def.id,
      name: def.name,
      custom: true,
      hero: { kicker: '', title: def.name, tagline: '' },
      font: { display: font.display, ui: font.ui, url: font.url },
      colors: {
        background: css(bg),
        text: '#f2f2f5',
        muted: 'rgba(242, 242, 245, 0.6)',
        accent: css(accent),
        onAccent: light(accent) ? '#111114' : '#ffffff',
        glow: css(accent, 0.45),
        shade: bg.join(', ')
      },
      // Shown until a photo or video loads, and when "Desenhado" is chosen.
      backdrop:
        'radial-gradient(ellipse 55% 45% at 72% 38%, ' + css(accent, 0.35) + ' 0%, ' + css(accent, 0) + ' 70%),' +
        'radial-gradient(ellipse 80% 50% at 30% 110%, ' + css(deep, 0.9) + ' 0%, ' + css(deep, 0) + ' 70%),' +
        'linear-gradient(180deg, ' + css(mix(ink, accent, 0.12)) + ' 0%, ' + css(bg) + ' 100%)',
      wallpapers: (def.wallpapers || []).map(function (w) {
        return { file: w.file, name: w.name, fit: w.fit === 'fit' ? 'fit' : 'fill' };
      }),
      mediaBase: media && media.base,
      mediaQuery: (media && media.query) || ''
    };
  }

  root.CustomThemes = {
    fonts: FONTS,
    fontIds: Object.keys(FONTS),
    validAccent: function (value) { return typeof value === 'string' && ACCENT.test(value); },
    build: build
  };
})(this);
