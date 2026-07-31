/* ============================================================
   SPINE BRIDGE — the ONLY new code the v2 port needs.

   The app above this line is v1, unchanged: every screen, every feature,
   the whole Hindi/Hinglish/English layer, all 143 of its tests. Rewriting
   that would have been throwing away working, proven software.

   What v2 actually changes is the FLOOR, not the app: a bill must also land
   on the shared Dhandho spine, so the restaurant stops being an island and
   starts being an OS app — one Product, one Customer, one Invoice shared
   with every other Dhandho app, plus the events the bot reacts to.

   So this file listens to what the app already does and mirrors it. It adds
   nothing to the screens and takes nothing away: if the spine is unreachable,
   the shop keeps billing exactly as before and the mirror catches up later.
   ============================================================ */
(function (global) {
  'use strict';

  var C = global.DRCore;
  if (!C) return;

  var QUEUE_KEY = 'dhandho_spine_outbox' + (C.storeSuffix ? ':' + C.storeSuffix : '');

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-500))); } catch (e) {}
  }

  /* The two sides spell udhaar differently: this app has always called it
     'due', the spine calls it 'credit'. Sending 'due' through unchanged meant
     the spine did not recognise it as a credit sale at all — no khata entry
     was written, so the debt was silently dropped, and the guard that refuses
     a nameless udhaar bill never fired either. Map it once, here at the
     boundary, rather than teaching either side the other's vocabulary. */
  function spineMode(mode) {
    if (mode === 'due') return 'credit';
    return mode;
  }

  /* Translate v1's shapes into the spine's nouns. v1 already speaks in the
     right concepts (bill, line, payment, item), so this is a rename, not a
     redesign — which is exactly why the port is small. */
  function billToSpine(bill) {
    var d = C.db();
    return {
      kind: 'invoice',
      number: bill.no,
      docType: bill.docType,
      createdAt: bill.at,
      /* The spine re-checks that the bill adds up, so it needs the SAME parts
         v1 used to build the total — not just the total. A real restaurant
         bill is lines − discount + service charge + round-to-the-rupee, and
         sending only the first two would make every genuine bill look wrong. */
      taxablePaise: bill.totals.taxableBase,
      taxPaise: bill.totals.tax,
      discountPaise: bill.totals.discount || 0,
      serviceChargePaise: bill.totals.serviceCharge || 0,
      roundPaise: bill.totals.roundOff || 0,
      grandPaise: bill.totals.grand,
      status: bill.status || 'paid',
      channel: 'restaurant',
      /* Carry the customer across. Without this an udhaar bill mirrors as a
         debt nobody owes — the ingest side now REFUSES that rather than
         accepting an orphan receivable, so a credit bill with no name stays
         in this queue where it can be seen, instead of vanishing. */
      customerName: (bill.customer && bill.customer.name) || bill.customerName || null,
      customerPhone: (bill.customer && bill.customer.phone) || bill.customerPhone || null,
      deviceCode: d.device.code,
      lines: (bill.lines || []).filter(function (l) { return !l.voided; }).map(function (l) {
        /* A comp / staff meal is on the bill but charged at zero — v1 leaves
           it out of every total. Send it at rate 0 rather than dropping it:
           the money then adds up exactly as the shop billed it, AND the dish
           still reaches the recipe, so a free plate of paneer still takes
           paneer out of the fridge. Dropping the line would quietly overstate
           stock every time the owner fed someone. */
        var charged = l.lineType === 'SALE';
        return {
          name: l.name,
          qtyMilli: l.qtyMilli,
          unitPaise: charged ? l.unitPaise : 0,
          gstRate: charged
            ? (l.taxTreatment === 'GST_5' ? 5 : (l.taxTreatment === 'GST_18' ? 18 : 0))
            : 0
        };
      }),
      payments: (bill.payments || []).map(function (p) {
        return { mode: spineMode(p.mode), amountPaise: p.amountPaise };
      })
    };
  }

  var Bridge = {
    /** Queue one thing for the spine. Never throws into the billing path. */
    push: function (payload) {
      try {
        var q = loadQueue();
        q.push({ at: C.now(), payload: payload, sent: false });
        saveQueue(q);
      } catch (e) {}
    },

    mirrorBill: function (bill) {
      if (!bill) return;
      Bridge.push(billToSpine(bill));
    },

    pending: function () {
      return loadQueue().filter(function (r) { return !r.sent; }).length;
    },

    /** What would go to the spine — used by the doctor screen and by tests. */
    peek: function (n) {
      return loadQueue().slice(-(n || 5));
    },

    /** Start the spine engine once, lazily. Billing never waits on it. */
    ready: null,
    boot: function () {
      if (Bridge.ready) return Bridge.ready;
      var L = global.DhandhoLocal;
      if (!L || !L.boot) return Promise.resolve(false);
      Bridge.ready = L.boot().then(function () { return true; })
        .catch(function () { Bridge.ready = null; return false; });
      return Bridge.ready;
    },

    /**
     * Drain to the v2 engine when it is reachable. The engine is the same
     * service set the backend runs; here it is the in-page build.
     * A failure just leaves the row queued — the shop never notices.
     */
    drain: function () {
      return Bridge.boot().then(function (ok) {
        if (!ok) return 0;
        return Bridge._drain();
      });
    },

    _drain: function () {
      var api = global.DhandhoLocal && global.DhandhoLocal.api;
      if (!api || !api.ingest) return Promise.resolve(0);
      var q = loadQueue();
      var todo = q.filter(function (r) { return !r.sent; });
      if (!todo.length) return Promise.resolve(0);
      return api.ingest(todo.map(function (r) { return r.payload; }))
        .then(function () {
          q.forEach(function (r) { r.sent = true; });
          saveQueue(q);
          return todo.length;
        })
        .catch(function () { return 0; });
    }
  };

  /* Hook the app's own money path. We wrap rather than edit so v1's ops.js
     stays byte-identical and its tests keep passing. */
  var Ops = global.DROps;
  if (Ops) {
    ['settle', 'cancelBill', 'correctBill'].forEach(function (fn) {
      var original = Ops[fn];
      if (typeof original !== 'function') return;
      Ops[fn] = function () {
        var out = original.apply(this, arguments);
        try {
          var bill = out && out.no ? out : (out && out.bill) || null;
          if (bill) Bridge.mirrorBill(bill);
          else if (arguments[0]) {
            var b = Ops.billById && Ops.billById(arguments[0]);
            if (b) Bridge.mirrorBill(b);
          }
        } catch (e) {}
        return out;
      };
    });
  }

  global.DRSpine = Bridge;

  /* Drain quietly in the background: once shortly after opening, then every
     half minute. The counter never waits for this — if the spine is slow or
     absent the shop bills exactly as it always did. */
  setTimeout(function () { Bridge.drain(); }, 4000);
  setInterval(function () { Bridge.drain(); }, 30000);
})(window);
