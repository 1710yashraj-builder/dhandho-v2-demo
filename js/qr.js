/* ============================================================
   DHANDHO RESTAURANT — QR encoder
   Byte mode, error-correction level L, versions 1-10.
   Enough for any UPI intent string. No dependency, works offline.

   Used for the per-bill dynamic UPI QR: generated on the device from
   the restaurant's own VPA, so there is no gateway and no MDR, and
   every payment is attributable to a bill.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---- GF(256), primitive polynomial 0x11D ---- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Reed-Solomon generator polynomial of the given degree */
  function rsPoly(degree) {
    var poly = [1], i, j, np;
    for (i = 0; i < degree; i++) {
      /* multiply the polynomial by (x - alpha^i) */
      np = new Array(poly.length + 1);
      for (j = 0; j < np.length; j++) np[j] = 0;
      for (j = 0; j < poly.length; j++) {
        np[j] ^= poly[j];
        np[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = np;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsPoly(ecLen);
    var res = new Array(ecLen);
    var i, j;
    for (i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (j = 0; j < gen.length - 1; j++) {
        res[j] ^= gmul(gen[j + 1], factor);
      }
    }
    return res;
  }

  /* ---- Capacity tables, level L, versions 1-10 ----
     [ totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data ] */
  var CAP_L = {
    1:  [26,   7, 1, 19,  0, 0],
    2:  [44,  10, 1, 34,  0, 0],
    3:  [70,  15, 1, 55,  0, 0],
    4:  [100, 20, 1, 80,  0, 0],
    5:  [134, 26, 1, 108, 0, 0],
    6:  [172, 18, 2, 68,  0, 0],
    7:  [196, 20, 2, 78,  0, 0],
    8:  [242, 24, 2, 97,  0, 0],
    9:  [292, 30, 2, 116, 0, 0],
    10: [346, 18, 2, 68,  2, 69]
  };

  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function dataCapacity(v) {
    var c = CAP_L[v];
    return c[2] * c[3] + c[4] * c[5];
  }

  function utf8(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ---- Bit buffer ---- */
  function Bits() { this.bits = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };
  Bits.prototype.len = function () { return this.bits.length; };

  function buildCodewords(text, version) {
    var bytes = utf8(text);
    var capBytes = dataCapacity(version);
    var b = new Bits();
    b.put(4, 4);                                     /* byte mode */
    b.put(bytes.length, version < 10 ? 8 : 16);      /* char count */
    for (var i = 0; i < bytes.length; i++) b.put(bytes[i], 8);

    var capBits = capBytes * 8;
    if (b.len() > capBits) return null;

    /* terminator */
    var term = Math.min(4, capBits - b.len());
    b.put(0, term);
    /* pad to byte boundary */
    while (b.len() % 8 !== 0) b.bits.push(0);

    var cw = [];
    for (i = 0; i < b.bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | b.bits[i + j];
      cw.push(v);
    }
    /* pad codewords */
    var pads = [0xEC, 0x11], p = 0;
    while (cw.length < capBytes) { cw.push(pads[p % 2]); p++; }
    return cw;
  }

  /* Split into blocks, RS-encode each, then interleave. */
  function interleave(cw, version) {
    var c = CAP_L[version];
    var ecLen = c[1], g1 = c[2], d1 = c[3], g2 = c[4], d2 = c[5];
    var blocks = [], ecBlocks = [], pos = 0, i, j;

    for (i = 0; i < g1; i++) { blocks.push(cw.slice(pos, pos + d1)); pos += d1; }
    for (i = 0; i < g2; i++) { blocks.push(cw.slice(pos, pos + d2)); pos += d2; }
    for (i = 0; i < blocks.length; i++) ecBlocks.push(rsEncode(blocks[i], ecLen));

    var out = [];
    var maxData = Math.max(d1, d2 || 0);
    for (j = 0; j < maxData; j++) {
      for (i = 0; i < blocks.length; i++) {
        if (j < blocks[i].length) out.push(blocks[i][j]);
      }
    }
    for (j = 0; j < ecLen; j++) {
      for (i = 0; i < ecBlocks.length; i++) out.push(ecBlocks[i][j]);
    }
    return out;
  }

  /* ---- Matrix ---- */
  function makeMatrix(size) {
    var m = new Array(size), i, j;
    for (i = 0; i < size; i++) {
      m[i] = new Array(size);
      for (j = 0; j < size; j++) m[i][j] = null;   /* null = free */
    }
    return m;
  }

  function placeFinder(m, r, c) {
    var size = m.length;
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, version) {
    var pos = ALIGN[version];
    if (!pos.length) return;
    var size = m.length;
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        var r = pos[a], c = pos[b];
        /* skip the three finder corners */
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (var i = -2; i <= 2; i++) {
          for (var j = -2; j <= 2; j++) {
            var on = (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0));
            m[r + i][c + j] = on ? 1 : 0;
          }
        }
      }
    }
  }

  function placeTiming(m) {
    var size = m.length;
    for (var i = 8; i < size - 8; i++) {
      var v = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = v;
      if (m[i][6] === null) m[i][6] = v;
    }
  }

  function reserveFormat(m) {
    var size = m.length, i;
    for (i = 0; i <= 8; i++) {
      if (i !== 6) { if (m[8][i] === null) m[8][i] = 2; if (m[i][8] === null) m[i][8] = 2; }
    }
    for (i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 2;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 2;
    }
    m[size - 8][8] = 1;                     /* the always-dark module */
  }

  function reserveVersion(m, version) {
    if (version < 7) return;
    var size = m.length, i, j;
    for (i = 0; i < 6; i++) {
      for (j = 0; j < 3; j++) {
        m[size - 11 + j][i] = 2;
        m[i][size - 11 + j] = 2;
      }
    }
  }

  function placeData(m, data) {
    var size = m.length;
    var bitIdx = 0, dir = -1, row = size - 1, col = size - 1;
    function bit() {
      if (bitIdx >= data.length * 8) return 0;
      var b = (data[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return b;
    }
    while (col > 0) {
      if (col === 6) col--;                 /* skip the vertical timing column */
      while (true) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (m[row][cc] === null) m[row][cc] = bit();
        }
        row += dir;
        if (row < 0 || row >= size) {
          row -= dir;
          dir = -dir;
          break;
        }
      }
      col -= 2;
    }
  }

  function maskFn(n, r, c) {
    switch (n) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  /* Format info: 5 bits (2 ECC level + 3 mask) -> BCH(15,5), XOR 0x5412 */
  function formatBits(maskNo) {
    var data = (0x01 << 3) | maskNo;        /* level L = 01 */
    var v = data << 10;
    for (var i = 4; i >= 0; i--) {
      if ((v >>> (i + 10)) & 1) v ^= 0x537 << i;   /* generator 10100110111 */
    }
    return ((data << 10) | v) ^ 0x5412;
  }

  /* Version info for v7+: 6 bits -> BCH(18,6), generator 0x1F25 */
  function versionBits(version) {
    var v = version << 12;
    for (var i = 5; i >= 0; i--) {
      if ((v >>> (i + 12)) & 1) v ^= 0x1F25 << i;
    }
    return (version << 12) | v;
  }

  /* Format information placement.

     This is the single most error-prone table in QR and it is worth writing
     out literally rather than deriving with arithmetic. The 15-bit format
     value is written MOST-SIGNIFICANT BIT FIRST, starting at (8,0) and
     running right then up the column; the second copy starts at the bottom
     of column 8 and runs up, then along row 8 to the right edge.

     Verified against a reference encoder: level L + mask 2 must produce
     111110110101010 in exactly these cells. */
  function formatCells(size) {
    return {
      copy1: [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
              [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]],
      copy2: [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
              [size - 5, 8], [size - 6, 8], [size - 7, 8],
              [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
              [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]]
    };
  }

  function applyFormat(m, maskNo) {
    var size = m.length;
    var bits = formatBits(maskNo);
    var cells = formatCells(size);
    for (var k = 0; k < 15; k++) {
      var b = (bits >>> (14 - k)) & 1;        /* MSB first */
      m[cells.copy1[k][0]][cells.copy1[k][1]] = b;
      m[cells.copy2[k][0]][cells.copy2[k][1]] = b;
    }
    m[size - 8][8] = 1;                       /* always-dark module */
  }

  function applyVersion(m, version) {
    if (version < 7) return;
    var size = m.length;
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var b = (bits >>> i) & 1;
      var r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = b;
      m[r][size - 11 + c] = b;
    }
  }

  function penalty(m) {
    var size = m.length, score = 0, i, j, k;
    /* Rule 1: five or more same-colour in a row/column */
    for (i = 0; i < size; i++) {
      var runR = 1, runC = 1;
      for (j = 1; j < size; j++) {
        if (m[i][j] === m[i][j - 1]) { runR++; } else { if (runR >= 5) score += 3 + (runR - 5); runR = 1; }
        if (m[j][i] === m[j - 1][i]) { runC++; } else { if (runC >= 5) score += 3 + (runC - 5); runC = 1; }
      }
      if (runR >= 5) score += 3 + (runR - 5);
      if (runC >= 5) score += 3 + (runC - 5);
    }
    /* Rule 2: 2x2 blocks of the same colour */
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
      }
    }
    /* Rule 3: finder-like patterns */
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(arr, pat) {
      for (var z = 0; z < pat.length; z++) if (arr[z] !== pat[z]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j < size - 10; j++) {
        var rowArr = [], colArr = [];
        for (k = 0; k < 11; k++) { rowArr.push(m[i][j + k]); colArr.push(m[j + k][i]); }
        if (match(rowArr, pat1) || match(rowArr, pat2)) score += 40;
        if (match(colArr, pat1) || match(colArr, pat2)) score += 40;
      }
    }
    /* Rule 4: overall balance of dark modules */
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j] === 1) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function build(text) {
    var version = 0, v;
    for (v = 1; v <= 10; v++) {
      if (buildCodewords(text, v)) { version = v; break; }
    }
    if (!version) throw new Error('Text too long for QR (max ~270 bytes)');

    var cw = buildCodewords(text, version);
    var data = interleave(cw, version);
    var size = 17 + version * 4;

    /* Build the function-pattern template once. */
    var base = makeMatrix(size);
    placeFinder(base, 0, 0);
    placeFinder(base, 0, size - 7);
    placeFinder(base, size - 7, 0);
    placeAlignment(base, version);
    placeTiming(base);
    reserveVersion(base, version);
    reserveFormat(base);

    /* Remember which cells are function patterns (non-null before data). */
    var reserved = [];
    for (var i = 0; i < size; i++) {
      reserved.push([]);
      for (var j = 0; j < size; j++) reserved[i].push(base[i][j] !== null);
    }

    /* Place data on a copy where reserved-but-unknown cells (2) are cleared. */
    var work = makeMatrix(size);
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
      work[i][j] = (base[i][j] === 2) ? null : base[i][j];
    }
    /* Format/version areas must stay occupied so data skips them. */
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
      if (base[i][j] === 2) work[i][j] = 0;
    }
    placeData(work, data);

    /* Try every mask, keep the best. */
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var cand = makeMatrix(size);
      for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
        var val = work[i][j] || 0;
        if (!reserved[i][j] && maskFn(mk, i, j)) val = val ^ 1;
        cand[i][j] = val;
      }
      applyFormat(cand, mk);
      applyVersion(cand, version);
      var s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return best;
  }

  function canvas(text, px) {
    var m = build(text);
    var size = m.length;
    var quiet = 4;
    var total = size + quiet * 2;
    var scale = Math.max(1, Math.floor((px || 200) / total));
    var dim = total * scale;

    var cv = document.createElement('canvas');
    cv.width = dim; cv.height = dim;
    cv.style.width = dim + 'px';
    cv.style.height = dim + 'px';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'UPI payment QR code');
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (m[r][c] === 1) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
    return cv;
  }

  global.DRQR = { build: build, canvas: canvas };
})(window);
