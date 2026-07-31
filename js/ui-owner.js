/* ============================================================
   OWNER SURFACE
   One glanceable number, then the things that quietly cost him money.

   Design rule: no feature on this screen may add a single tap to the
   waiter's flow. The owner gets depth here; the floor stays bare.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, DR = global.DR;
  var T = global.T;

  function ownerView(root, arg) {
    if (arg && arg.recon) { reconScreen(root); return; }

    var d = C.db();
    var st = Ops.dayStats();
    var be = Ops.breakEven();
    var chain = C.verifyChain();
    var pct = be.perDayPaise ? Math.min(100, Math.round(st.sales / be.perDayPaise * 100)) : 0;

    root.innerHTML =
      /* --- the one number --- */
      '<div class="glass tint-blue card" style="margin-bottom:12px">' +
        '<div class="row-b">' +
          '<div class="t-xs dim">' + C.esc(T('Aaj ki bikri')) + '</div>' +
          '<span class="row gap6 t-xs dim"><span class="dot dot-live"></span>' + C.esc(T('live')) + '</span>' +
        '</div>' +
        '<div class="t-xl mono" id="oSales">' + C.money(st.sales, { decimals: 0 }) + '</div>' +
        '<div class="row gap8 wrap mt8">' +
          '<span class="pill">' + st.bills + ' ' + C.esc(T('bill')) + '</span>' +
          '<span class="pill">' + C.esc(T('avg')) + ' ' + C.money(st.avgBill, { decimals: 0 }) + '</span>' +
          (st.liquor ? '<span class="pill pill-violet">' + C.esc(T('sharab')) + ' ' + C.money(st.liquor, { decimals: 0 }) + '</span>' : '') +
        '</div>' +
      '</div>' +

      /* --- break-even --- */
      (be.perDayPaise
        ? '<div class="glass card" style="margin-bottom:12px">' +
            '<div class="row-b"><b class="t-sm">' + C.esc(T('Roz ka kharcha nikla?')) + '</b>' +
            '<span class="t-xs dim">' + C.money(be.perDayPaise, { decimals: 0 }) + ' ' + C.esc(T('chahiye')) + '</span></div>' +
            '<div style="height:12px;border-radius:99px;background:var(--well-deep);margin-top:10px;overflow:hidden">' +
              '<div style="height:100%;width:' + pct + '%;border-radius:99px;background:linear-gradient(90deg,#45c088,#7ee0b0)"></div>' +
            '</div>' +
            '<div class="t-xs dim mt8">' + C.esc(st.sales >= be.perDayPaise
              ? T('Nikal gaya. Ab jo hai wo bacha hai.')
              : C.money(be.perDayPaise - st.sales, { decimals: 0 }) + ' ' + T('aur karna hai')) + '</div>' +
          '</div>'
        : '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Roz kitna karna zaroori hai?')) + '</b>' +
            '<p class="t-xs dim mt8">' + C.esc(T('Kiraya, gas aur tankhwah daal dijiye — phir roz pata chalega.')) + '</p>' +
            '<button class="btn btn-sm mt8" id="oFixed">' + C.esc(T('Kharcha daalein')) + '</button>' +
          '</div>') +

      /* --- saamaan running low: filled in after the engine answers, so a
             slow disk never holds up the one number he opened this for --- */
      '<div id="oStockLow"></div>' +

      /* --- the nightly card: the cheapest theft signal there is --- */
      '<div class="glass ' + ((st.cancelled || st.orphanKots || st.discount) ? 'tint-amber' : '') + ' card" style="margin-bottom:12px">' +
        '<b class="t-sm">' + C.esc(T('Aaj raat ka hisaab')) + '</b>' +
        '<div class="grid g2 gap8 mt8">' +
          statCell(T('Bill cancel'), st.cancelled, st.cancelValue) +
          statCell(T('Discount'), null, st.discount) +
          statCell(T('Muft diya'), null, st.comp) +
          statCell(T('Parcha bina bill'), st.orphanKots, null) +
        '</div>' +
        ((st.cancelled || st.orphanKots)
          ? '<p class="t-xs mt8" style="color:var(--warn-ink)">' + C.esc(T('Dekh lijiye — kaunsa item, kis waqt, kisne.')) + '</p>'
          : '<p class="t-xs dim mt8">' + C.esc(T('Sab saaf hai.')) + '</p>') +
        '<button class="btn btn-sm mt8" id="oVoids">' + C.esc(T('Poora dekhein')) + '</button>' +
      '</div>' +

      /* --- cash vs upi --- */
      '<div class="glass card" style="margin-bottom:12px">' +
        '<b class="t-sm">' + C.esc(T('Paisa kaise aaya')) + '</b>' +
        '<div class="mt8">' + modeBar(st) + '</div>' +
      '</div>' +

      /* --- hourly --- */
      (Object.keys(st.byHour).length
        ? '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Kaunse ghante mein kitna')) + '</b>' + hourChart(st.byHour) +
          '</div>'
        : '') +

      /* --- online money --- */
      (st.aggOrders
        ? '<div class="glass tint-amber card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Online order')) + '</b>' +
            '<div class="row-b mt8"><span class="t-sm dim">' + C.esc(T('App par dikha')) + '</span><b class="mono">' + C.money(st.aggGross) + '</b></div>' +
            '<div class="row-b"><span class="t-sm dim">' + C.esc(T('Bank mein aayega')) + '</span><b class="mono">' + C.money(st.aggNet) + '</b></div>' +
            '<div class="row-b" style="padding-top:8px;margin-top:6px;border-top:1px solid var(--hair-strong)">' +
              '<span class="t-sm">' + C.esc(T('Platform le gaya')) + '</span>' +
              '<b class="mono" style="color:var(--bad-ink)">' + C.money(st.aggLost) + '</b></div>' +
            '<button class="btn btn-sm mt8" id="oRecon">' + C.esc(T('Payout milaan karein')) + '</button>' +
          '</div>'
        : '') +

      /* --- top items --- */
      (st.top.length
        ? '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Sabse zyada bika')) + '</b>' +
            '<div class="mt8">' + st.top.slice(0, 8).map(function (i) {
              return '<div class="row-b" style="padding:4px 0">' +
                '<span class="t-sm truncate"><span aria-hidden="true">' + i.icon + '</span> ' + C.esc(i.name) + '</span>' +
                '<span class="t-xs dim mono">' + i.qty + ' &middot; ' + C.money(i.amount, { decimals: 0 }) + '</span></div>';
            }).join('') + '</div>' +
          '</div>'
        : '') +

      /* --- trust --- */
      '<div class="glass ' + (chain.ok ? '' : 'tint-red') + ' card" style="margin-bottom:12px">' +
        '<div class="row-b"><b class="t-sm">' + C.esc(T('Hisaab ki zanjeer')) + '</b>' +
        '<span class="pill ' + (chain.ok ? 'pill-green' : 'pill-red') + '">' + C.esc(chain.ok ? T('✓ sahi') : T('⚠ toota')) + '</span></div>' +
        '<p class="t-xs dim mt8">' + (chain.checked + (C.db().eventsPast || []).length) + ' ' +
          C.esc(T('entry. Koi purana bill chupke se mit nahi sakta — zanjeer toot jaayegi.')) +
          ((C.db().eventsPast || []).length
            ? ' ' + C.esc(T('(Purana hisaab cloud se wapas aaya hai.)')) : '') + '</p>' +
      '</div>' +

      '<div class="grid g2 gap8" style="margin-bottom:20px">' +
        '<button class="btn" id="oExport">\u{1F4E4} ' + C.esc(T('Hisaab nikalein')) + '</button>' +
        '<button class="btn" id="oClose">\u{1F319} ' + C.esc(T('Din band')) + '</button>' +
      '</div>' +

      '<div class="grid g2 gap8" style="margin-bottom:20px">' +
        '<button class="btn" id="oKhata">\u{1F4D2} ' + C.esc(T('Udhaar khaata')) + '</button>' +
        '<button class="btn" id="oStock">\u{1F9C2} ' + C.esc(T('Saamaan')) + '</button>' +
      '</div>';

    var fx = C.el('#oFixed'); if (fx) fx.onclick = function () { DR.go('settings'); };
    var vd = C.el('#oVoids'); if (vd) vd.onclick = voidSheet;
    var rc = C.el('#oRecon'); if (rc) rc.onclick = function () { DR.go('owner', { recon: true }); };
    C.el('#oExport').onclick = exportSheet;
    C.el('#oClose').onclick = function () { global.DRCashier.dayCloseSheet(); };
    var kh = C.el('#oKhata'); if (kh) kh.onclick = function () { DR.go('khata'); };
    var stk = C.el('#oStock'); if (stk) stk.onclick = function () { DR.go('stock'); };

    /* Ask the v2 engine what is about to run out. If it says nothing — or
       cannot answer at all — this card simply never appears; the owner's
       screen is never blocked on it. */
    if (DR.stockLowPeek) {
      DR.stockLowPeek().then(function (low) {
        var box = C.el('#oStockLow');
        if (!box || !low || !low.length || DR.view !== 'owner') return;
        box.innerHTML =
          '<div class="glass tint-amber card" style="margin-bottom:12px">' +
            '<div class="row-b"><b class="t-sm">' + C.esc(T('Ye khatam hone wala hai')) + '</b>' +
              '<span class="pill pill-amber">' + low.length + '</span></div>' +
            '<div class="row gap8 wrap mt8">' +
              low.slice(0, 6).map(function (p) {
                return '<span class="pill">' + C.esc(p.name) + ' ' +
                  C.esc(String(Math.round((p.onHandMilli / 1000) * 100) / 100) + ' ' + (p.unit || '')) + '</span>';
              }).join('') +
            '</div>' +
            '<button class="btn btn-sm mt8" id="oStockGo">' + C.esc(T('Saamaan kholein')) + '</button>' +
          '</div>';
        var go = C.el('#oStockGo');
        if (go) go.onclick = function () { DR.go('stock'); };
      });
    }

    /* D5 — anything labelled live must actually tick. */
    DR.every(5000, function () {
      var e = C.el('#oSales');
      if (e) e.textContent = C.money(Ops.dayStats().sales, { decimals: 0 });
    });
  }

  function statCell(label, count, amount) {
    return '<div style="padding:8px;border-radius:12px;background:var(--well)">' +
      '<div class="t-xs dim">' + label + '</div>' +
      '<div class="mono" style="font-size:17px;font-weight:700">' +
        (count !== null && count !== undefined ? count : C.money(amount || 0, { decimals: 0 })) +
      '</div>' +
      (count !== null && count !== undefined && amount ? '<div class="t-xs dimmer">' + C.money(amount, { decimals: 0 }) + '</div>' : '') +
      '</div>';
  }

  function modeBar(st) {
    var modes = [
      ['cash', T('Cash'), '#45c088'],
      ['upi', 'UPI', '#5b9bd5'],
      ['card', T('Card'), '#b48be0'],
      ['due', T('Udhaar'), '#e8a33d']
    ];
    var total = modes.reduce(function (n, m) { return n + (st.byMode[m[0]] || 0); }, 0);
    if (!total) return '<p class="t-xs dim">' + C.esc(T('Abhi koi payment nahi.')) + '</p>';
    return '<div style="display:flex;height:14px;border-radius:99px;overflow:hidden;background:var(--well)">' +
      modes.map(function (m) {
        var v = st.byMode[m[0]] || 0;
        if (!v) return '';
        return '<div style="width:' + (v / total * 100) + '%;background:' + m[2] + '"></div>';
      }).join('') + '</div>' +
      '<div class="row gap8 wrap mt8">' + modes.map(function (m) {
        var v = st.byMode[m[0]] || 0;
        if (!v) return '';
        return '<span class="t-xs"><span class="dot" style="background:' + m[2] + '"></span> ' +
          m[1] + ' <b class="mono">' + C.money(v, { decimals: 0 }) + '</b></span>';
      }).join('') + '</div>';
  }

  function hourChart(byHour) {
    var hours = Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; });
    var max = Math.max.apply(null, hours.map(function (h) { return byHour[h]; }));
    return '<div class="row" style="align-items:flex-end;gap:4px;height:74px;margin-top:10px">' +
      hours.map(function (h) {
        var pct = Math.max(6, Math.round(byHour[h] / max * 100));
        return '<div class="grow" style="text-align:center">' +
          '<div style="height:56px;display:flex;align-items:flex-end">' +
            '<div style="width:100%;height:' + pct + '%;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#7ec4f5,#2e6da4)"></div>' +
          '</div>' +
          '<div class="t-xs dimmer" style="font-size:9px">' + h + '</div></div>';
      }).join('') + '</div>';
  }

  /* --------------------------------------------------------
     What got voided, discounted, comped — with who and when
     -------------------------------------------------------- */
  function voidSheet() {
    var d = C.db();
    var evs = Ops.voidLog().slice().reverse();
    var st = Ops.dayStats();

    var orphan = '';
    if (st.orphanKots) {
      orphan = '<div class="glass tint-amber card" style="margin-bottom:12px">' +
        '<b class="t-sm">' + st.orphanKots + ' ' + C.esc(T('parcha bina bill ke')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Kitchen mein gaya, bill nahi bana. Kabhi-kabhi grahak chala jaata hai — roz ho to poochhiye.')) + '</p>' +
        '</div>';
    }

    var html = orphan + (evs.length
      ? '<div class="glass card">' + evs.map(function (e) {
          var who = d.staff.filter(function (s) { return s.id === e.by; })[0];
          var reason = (C.VOID_REASONS.concat(C.DISCOUNT_REASONS))
            .filter(function (r) { return r.id === e.data.reason; })[0];
          return '<div class="row-b" style="padding:7px 0;border-top:1px solid var(--hair)">' +
            '<div class="grow" style="min-width:0">' +
              '<div class="t-sm truncate">' + (e.type === 'BILL_CANCEL' ? C.esc(T('Bill cancel')) + ' ' + C.esc(e.data.no || '') : C.esc(e.data.name || T('Item hatao'))) + '</div>' +
              '<div class="t-xs dimmer">' + C.hhmm(e.ts) + ' &middot; ' + C.esc(who ? who.name : 'staff') +
              (reason ? ' &middot; ' + C.esc(reason.en) : '') + '</div>' +
            '</div>' +
            '<span class="mono t-sm">' + C.money(e.data.valuePaise || e.data.grand || 0, { decimals: 0 }) + '</span>' +
          '</div>';
        }).join('') + '</div>'
      : '<p class="dim center" style="padding:20px 0">' + C.esc(T('Aaj kuch cancel nahi hua.')) + '</p>');

    DR.sheet(T('Aaj raat ka hisaab'), html);
  }

  /* --------------------------------------------------------
     RECONCILIATION — upload their settlement file, get a
     dispute-ready statement he can forward. Not a chart.
     -------------------------------------------------------- */
  function reconScreen(root) {
    var d = C.db();
    var last = d.recon.length ? d.recon[d.recon.length - 1] : null;

    root.innerHTML =
      '<div class="row gap8" style="margin-bottom:10px">' +
        '<button class="btn btn-sm btn-ghost" id="rBack">&#8592;</button>' +
        '<h1 style="font-size:22px">' + C.esc(T('Online payout milaan')) + '</h1>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:12px">' +
        '<p class="t-sm dim">' + C.esc(T('Swiggy/Zomato ke partner app se settlement file download kijiye, phir yahan daal dijiye. Hum aapke order se milaayenge aur jo kam aaya wo alag nikaal denge.')) + '</p>' +
        '<div class="row gap8 wrap mt14" id="rPlat">' +
          [['swiggy', 'Swiggy'], ['zomato', 'Zomato'], ['other', T('Aur')]].map(function (p, i) {
            return '<button class="btn btn-sm grow ' + (i === 0 ? 'btn-primary' : '') + '" data-p="' + p[0] + '">' + C.esc(p[1]) + '</button>';
          }).join('') +
        '</div>' +
        '<input type="file" accept=".csv,.txt" id="rFile" class="hidden">' +
        '<div class="row gap8 mt14">' +
          '<button class="btn grow" id="rPick">\u{1F4C4} ' + C.esc(T('File chuniye')) + '</button>' +
          '<button class="btn btn-ghost grow" id="rPaste">' + C.esc(T('Paste karein')) + '</button>' +
        '</div>' +
      '</div>' +

      '<div id="rOut">' + (last ? resultBlock(last) : '') + '</div>';

    var plat = 'swiggy';
    C.el('#rBack').onclick = function () { DR.go('owner'); };
    C.els('#rPlat button').forEach(function (b) {
      b.onclick = function () {
        plat = b.dataset.p;
        C.els('#rPlat button').forEach(function (x) { x.classList.toggle('btn-primary', x === b); });
      };
    });
    C.el('#rPick').onclick = function () { C.el('#rFile').click(); };
    C.el('#rFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { run(String(rd.result)); };
      rd.onerror = function () { DR.toast(T('File nahi khuli'), 'bad'); };
      rd.readAsText(f);
    };
    C.el('#rPaste').onclick = function () {
      DR.sheet(T('Settlement paste karein'),
        '<p class="t-xs dim" style="margin-bottom:10px">' + C.esc(T('Har line: order id, amount')) + '</p>' +
        '<textarea class="field" id="rTa" rows="8" style="min-height:160px" placeholder="12345678, 345.50&#10;12345679, 512.00"></textarea>' +
        '<button class="btn btn-primary btn-block mt14" id="rGo">' + C.esc(T('Milaao')) + '</button>',
        function (b) {
          b.querySelector('#rGo').onclick = function () {
            var txt = b.querySelector('#rTa').value;
            DR.closeSheet();
            setTimeout(function () { run(txt); }, 200);
          };
        });
    };

    function run(text) {
      var rows = Ops.parseSettlement(text);
      if (!rows.length) { DR.toast(T('File samajh nahi aayi — order id aur amount chahiye'), 'warn', 4000); return; }
      var res = Ops.reconcile(plat, rows);
      C.el('#rOut').innerHTML = resultBlock(res);
      bindResult(res);
      DR.toast(res.countMatched + ' ' + T('order mile'), res.shortfallPaise > 0 ? 'warn' : 'good', 3200);
    }

    function bindResult(res) {
      var b = C.el('#rDownload');
      if (b) b.onclick = function () { downloadDispute(res); };
    }
    if (last) bindResult(last);
  }

  function resultBlock(res) {
    var gapRows = res.matched.filter(function (m) { return m.gap > 100; });
    return '<div class="glass ' + (res.shortfallPaise > 0 ? 'tint-red' : 'tint-green') + ' card" style="margin-bottom:12px">' +
        '<div class="row-b"><b>' + C.esc(res.shortfallPaise > 0 ? T('Paisa kam aaya') : T('Sab poora aaya')) + '</b>' +
        '<b class="mono t-lg">' + C.money(res.shortfallPaise) + '</b></div>' +
        '<div class="row gap8 wrap mt8">' +
          '<span class="pill">' + res.countMatched + ' ' + C.esc(T('mile')) + '</span>' +
          (res.countMissing ? '<span class="pill pill-amber">' + res.countMissing + ' ' + C.esc(T('abhi nahi aaye')) + '</span>' : '') +
          (res.countExtra ? '<span class="pill pill-blue">' + res.countExtra + ' ' + C.esc(T('unke record mein extra')) + '</span>' : '') +
        '</div>' +
        (gapRows.length
          ? '<div class="mt14">' + gapRows.slice(0, 12).map(function (m) {
              return '<div class="row-b t-xs" style="padding:3px 0;border-top:1px solid var(--hair)">' +
                '<span class="mono">' + C.esc(m.ref) + '</span>' +
                '<span>' + C.esc(T('milna tha')) + ' <b class="mono">' + C.money(m.expected, { decimals: 0 }) + '</b>, ' + C.esc(T('aaya')) + ' <b class="mono">' + C.money(m.received, { decimals: 0 }) + '</b></span>' +
              '</div>';
            }).join('') + '</div>'
          : '') +
        (res.shortfallPaise > 0
          ? '<button class="btn btn-primary btn-block mt14" id="rDownload">\u{1F4E4} ' + C.esc(T('Dispute file banao')) + '</button>'
          : '') +
      '</div>';
  }

  /* The output is not a dashboard. It is a document he forwards to his
     account manager with order ids, expected, received and the gap. */
  function downloadDispute(res) {
    var rows = res.matched.filter(function (m) { return m.gap > 100; })
      .concat(res.missing.map(function (m) {
        return { ref: m.ref, expected: m.expected, received: 0, gap: m.expected, gross: m.gross };
      }));
    var csv = C.toCSV(rows, [
      { label: 'Order ID', key: 'ref' },
      { label: 'Order value', get: function (r) { return C.R(r.gross || 0).toFixed(2); } },
      { label: 'Expected settlement', get: function (r) { return C.R(r.expected).toFixed(2); } },
      { label: 'Actually received', get: function (r) { return C.R(r.received).toFixed(2); } },
      { label: 'Shortfall', get: function (r) { return C.R(r.gap).toFixed(2); } }
    ]);
    var header = 'Settlement dispute — ' + (C.db().setup.outletName || '') + '\n' +
      'Platform: ' + res.platform + '\nGenerated: ' + C.dmy(res.at) + ' ' + C.hhmm(res.at) + '\n' +
      'Total shortfall: ' + C.R(res.shortfallPaise).toFixed(2) + '\n\n';
    C.download('dispute-' + res.platform + '-' + C.dayKey() + '.csv', header + csv);
    DR.toast(T('File ban gayi — account manager ko bhej dijiye'), 'good', 3400);
  }

  function exportSheet() {
    DR.sheet(T('Hisaab nikalein'),
      '<p class="t-sm dim" style="margin-bottom:14px">' + C.esc(T('Aapka poora hisaab, muft, kabhi bhi. Hum band bhi ho jaayein to record aapka hai.')) + '</p>' +
      '<div class="col gap8">' +
        '<button class="btn btn-lg" id="exB">' + C.esc(T('Bill-wise (Excel)')) + '</button>' +
        '<button class="btn btn-lg" id="exI">' + C.esc(T('Item-wise (Excel)')) + '</button>' +
        '<button class="btn btn-lg" id="exA">' + C.esc(T('Poora backup (JSON)')) + '</button>' +
      '</div>',
      function (b) {
        b.querySelector('#exB').onclick = function () { global.DRSetup.exportBills(); };
        b.querySelector('#exI').onclick = function () { global.DRSetup.exportItems(); };
        b.querySelector('#exA').onclick = function () { global.DRSetup.exportAll(); };
      });
  }

  DR.register('owner', ownerView);
})(window);
