/* ============================================================
   DHANDHO RESTAURANT — core
   Local-first store, tamper-evident event chain, money math, GST
   document logic, invoice series, i18n.

   Everything here is synchronous and dependency-free so it works
   from file://, from localhost, and from a phone home screen with
   no network at all.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------
     1. SHA-256  (pure JS, synchronous, no crypto.subtle)
     crypto.subtle needs a secure context and is unavailable on
     file:// — this always works.
     --------------------------------------------------------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(message) {
    var bytes = utf8Bytes(String(message));
    var bitLen = bytes.length * 8;
    bytes = bytes.slice();
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64-bit big-endian length (we only need the low 32 bits realistically)
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64), i, j, a, b, c, d, e, f, g, h, s0, s1, ch, maj, t1, t2;

    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) {
        w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) |
               (bytes[i + j * 4 + 2] << 8) | (bytes[i + j * 4 + 3]);
      }
      for (j = 16; j < 64; j++) {
        s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (j = 0; j < 64; j++) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ (~e & g);
        t1 = (h + s1 + ch + K[j] + w[j]) | 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = (s0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return hex;
  }

  /* ---------------------------------------------------------
     2. Money — integer paise everywhere.
     Floats break totals. One rupee is 100 paise, always.
     Rule D1: every screen derives from these helpers. No screen
     computes money on its own.
     --------------------------------------------------------- */
  function P(rupees) { return Math.round((Number(rupees) || 0) * 100); }        // rupees -> paise
  function R(paise) { return (Number(paise) || 0) / 100; }                       // paise  -> rupees
  function money(paise, opts) {
    var neg = paise < 0;
    var v = Math.abs(Number(paise) || 0) / 100;
    var s = v.toLocaleString('en-IN', {
      minimumFractionDigits: (opts && opts.decimals === 0) ? 0 : 2,
      maximumFractionDigits: (opts && opts.decimals === 0) ? 0 : 2
    });
    return (neg ? '-' : '') + '₹' + s;                                       // ₹ = Rs sign
  }
  function moneyShort(paise) {
    var v = Math.abs(Number(paise) || 0) / 100;
    if (v >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr';
    if (v >= 100000)   return '₹' + (v / 100000).toFixed(2) + ' L';
    if (v >= 1000)     return '₹' + (v / 1000).toFixed(1) + 'k';
    return money(paise, { decimals: 0 });
  }
  /* Split a GST-inclusive amount into base + tax, in paise, exactly. */
  function splitInclusive(totalPaise, ratePct) {
    if (!ratePct) return { base: totalPaise, tax: 0 };
    var base = Math.round(totalPaise * 100 / (100 + ratePct));
    return { base: base, tax: totalPaise - base };
  }
  /* Quantity is stored in thousandths so 1.250 kg is exact.
     a * b / d with ONE documented rounding rule: half-up, away from zero.
     Every line total in the app goes through this. Nothing rounds twice. */
  function mulDiv(a, b, d) {
    var neg = (a < 0) !== (b < 0);
    var n = Math.abs(a) * Math.abs(b);
    var q = Math.floor(n / d);
    var rem = n - q * d;
    if (rem * 2 >= d) q += 1;                 // half-up
    return neg ? -q : q;
  }
  function qty(n) { return Math.round((Number(n) || 0) * 1000); }   // 1.25 -> 1250
  function qtyText(milli) {
    if (milli % 1000 === 0) return String(milli / 1000);
    return (milli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  /* ---------------------------------------------------------
     3. Ids, dates
     --------------------------------------------------------- */
  var ID_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function uid(prefix) {
    var s = '';
    for (var i = 0; i < 8; i++) s += ID_ALPHA[Math.floor(Math.random() * ID_ALPHA.length)];
    return (prefix || '') + s;
  }
  function deviceCode() {
    var s = '';
    for (var i = 0; i < 3; i++) s += ID_ALPHA[Math.floor(Math.random() * ID_ALPHA.length)];
    return s;
  }
  function now() { return Date.now(); }
  function pad(n, w) { return ('0000000' + n).slice(-(w || 2)); }
  function fyCode(ts) {                       // Indian financial year: Apr-Mar -> "2627"
    var d = new Date(ts || Date.now());
    var y = d.getFullYear(), m = d.getMonth();
    var start = (m >= 3) ? y : y - 1;
    return String(start).slice(2) + String(start + 1).slice(2);
  }
  function hhmm(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dmy(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function ago(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h';
  }

  /* ---------------------------------------------------------
     4. GST / document rules
     Decided once, here. No screen re-implements tax.
     --------------------------------------------------------- */
  var GST_PROFILES = {
    regular:      { rate: 5,  doc: 'TAX_INVOICE',    itc: false, label: 'Regular GST (5%, no ITC)' },
    hotel18:      { rate: 18, doc: 'TAX_INVOICE',    itc: true,  label: 'Hotel restaurant (18% with ITC)' },
    composition:  { rate: 0,  doc: 'BILL_OF_SUPPLY', itc: false, label: 'Composition scheme' },
    unregistered: { rate: 0,  doc: 'CASH_MEMO',      itc: false, label: 'Not registered' }
  };
  var DOC_TITLE = {
    TAX_INVOICE:    { en: 'TAX INVOICE',    hi: 'कर बीजक' },
    BILL_OF_SUPPLY: { en: 'BILL OF SUPPLY', hi: 'बिल ऑफ सप्लाई' },
    CASH_MEMO:      { en: 'CASH MEMO',      hi: 'कैश मेमो' }
  };
  var COMPOSITION_NOTE =
    'Composition taxable person, not eligible to collect tax on supplies';

  /* Void / discount reasons are a fixed list — free text invites laundering
     and makes the owner report useless. */
  var VOID_REASONS = [
    { id: 'wrong_item',   en: 'Wrong item entered',      hi: 'गलत आइटम' },
    { id: 'customer_left', en: 'Customer left',          hi: 'ग्राहक चला गया' },
    { id: 'kitchen_out',  en: 'Item not available',      hi: 'आइटम खत्म' },
    { id: 'test',         en: 'Test / training bill',    hi: 'टेस्ट बिल' },
    { id: 'duplicate',    en: 'Duplicate order',         hi: 'डबल ऑर्डर' }
  ];
  var DISCOUNT_REASONS = [
    { id: 'regular',   en: 'Regular customer',  hi: 'रेगुलर ग्राहक' },
    { id: 'complaint', en: 'Complaint / delay', hi: 'शिकायत / देरी' },
    { id: 'staff',     en: 'Staff meal',        hi: 'स्टाफ खाना' },
    { id: 'owner',     en: 'Owner approved',    hi: 'मालिक ने बोला' }
  ];

  /* Frozen enums. Defined ONCE. A second list somewhere else is how a bill
     ends up taxed two different ways on two screens. */
  var TAX_TREATMENT = ['GST_5', 'GST_18_HOTEL', 'EXEMPT', 'ALCOHOL_OUTSIDE_GST'];
  var LINE_TYPE = ['SALE', 'COMPLIMENTARY', 'STAFF_MEAL'];
  var LINE_TYPE_LABEL = {
    SALE:          { en: 'Sale',          hi: 'बिक्री' },
    COMPLIMENTARY: { en: 'Complimentary', hi: 'मुफ़्त' },
    STAFF_MEAL:    { en: 'Staff meal',    hi: 'स्टाफ खाना' }
  };

  /* Cash that legitimately leaves the drawer during service. Without this the
     day-close variance is meaningless and the owner stops trusting the number. */
  var CASH_REASONS = [
    { id: 'float',    dir: 'in',  en: 'Opening float',    hi: 'खुल्ला' },
    { id: 'purchase', dir: 'out', en: 'Purchase',         hi: 'खरीदारी' },
    { id: 'tip',      dir: 'out', en: 'Tips taken',       hi: 'टिप' },
    { id: 'petty',    dir: 'out', en: 'Small expense',    hi: 'छोटा खर्च' },
    { id: 'refund',   dir: 'out', en: 'Refund to guest',  hi: 'ग्राहक को वापस' },
    { id: 'bank',     dir: 'out', en: 'To bank / owner',  hi: 'बैंक / मालिक' },
    { id: 'cashin',   dir: 'in',  en: 'Cash added',       hi: 'कैश डाला' }
  ];

  /* Aggregator economics — used for the true-margin line.
     Ranges are from the research brief; the app shows the outlet's own
     configured numbers, never a made-up average. */
  var AGG_DEFAULTS = {
    swiggy: { name: 'Swiggy', commissionPct: 22, gatewayPct: 2.5, gstOnCommission: 18, tdsPct: 0.1 },
    zomato: { name: 'Zomato', commissionPct: 22, gatewayPct: 2.5, gstOnCommission: 18, tdsPct: 0.1 },
    other:  { name: 'Other',  commissionPct: 18, gatewayPct: 2.0, gstOnCommission: 18, tdsPct: 0.1 }
  };
  /* Given an order value in paise, what actually lands in the bank. */
  function aggSettlement(grossPaise, cfg) {
    var commission = Math.round(grossPaise * cfg.commissionPct / 100);
    var gstOnComm  = Math.round(commission * cfg.gstOnCommission / 100);
    var gateway    = Math.round(grossPaise * cfg.gatewayPct / 100);
    var tds        = Math.round(grossPaise * cfg.tdsPct / 100);
    var net        = grossPaise - commission - gstOnComm - gateway - tds;
    return {
      gross: grossPaise, commission: commission, gstOnCommission: gstOnComm,
      gateway: gateway, tds: tds, net: net,
      deductionPct: grossPaise ? ((grossPaise - net) / grossPaise * 100) : 0
    };
  }

  /* ---------------------------------------------------------
     5. Store  —  local-first.
     Everything lives on the device. "Sync" is a queue that drains
     when a server exists; nothing is ever lost waiting for it.
     --------------------------------------------------------- */
  var VERSION = '2.0.0';

  /* Drill mode: ?as=B gives this tab its own storage bucket, so one browser
     can act as two independent devices. Harmless in production. */
  var SUFFIX = (function () {
    try { return (location.search.match(/[?&]as=([A-Za-z0-9]+)/) || [])[1] || ''; }
    catch (e) { return ''; }
  })();
  var KEY = 'dhandho_restaurant_v1' + (SUFFIX ? ':' + SUFFIX : '');
  var DB = null;

  function blank() {
    return {
      v: 1,
      device: { id: uid('D'), code: deviceCode(), created: now() },
      setup: {
        done: false,
        demo: false,
        lang: 'hinglish',
        outletName: '',
        format: 'restaurant',     // restaurant | cafe | counter | cloud
        gstStatus: 'unregistered',
        gstin: '',
        fssai: '',
        phone: '',
        address: '',
        upiVpa: '',
        serviceChargePct: 0,      // ALWAYS starts at 0 (CCPA / Delhi HC)
        tier: 'restaurant',       // counter | restaurant | pro
        lite: false,
        pinHash: null,            // device-local: salted with device.id, never synced
        pinDev: null,             // which handset that hash was made on
        tables: 12
      },
      fixed: { rent: 0, gas: 0, salary: 0, other: 0, openDays: 30 },
      agg: { swiggy: AGG_DEFAULTS.swiggy, zomato: AGG_DEFAULTS.zomato, other: AGG_DEFAULTS.other },
      staff: [],
      categories: [],
      items: [],
      tables: [],
      orders: [],
      kots: [],
      bills: [],
      payments: [],
      events: [],           // append-only, hash-chained (THIS device's own chain)
      eventsPast: [],       // chains from earlier installs / other phones, pulled back
                            // on restore so wiping a phone cannot erase the record
      cash: [],             // drawer movements — makes day-close variance mean something
      recon: [],
      counters: { bill: 0, kot: 0, order: 0, token: 0 },
      session: { staffId: null, dayOpenedAt: null, openingCashPaise: 0, closed: {}, tokenDay: null },
      sync: { queue: 0, lastAttempt: null, online: false },
      printer: { ok: true, lastError: null, failCount: 0 },
      revCounter: 0,
      errors: [],           // ring buffer of recent JS errors, for the doctor
      cloud: {
        enabled: true, joined: false, pendingCreate: false,
        restaurantId: null, deviceId: null, restaurantName: '',
        pairCode: null, pairSecret: null, ownerCode: null,
        roles: ['waiter', 'kitchen', 'cashier', 'owner'],
        devices: [],
        dirty: {}, lastEntityMark: null, lastEventSeqPushed: 0,
        lastPushAt: null, lastPullAt: null, lastError: null, realtime: null
      }
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) { DB = JSON.parse(raw); }
    } catch (e) { DB = null; }
    if (!DB || !DB.v) DB = blank();
    // forward-compat: fill any key added in a later build
    var b = blank(), k;
    for (k in b) { if (!(k in DB)) DB[k] = b[k]; }
    for (k in b.setup) { if (!(k in DB.setup)) DB.setup[k] = b.setup[k]; }
    for (k in b.cloud) { if (!(k in DB.cloud)) DB.cloud[k] = b.cloud[k]; }
    return DB;
  }

  var saveTimer = null;
  function save(immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (immediate) return writeNow();
    saveTimer = setTimeout(writeNow, 120);
  }
  function writeNow() {
    saveTimer = null;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(DB));
      /* Settings, fixed costs and aggregator rates are edited from a dozen
         places. Asking each one to remember to mark itself dirty is how the
         shop ends up printing last month's UPI QR on a second phone. The sync
         layer notices the change here instead, so every edit is covered --
         including ones written after this line. */
      if (global.DRSync && global.DRSync.noteLocalSave) global.DRSync.noteLocalSave();
      return true;
    } catch (e) {
      // Storage full or blocked (private mode). Tell the truth, never silently lose a bill.
      if (global.DR && global.DR.toast) {
        var msg = 'Phone storage bhar gaya — purana data export karein';
        global.DR.toast(global.T ? global.T(msg) : msg, 'warn', 6000);
      }
      return false;
    }
  }
  function db() { return DB || load(); }
  function reset() { DB = blank(); writeNow(); }

  /* ---------------------------------------------------------
     6. The append-only event chain
     Every money-moving action is written here and hash-linked to the
     one before it. Nothing is ever edited or deleted — a mistake is
     corrected by a NEW event that references the old one.

     CGST Rule 56(8) already requires this log. Most competitors do
     not keep one.
     --------------------------------------------------------- */
  function logEvent(type, data) {
    var d = db();
    var prev = d.events.length ? d.events[d.events.length - 1].hash : 'GENESIS';
    var ev = {
      seq: d.events.length + 1,
      ts: now(),
      type: type,
      by: d.session.staffId || 'owner',
      dev: d.device.code,
      data: data || {}
    };
    ev.prev = prev;
    ev.hash = sha256(ev.seq + '|' + ev.ts + '|' + ev.type + '|' + ev.by + '|' +
                     JSON.stringify(ev.data) + '|' + prev);
    d.events.push(ev);
    save();
    return ev;
  }

  /* Re-walk the whole chain and report the first break, if any. */
  function verifyChain() {
    var d = db(), prev = 'GENESIS', i, ev, expect;
    for (i = 0; i < d.events.length; i++) {
      ev = d.events[i];
      if (ev.prev !== prev) {
        return { ok: false, at: ev.seq, reason: 'link', checked: i };
      }
      expect = sha256(ev.seq + '|' + ev.ts + '|' + ev.type + '|' + ev.by + '|' +
                      JSON.stringify(ev.data) + '|' + ev.prev);
      if (expect !== ev.hash) {
        return { ok: false, at: ev.seq, reason: 'content', checked: i };
      }
      prev = ev.hash;
    }
    return { ok: true, checked: d.events.length, head: prev };
  }

  /* ---------------------------------------------------------
     7. Invoice series — per device.
     CGST Rule 46(b) permits "one or multiple series".
     Max 16 chars; only A-Z, 0-9, hyphen, slash.
     Format: <DEV3>/<FY4>/<NNNNN>  e.g.  K7P/2627/00042   (14 chars)
     One series per device means two phones billing at once can never
     collide, with zero server coordination. That is what makes true
     offline billing legal AND safe.
     --------------------------------------------------------- */
  var SERIES_OK = /^[A-Z0-9\-\/]{1,16}$/;
  function nextBillNo() {
    var d = db();
    d.counters.bill += 1;
    var no = d.device.code + '/' + fyCode() + '/' + pad(d.counters.bill, 5);
    return no;
  }
  function seriesValid(no) { return SERIES_OK.test(no) && no.length <= 16; }

  /* ---------------------------------------------------------
     8. i18n
     --------------------------------------------------------- */
  var STR = {
    tables:      { en: 'Tables',      hi: 'टेबल',            hinglish: 'Tables' },
    kitchen:     { en: 'Kitchen',     hi: 'रसोई',            hinglish: 'Kitchen' },
    counter:     { en: 'Counter',     hi: 'काउंटर', hinglish: 'Counter' },
    owner:       { en: 'Owner',       hi: 'मालिक',       hinglish: 'Malik' },
    menu:        { en: 'Menu',        hi: 'मेनू',             hinglish: 'Menu' },
    fire:        { en: 'SEND',        hi: 'भेजो',             hinglish: 'BHEJO' },
    bill:        { en: 'BILL',        hi: 'बिल',                   hinglish: 'BILL' },
    free:        { en: 'Free',        hi: 'खाली',             hinglish: 'Khali' },
    running:     { en: 'Running',     hi: 'चल रहा',      hinglish: 'Chal raha' },
    ready:       { en: 'Ready',       hi: 'तैयार',       hinglish: 'Taiyaar' },
    today:       { en: 'Today',       hi: 'आज',                         hinglish: 'Aaj' },
    cash:        { en: 'Cash',        hi: 'नकद',                   hinglish: 'Cash' },
    upi:         { en: 'UPI',         hi: 'UPI',                                  hinglish: 'UPI' },
    card:        { en: 'Card',        hi: 'कार्ड',       hinglish: 'Card' },
    takeaway:    { en: 'Takeaway',    hi: 'पार्सल', hinglish: 'Parcel' },
    delivery:    { en: 'Delivery',    hi: 'डिलीवरी', hinglish: 'Delivery' },
    online:      { en: 'Online',      hi: 'ऑनलाइन', hinglish: 'Online' },
    halfPlate:   { en: 'Half',        hi: 'हाफ',                   hinglish: 'Half' },
    fullPlate:   { en: 'Full',        hi: 'फुल',                   hinglish: 'Full' },
    noOnion:     { en: 'No onion',    hi: 'बिना प्याज', hinglish: 'Bina pyaz' },
    spicy:       { en: 'Extra spicy', hi: 'तेज मिर्च', hinglish: 'Tez mirch' },
    lessSpicy:   { en: 'Less spicy',  hi: 'कम मिर्च', hinglish: 'Kam mirch' },
    jain:        { en: 'Jain',        hi: 'जैन',                   hinglish: 'Jain' },
    parcelMod:   { en: 'Parcel',      hi: 'पैक करो', hinglish: 'Pack karo' },
    total:       { en: 'Total',       hi: 'कुल',                   hinglish: 'Total' },
    save:        { en: 'Save',        hi: 'सेव',                   hinglish: 'Save' },
    cancel:      { en: 'Cancel',      hi: 'रद्द',             hinglish: 'Cancel' },
    settle:      { en: 'Settle',      hi: 'पेमेंट', hinglish: 'Payment lo' }
  };
  function t(key) {
    var lang = (db().setup.lang) || 'hinglish';
    var e = STR[key];
    if (!e) return key;
    return e[lang] || e.en;
  }

  /* ---------------------------------------------------------
     9. Export — the promise that costs us nothing and beats the market.
     Free, full, forever, including after cancellation.
     --------------------------------------------------------- */
  function toCSV(rows, cols) {
    var head = cols.map(function (c) { return '"' + c.label.replace(/"/g, '""') + '"'; }).join(',');
    var body = rows.map(function (r) {
      return cols.map(function (c) {
        var v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        if (v === null || v === undefined) v = '';
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');
    return head + '\n' + body;
  }

  /* Saving a file is the one thing that behaves completely differently inside
     the Android app. A browser download is an <a download> click; an Android
     WebView drops that on the floor unless something is listening, with no
     error. So the app used to announce a nightly backup that did not exist.
     Returns a promise of whether a file really reached the phone -- callers
     must not claim success without it. */
  function isNative() {
    var Cap = global.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  function download(filename, text, mime) {
    var Cap = global.Capacitor;
    if (isNative()) {
      var P = Cap.Plugins || {};
      if (!P.Filesystem) return Promise.resolve(false);   /* be honest, not hopeful */
      return P.Filesystem.writeFile({
        path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true
      }).then(function (res) {
        /* Offer the share sheet so he can send it to his own WhatsApp in the
           same breath -- a file sitting in Documents is not a backup he has. */
        if (P.Share && res && res.uri) {
          return P.Share.share({ title: filename, url: res.uri })
            .then(function () { return true; })
            .catch(function () { return true; });   /* saved; he just closed the sheet */
        }
        return true;
      }).catch(function () { return false; });
    }

    try {
      var blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* ---------------------------------------------------------
     10. Tiny DOM helpers
     --------------------------------------------------------- */
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function h(tag, attrs, html) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /* ---------------------------------------------------------
     Export the namespace
     --------------------------------------------------------- */
  global.DRCore = {
    VERSION: VERSION,
    storeSuffix: SUFFIX,
    storeKey: KEY,
    sha256: sha256,
    P: P, R: R, money: money, moneyShort: moneyShort, splitInclusive: splitInclusive,
    mulDiv: mulDiv, qty: qty, qtyText: qtyText,
    uid: uid, now: now, pad: pad, fyCode: fyCode, hhmm: hhmm, dmy: dmy, dayKey: dayKey, ago: ago,
    GST_PROFILES: GST_PROFILES, DOC_TITLE: DOC_TITLE, COMPOSITION_NOTE: COMPOSITION_NOTE,
    VOID_REASONS: VOID_REASONS, DISCOUNT_REASONS: DISCOUNT_REASONS,
    TAX_TREATMENT: TAX_TREATMENT, LINE_TYPE: LINE_TYPE, LINE_TYPE_LABEL: LINE_TYPE_LABEL,
    CASH_REASONS: CASH_REASONS,
    AGG_DEFAULTS: AGG_DEFAULTS, aggSettlement: aggSettlement,
    load: load, save: save, db: db, reset: reset, writeNow: writeNow,
    logEvent: logEvent, verifyChain: verifyChain,
    nextBillNo: nextBillNo, seriesValid: seriesValid,
    t: t, STR: STR,
    toCSV: toCSV, download: download, isNative: isNative,
    el: el, els: els, esc: esc, h: h
  };
})(window);
