// QR code for the phone link, drawn on the TV so the owner can point the
// phone's camera at the screen instead of typing the address.
// Byte mode, error correction level M (about 15% of the code can be
// covered or blurry and it still reads), smallest version that fits,
// mask chosen by the standard penalty rules (ISO/IEC 18004).
// Plain ES5 (webOS 3+). Defines the global QR.
(function (root) {
  // Per version 1–40, level M: error correction codewords per block, and
  // number of blocks (ISO/IEC 18004, table 9).
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var FORMAT_LEVEL_M = 0; // the two format bits for level M

  function bit(value, i) { return ((value >>> i) & 1) !== 0; }

  // Modules that carry data or error correction, after the fixed patterns.
  function rawModules(version) {
    var n = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var align = Math.floor(version / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (version >= 7) n -= 36;
    }
    return n;
  }

  function dataCodewords(version) {
    return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
  }

  function utf8(text) {
    var s = unescape(encodeURIComponent(text));
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ---- Reed–Solomon over GF(256), polynomial 0x11D -------------------------

  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function divisor(degree) {
    var out = [];
    for (var i = 0; i < degree; i++) out.push(0);
    out[degree - 1] = 1;
    var rootValue = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < out.length; j++) {
        out[j] = mul(out[j], rootValue);
        if (j + 1 < out.length) out[j] ^= out[j + 1];
      }
      rootValue = mul(rootValue, 2);
    }
    return out;
  }

  function remainder(data, div) {
    var out = div.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ out.shift();
      out.push(0);
      for (var j = 0; j < div.length; j++) out[j] ^= mul(div[j], factor);
    }
    return out;
  }

  // Data split into blocks, each with its error correction, interleaved.
  function withErrorCorrection(data, version) {
    var blocks = BLOCKS[version];
    var eccLen = ECC_PER_BLOCK[version];
    var raw = Math.floor(rawModules(version) / 8);
    var shortBlocks = blocks - raw % blocks;
    var shortLen = Math.floor(raw / blocks);
    var div = divisor(eccLen);
    var list = [];
    for (var i = 0, k = 0; i < blocks; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
      k += dat.length;
      var block = dat.concat(remainder(dat, div));
      if (i < shortBlocks) block.splice(shortLen - eccLen, 0, -1); // placeholder, skipped below
      list.push(block);
    }
    var out = [];
    for (var c = 0; c < list[0].length; c++) {
      for (var b = 0; b < list.length; b++) {
        if (list[b][c] !== -1) out.push(list[b][c]);
      }
    }
    return out;
  }

  // ---- Matrix --------------------------------------------------------------

  function Matrix(version) {
    this.size = version * 4 + 17;
    this.dark = [];
    this.fixed = [];
    for (var y = 0; y < this.size; y++) {
      var row = [], fixedRow = [];
      for (var x = 0; x < this.size; x++) { row.push(false); fixedRow.push(false); }
      this.dark.push(row);
      this.fixed.push(fixedRow);
    }
  }

  Matrix.prototype.set = function (x, y, dark) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  };

  function alignmentPositions(version, size) {
    if (version === 1) return [];
    var count = Math.floor(version / 7) + 2;
    var step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    var out = [6];
    for (var pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function drawFixed(m, version) {
    var size = m.size;
    var i, dx, dy;
    for (i = 0; i < size; i++) {
      m.set(6, i, i % 2 === 0);
      m.set(i, 6, i % 2 === 0);
    }
    var finders = [[3, 3], [size - 4, 3], [3, size - 4]];
    for (var f = 0; f < finders.length; f++) {
      for (dy = -4; dy <= 4; dy++) {
        for (dx = -4; dx <= 4; dx++) {
          var x = finders[f][0] + dx, y = finders[f][1] + dy;
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) m.set(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
    var align = alignmentPositions(version, size);
    var n = align.length;
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (dy = -2; dy <= 2; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            m.set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
    drawFormat(m, 0); // reserved now, the real bits once the mask is known
    if (version >= 7) {
      var rem = version;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var bits = version << 12 | rem;
      for (i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, b = Math.floor(i / 3);
        m.set(a, b, bit(bits, i));
        m.set(b, a, bit(bits, i));
      }
    }
  }

  function drawFormat(m, mask) {
    var data = FORMAT_LEVEL_M << 3 | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (data << 10 | rem) ^ 0x5412;
    var size = m.size;
    for (i = 0; i <= 5; i++) m.set(8, i, bit(bits, i));
    m.set(8, 7, bit(bits, 6));
    m.set(8, 8, bit(bits, 7));
    m.set(7, 8, bit(bits, 8));
    for (i = 9; i < 15; i++) m.set(14 - i, 8, bit(bits, i));
    for (i = 0; i < 8; i++) m.set(size - 1 - i, 8, bit(bits, i));
    for (i = 8; i < 15; i++) m.set(8, size - 15 + i, bit(bits, i));
    m.set(8, size - 8, true); // always dark
  }

  // Zigzag from the bottom right, two columns at a time.
  function drawData(m, codewords) {
    var size = m.size;
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!m.fixed[y][x] && i < codewords.length * 8) {
            m.dark[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (!m.fixed[y][x] && MASKS[mask](x, y)) m.dark[y][x] = !m.dark[y][x];
      }
    }
  }

  // ---- Penalty (lower reads more reliably) ---------------------------------

  function penalty(m) {
    var size = m.size;
    var score = 0;
    var x, y, k;
    function at(horizontal, line, i) { return horizontal ? m.dark[line][i] : m.dark[i][line]; }
    for (var pass = 0; pass < 2; pass++) {
      var horizontal = pass === 0;
      for (var line = 0; line < size; line++) {
        // Five or more in a row of the same color.
        var run = 1;
        for (k = 1; k <= size; k++) {
          if (k < size && at(horizontal, line, k) === at(horizontal, line, k - 1)) { run++; continue; }
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
        // Finder-like 1:1:3:1:1 with four light modules on one side
        // (outside the symbol counts as light: it is the quiet zone).
        for (k = 0; k + 7 <= size; k++) {
          if (at(horizontal, line, k) && !at(horizontal, line, k + 1) && at(horizontal, line, k + 2) &&
              at(horizontal, line, k + 3) && at(horizontal, line, k + 4) && !at(horizontal, line, k + 5) &&
              at(horizontal, line, k + 6) && (lightRun(horizontal, line, k - 4, k) || lightRun(horizontal, line, k + 7, k + 11))) {
            score += 40;
          }
        }
      }
    }
    function lightRun(horizontal, line, from, to) {
      for (var i = Math.max(from, 0); i < Math.min(to, size); i++) if (at(horizontal, line, i)) return false;
      return true;
    }
    // 2×2 blocks of one color.
    for (y = 0; y + 1 < size; y++) {
      for (x = 0; x + 1 < size; x++) {
        var c = m.dark[y][x];
        if (c === m.dark[y][x + 1] && c === m.dark[y + 1][x] && c === m.dark[y + 1][x + 1]) score += 3;
      }
    }
    // Balance of dark and light.
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m.dark[y][x]) dark++;
    var total = size * size;
    score += Math.floor(Math.abs(dark * 2 - total) * 10 / total) * 10;
    return score;
  }

  // ---- Encode --------------------------------------------------------------

  // Returns { version, mask, size, dark: [[bool]] } or null when too long.
  // options.mask forces a mask (0–7), for tests.
  function encode(text, options) {
    var bytes = utf8(text);
    var version, capacityBits;
    for (version = 1; version <= 40; version++) {
      capacityBits = dataCodewords(version) * 8;
      var countBits = version <= 9 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= capacityBits) break;
    }
    if (version > 40) return null;

    var bits = [];
    function push(value, length) { for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
    push(4, 4); // byte mode
    push(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    push(0, Math.min(4, capacityBits - bits.length)); // terminator
    push(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = b << 1 | bits[i + j];
      data.push(b);
    }

    var m = new Matrix(version);
    drawFixed(m, version);
    drawData(m, withErrorCorrection(data, version));
    var mask = options && options.mask;
    if (mask === undefined) {
      var best = Infinity;
      for (var candidate = 0; candidate < 8; candidate++) {
        applyMask(m, candidate);
        drawFormat(m, candidate);
        var score = penalty(m);
        if (score < best) { best = score; mask = candidate; }
        applyMask(m, candidate); // undo (XOR)
      }
    }
    applyMask(m, mask);
    drawFormat(m, mask);
    return { version: version, mask: mask, size: m.size, dark: m.dark };
  }

  // Black on white with the four-module quiet zone scanners need. scale:
  // screen pixels per module; whole pixels keep every module the same size.
  function svg(text, scale) {
    var code = encode(text);
    if (!code) return '';
    var quiet = 4;
    var path = '';
    for (var y = 0; y < code.size; y++) {
      for (var x = 0; x < code.size; x++) {
        if (code.dark[y][x]) path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      }
    }
    var full = code.size + quiet * 2;
    var px = full * (scale || 4);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + ' ' + full +
      '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges">' +
      '<rect width="' + full + '" height="' + full + '" fill="#fff"/>' +
      '<path fill="#000" d="' + path + '"/></svg>';
  }

  root.QR = { encode: encode, svg: svg };
})(this);
