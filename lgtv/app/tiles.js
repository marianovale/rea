// Minimal tiles: a line icon per kind of app, and the TV's inputs as tiles.
// Plain ES5 (webOS 3+). Defines the global Tiles; also loaded by the tests.
(function (root) {
  // Original line icons, 24x24, drawn in the current text color.
  var GLYPHS = {
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    input: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M21 12h-9M15 9l-3 3 3 3"/>',
    box: '<rect x="2.5" y="9" width="19" height="7" rx="2"/><path d="M6.5 12.5h.01M15 12.5h3.5"/>',
    game: '<path d="M7.5 8.5h9a4 4 0 0 1 3.9 4.8l-.7 3a2 2 0 0 1-3.5.8L14.5 15h-5l-1.7 2.1a2 2 0 0 1-3.5-.8l-.7-3a4 4 0 0 1 3.9-4.8z"/>' +
      '<path d="M8.5 10.5v3M7 12h3M15.5 11.5h.01M17 13h.01"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (GLYPHS[name] || GLYPHS.play) + '</svg>';
  }

  // The icon for an app or input. Inputs already carry one from the TV.
  function glyphFor(point) {
    if (point.glyph && GLYPHS[point.glyph]) return point.glyph;
    var text = ((point.id || '') + ' ' + (point.title || '')).toLowerCase();
    if (/livetv|tvhub/.test(text)) return 'tv';
    if (/xbox|playstation|nintendo|game|geforce|stadia|xcloud/.test(text)) return 'game';
    if (/hdmi|externalinput|\.av\d|component/.test(text)) return 'input';
    if (/spotify|music|deezer|tidal|radio|audio|podcast/.test(text)) return 'music';
    if (/browser|navegador/.test(text)) return 'globe';
    if (/settings|configura/.test(text)) return 'gear';
    if (/photo|gallery|foto|image/.test(text)) return 'image';
    return 'play';
  }

  // The TV's own icon names for inputs (EIM "icon").
  var INPUT_ICONS = { 'gameconsole.png': 'game', 'settopbox.png': 'box' };

  // The input manager's list (com.webos.service.eim getAllInputStatus
  // "devices") as tiles, in the TV's order, with the names the user gave
  // them. Inputs it reports as not connected are left out.
  // "live" = the input is sending a picture right now: the source's SPD
  // InfoFrame or an HDMI-CEC device is present. On a UM7520 both appear only
  // while the Xbox is on; "connected" and "hdmiPlugIn" stay true with the
  // Xbox off (they only mean a cable), so they are not used for it.
  function inputPoints(devices) {
    var out = [];
    for (var i = 0; i < (devices || []).length; i++) {
      var d = devices[i];
      if (!d || !d.appId || d.connected === false) continue;
      out.push({
        id: d.appId,
        title: d.label || d.id,
        glyph: INPUT_ICONS[d.icon] || 'input',
        live: !!(d.spdProductDescription || d.spdVendorName) ||
          (typeof d.lastUniqueId === 'number' && d.lastUniqueId !== 255)
      });
    }
    return out;
  }

  root.Tiles = { svg: svg, glyphFor: glyphFor, inputPoints: inputPoints, glyphs: Object.keys(GLYPHS) };
})(this);
