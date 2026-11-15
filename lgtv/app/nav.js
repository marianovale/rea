// Spatial navigation for the TV remote arrows: from the focused rectangle,
// pick the nearest rectangle in the pressed direction. Plain ES5 so it runs
// on old webOS browsers. Defines the global Nav.
(function (root) {
  function center(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // rects: array of {left, top, width, height}. Returns the chosen index,
  // or -1 when nothing lies in that direction.
  function pick(rects, from, direction) {
    if (!rects[from]) return -1;
    var origin = center(rects[from]);
    var horizontal = direction === 'left' || direction === 'right';
    if (!horizontal && direction !== 'up' && direction !== 'down') return -1;
    // A candidate's center must lie past the focused tile's edge, so a tile
    // in the next row is never "left"/"right" and one in the same row is
    // never "up"/"down".
    var edge = horizontal ? rects[from].width / 2 : rects[from].height / 2;
    var best = -1;
    var bestScore = Infinity;
    for (var i = 0; i < rects.length; i++) {
      if (i === from) continue;
      var c = center(rects[i]);
      var dx = c.x - origin.x;
      var dy = c.y - origin.y;
      var along, across;
      if (direction === 'left') { along = -dx; across = dy; }
      else if (direction === 'right') { along = dx; across = dy; }
      else if (direction === 'up') { along = -dy; across = dx; }
      else { along = dy; across = dx; }
      if (along <= edge) continue;
      var score = along + Math.abs(across) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  root.Nav = { pick: pick };
})(this);
