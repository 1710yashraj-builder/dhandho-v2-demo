/* ============================================================
   COUNTER SURFACE
   Billing, payment, corrections, the cash drawer and day close.

   Two things here exist because a POS that cannot bill is worse than
   the pad it replaced:
   - SEEDHA BILL: a bill with no order behind it (walk-in, phone order,
     four tables someone wrote on paper during a power cut).
   - BILL THEEK KARO: a customer comes back at 10:15pm with a wrong bill
     and eleven people are waiting behind him.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, D = global.DRData, DR = global.DR;
  var T = global.T;

  var draft = null;   // for seedha bill

  /* --------------------------------------------------------
     Counter home
     -------------------------------------------------------- */
  function cashierView(root, arg) {
    if (arg && arg.orderId) { billScreen(root, arg.orderId); return; }
    if (arg && arg.seedha) { seedhaBill(root); return; }
    if (arg && arg.billId) { settleScreen(root, arg.billId); return; }

    var d = C.db();
    var open = Ops.openOrders().filter(function (o) { return o.lines.some(function (l) { return !l.voided; }); });
    var unpaid = d.bills.filter(function (b) { return b.status === 'unpaid'; });
    var st = Ops.dayStats();

    root.innerHTML =
      '<div class="row-b" style="margin-bottom:12px"><h1>' + C.esc(T('Counter')) + '</h1>' +
        '<button class="btn btn-sm" id="cSeedha">\u{1F9FE} ' + C.esc(T('Seedha bill')) + '</button></div>' +

      '<div class="glass tint-blue card" style="margin-bottom:12px">' +
        '<div class="row-b">' +
          '<div><div class="t-xs dim">' + C.esc(T('Aaj ki bikri')) + '</div>' +
          '<div class="t-lg mono">' + C.money(st.sales, { decimals: 0 }) + '</div></div>' +
          '<div class="rt"><div class="t-xs dim">' + C.esc(T('Bill')) + '</div><div class="t-lg mono">' + st.bills + '</div></div>' +
        '</div>' +
      '</div>' +

      (unpaid.length
        ? '<h3 style="margin:14px 0 8px">' + C.esc(T('Paisa baaki')) + '</h3><div class="col gap8" id="cUnpaid">' +
          unpaid.map(function (b) {
            return '<button class="btn btn-lg" data-b="' + b.id + '" style="justify-content:space-between">' +
              '<span>' + C.esc(b.no) + (b.tableLabel ? ' &middot; ' + C.esc(T('Mez')) + ' ' + C.esc(b.tableLabel) : b.token ? ' &middot; ' + C.esc(b.token) : '') + '</span>' +
              '<b class="mono">' + C.money(b.totals.grand, { decimals: 0 }) + '</b></button>';
          }).join('') + '</div>'
        : '') +

      '<h3 style="margin:14px 0 8px">' + C.esc(T('Chal rahe hain')) + '</h3>' +
      (open.length
        ? '<div class="col gap8" id="cOpen">' + open.map(function (o) {
            var tbl = d.tables.filter(function (t) { return t.id === o.tableId; })[0];
            var tot = Ops.computeTotals(o.lines, {}).grand;
            return '<button class="btn btn-lg" data-o="' + o.id + '" style="justify-content:space-between">' +
              '<span>' + (tbl ? C.esc(T('Mez')) + ' ' + C.esc(tbl.label) : C.esc(o.token || o.type)) +
              ' <span class="t-xs dim">' + C.ago(o.createdAt) + '</span></span>' +
              '<b class="mono">' + C.money(tot, { decimals: 0 }) + '</b></button>';
          }).join('') + '</div>'
        : '<p class="dim t-sm">' + C.esc(T('Koi order chalu nahi.')) + '</p>') +

      '<div class="grid g2 gap8 mt20">' +
        '<button class="btn" id="cBook">\u{1F4D2} ' + C.esc(T('Bill book')) + '</button>' +
        '<button class="btn" id="cCash">\u{1F4B5} ' + C.esc(T('Cash nikala/daala')) + '</button>' +
        '<button class="btn" id="cAgg">\u{1F6F5} ' + C.esc(T('Online milaan')) + '</button>' +
        '<button class="btn btn-warn" id="cClose">\u{1F319} ' + C.esc(T('Din band karo')) + '</button>' +
      '</div>';

    C.el('#cSeedha').onclick = function () { DR.go('cashier', { seedha: true }); };
    C.els('[data-o]').forEach(function (b) { b.onclick = function () { DR.go('cashier', { orderId: b.dataset.o }); }; });
    C.els('[data-b]').forEach(function (b) { b.onclick = function () { DR.go('cashier', { billId: b.dataset.b }); }; });
    C.el('#cBook').onclick = function () { billBook(); };
    C.el('#cCash').onclick = function () { cashSheet(); };
    C.el('#cAgg').onclick = function () { DR.go('owner', { recon: true }); };
    C.el('#cClose').onclick = function () { dayCloseSheet(); };
  }

  /* --------------------------------------------------------
     Bill screen — review an order, adjust, issue
     -------------------------------------------------------- */
  var billState = { discountPaise: 0, discountReason: null, serviceChargeOn: false, selected: {} };

  function billScreen(root, orderId) {
    var o = Ops.orderById(orderId);
    if (!o) { DR.go('cashier'); return; }
    billState = { discountPaise: 0, discountReason: null, serviceChargeOn: false, selected: {} };
    /* The waiter's BILL button and this screen's "Bill banao" occupy the exact
       same rectangle, and the router swaps screens synchronously. Without an
       arm delay the second half of a double-tap lands on the issue button and
       a bill goes out before the cashier has seen it. */
    var armedAt = Date.now() + 400;

    function paint() {
      var d = C.db();
      var tbl = d.tables.filter(function (t) { return t.id === o.tableId; })[0];
      var t = Ops.computeTotals(o.lines, billState);
      var prof = Ops.taxProfile();
      var lines = o.lines.filter(function (l) { return !l.voided; });

      root.innerHTML =
        '<div class="row gap8" style="margin-bottom:10px">' +
          '<button class="btn btn-sm btn-ghost" id="bBack">&#8592;</button>' +
          '<h1 style="font-size:22px">' + (tbl ? C.esc(T('Mez')) + ' ' + C.esc(tbl.label) : C.esc(o.token || 'Order')) + '</h1>' +
          '<span class="pill pill-blue">' + C.esc(d.setup.lang === 'hi' ? C.DOC_TITLE[prof.doc].hi : C.DOC_TITLE[prof.doc].en) + '</span>' +
        '</div>' +

        '<div class="glass card" style="margin-bottom:10px;padding:10px 12px">' +
          lines.map(function (l) {
            return '<div class="row-b" style="padding:6px 0;border-top:1px solid var(--hair)">' +
              '<div class="row gap6 grow" style="min-width:0">' +
                '<span class="pill" style="padding:1px 7px;font-size:11px">' + C.qtyText(l.qtyMilli) + '</span>' +
                '<span class="truncate t-sm">' + C.esc(l.name) +
                (l.variant === 'half' ? ' (H)' : '') +
                (l.isLiquor ? ' <span class="pill pill-violet" style="padding:0 5px;font-size:9px">No GST</span>' : '') +
                (l.lineType !== 'SALE' ? ' <span class="pill pill-violet" style="padding:0 5px;font-size:9px">' + C.esc(T('Muft').toUpperCase()) + '</span>' : '') +
                '</span>' +
              '</div>' +
              '<span class="mono t-sm">' + C.money(Ops.linePaise(l), { decimals: 0 }) + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +

        totalsBlock(t) +

        '<div class="row gap8 wrap mt14">' +
          '<button class="btn btn-sm grow" id="bDisc">' + C.esc(T('Discount')) + '</button>' +
          (C.db().setup.serviceChargePct > 0
            ? '<button class="btn btn-sm grow ' + (billState.serviceChargeOn ? 'btn-go' : '') + '" id="bSc">' + C.esc(T('Service charge')) + '</button>'
            : '') +
          '<button class="btn btn-sm grow" id="bAdd">' + C.esc(T('+ Item')) + '</button>' +
        '</div>' +

        '<div style="height:150px"></div>' +
        '<div style="position:fixed;left:10px;right:10px;bottom:calc(72px + var(--safe-b));z-index:45">' +
          '<div class="glass glass-raised" style="padding:8px;border-radius:20px">' +
            '<div class="row gap8">' +
              '<div class="grow" style="padding-left:8px">' +
                '<div class="t-xs dimmer">' + C.esc(T('Total')) + '</div>' +
                '<div class="mono" style="font-size:22px;font-weight:700">' + C.money(t.grand, { decimals: 0 }) + '</div>' +
              '</div>' +
              '<button class="btn btn-go btn-lg" id="bIssue" style="min-width:150px"' +
                (lines.length ? '' : ' disabled') + '>' + C.esc(T('Bill banao →')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      C.el('#bBack').onclick = function () { DR.go('cashier'); };
      C.el('#bDisc').onclick = function () { discountSheet(paint); };
      var sc = C.el('#bSc');
      if (sc) sc.onclick = function () {
        billState.serviceChargeOn = !billState.serviceChargeOn;
        if (billState.serviceChargeOn) DR.toast('Service charge lag gaya — bill par "voluntary" chhapega', 'warn', 3200);
        paint();
      };
      C.el('#bAdd').onclick = function () { global.DRWaiter.openOrder(orderId); };
      C.el('#bIssue').onclick = function () {
        if (Date.now() < armedAt) return;          /* swallow a double-tap carried over from the waiter screen */
        var bill;
        try {
          bill = Ops.billFromOrder(orderId, billState);
        } catch (e) { DR.toast(e.message, 'bad', 4000); return; }
        DR.go('cashier', { billId: bill.id });
      };
    }
    paint();
  }

  function totalsBlock(t) {
    var rows = [];
    /* With GST-inclusive menu prices the gross ALREADY contains the tax, so
       printing it as "Subtotal" and then listing CGST/SGST under it makes the
       column not add up to the total. Show the taxable value instead — then
       taxable + CGST + SGST is exactly the amount charged. */
    if (t.inclusive && t.taxRate && t.tax) {
      rows.push([T('Taxable value'), t.taxableBase, false]);
    } else {
      rows.push([T('Subtotal'), t.foodGross + t.exemptGross, false]);
      if (t.discount) rows.push([T('Discount'), -t.discount, false]);
      if (t.serviceCharge) rows.push([T('Service charge (voluntary)'), t.serviceCharge, false]);
    }
    if (t.taxRate && t.tax) {
      rows.push(['CGST ' + (t.taxRate / 2) + '%', t.cgst, false]);
      rows.push(['SGST ' + (t.taxRate / 2) + '%', t.sgst, false]);
    }
    if (t.inclusive && t.taxRate && t.tax && t.discount) {
      rows.push([T('Discount'), -t.discount, false]);
    }
    if (t.liquorNet) rows.push([T('Sharab (GST se bahar)'), t.liquorNet, false]);
    if (t.roundOff) rows.push([T('Round off'), t.roundOff, false]);

    return '<div class="glass card">' +
      rows.map(function (r) {
        return '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + r[0] + '</span>' +
          '<span class="mono">' + C.money(r[1]) + '</span></div>';
      }).join('') +
      '<div class="row-b" style="padding-top:8px;margin-top:6px;border-top:1px solid var(--hair-strong)">' +
        '<b>' + C.esc(T('Total')) + '</b><b class="mono" style="font-size:19px">' + C.money(t.grand) + '</b></div>' +
      (t.compValue ? '<div class="t-xs dimmer mt8">' + C.esc(T('Muft diya gaya:')) + ' ' + C.money(t.compValue) + '</div>' : '') +
      (t.inclusive && t.taxRate ? '<div class="t-xs dimmer mt8">' + C.esc(T('Daam mein GST shaamil hai')) + '</div>' : '') +
      '</div>';
  }

  function discountSheet(after) {
    var html =
      '<label class="lbl">' + C.esc(T('Kitna discount?')) + '</label>' +
      '<input class="field" id="dsAmt" type="number" inputmode="decimal" min="0" value="' + (billState.discountPaise / 100 || '') + '" placeholder="0">' +
      '<label class="lbl mt14">' + C.esc(T('Kyun? (malik ko dikhega)')) + '</label>' +
      '<div class="col gap8" id="dsR">' +
        C.DISCOUNT_REASONS.map(function (r) {
          return '<button class="btn ' + (billState.discountReason === r.id ? 'btn-primary' : '') + '" data-r="' + r.id + '">' +
            C.esc(C.db().setup.lang === 'hi' ? r.hi : r.en) + '</button>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-primary btn-block mt14" id="dsSave">' + C.esc(T('Lagao')) + '</button>';

    DR.sheet(T('Discount'), html, function (b) {
      C.els('[data-r]', b).forEach(function (x) {
        x.onclick = function () {
          billState.discountReason = x.dataset.r;
          C.els('[data-r]', b).forEach(function (y) { y.classList.toggle('btn-primary', y === x); });
        };
      });
      b.querySelector('#dsSave').onclick = function () {
        var amt = Math.max(0, C.P(b.querySelector('#dsAmt').value));
        if (amt > 0 && !billState.discountReason) { DR.toast(T('Wajah chuniye'), 'warn'); return; }
        billState.discountPaise = amt;
        DR.closeSheet();
        if (after) setTimeout(after, 80);
      };
    });
  }

  /* --------------------------------------------------------
     SETTLE — take the money
     -------------------------------------------------------- */
  function settleScreen(root, billId) {
    var b = Ops.billById(billId);
    if (!b) { DR.go('cashier'); return; }
    var d = C.db();

    if (b.status === 'paid') { paidScreen(root, b); return; }

    var due = b.totals.grand;
    var parts = [];

    function paid() { return parts.reduce(function (n, p) { return n + p.amountPaise; }, 0); }
    function left() { return due - paid(); }

    function paint() {
      root.innerHTML =
        '<div class="row gap8" style="margin-bottom:10px">' +
          '<button class="btn btn-sm btn-ghost" id="sBack">&#8592;</button>' +
          '<h1 style="font-size:22px">' + C.esc(T('Paisa lijiye')) + '</h1>' +
        '</div>' +

        '<div class="glass tint-green card center" style="margin-bottom:12px">' +
          '<div class="t-xs dim">' + C.esc(b.no) + '</div>' +
          '<div class="t-xl mono">' + C.money(due, { decimals: 0 }) + '</div>' +
          (parts.length ? '<div class="t-sm mt8">' + C.esc(T('Baaki')) + ': <b class="mono">' + C.money(left()) + '</b></div>' : '') +
        '</div>' +

        (parts.length
          ? '<div class="glass card" style="margin-bottom:12px">' + parts.map(function (p, i) {
              return '<div class="row-b t-sm" style="padding:4px 0">' +
                '<span>' + p.mode.toUpperCase() + (p.ref ? ' #' + C.esc(p.ref) : '') + '</span>' +
                '<span class="row gap6"><span class="mono">' + C.money(p.amountPaise) + '</span>' +
                '<button class="btn btn-sm btn-ghost" data-rm="' + i + '" style="min-height:26px;padding:0 8px">&#10005;</button></span>' +
              '</div>';
            }).join('') + '</div>'
          : '') +

        (due <= 0
          ? '<button class="btn btn-lg btn-go btn-block" id="pFree">' + C.esc(T('Muft diya — bill band karein')) + '</button>'
          : '<div class="grid g2 gap8">' +
              '<button class="btn btn-lg btn-go" id="pCash">\u{1F4B5} ' + C.esc(T('Cash')) + '</button>' +
              '<button class="btn btn-lg btn-primary" id="pUpi">\u{1F4F1} UPI</button>' +
              '<button class="btn btn-lg" id="pCard">\u{1F4B3} ' + C.esc(T('Card')) + '</button>' +
              '<button class="btn btn-lg btn-ghost" id="pDue">' + C.esc(T('Udhaar')) + '</button>' +
            '</div>') +

        '<div class="row gap8 mt20">' +
          '<button class="btn btn-ghost grow" id="pSlip">' + C.esc(T('Bill dekhein')) + '</button>' +
          '<button class="btn btn-danger" id="pCancel">' + C.esc(T('Bill cancel')) + '</button>' +
        '</div>';

      C.el('#sBack').onclick = function () { DR.go('cashier'); };
      C.els('[data-rm]').forEach(function (x) {
        x.onclick = function () { parts.splice(parseInt(x.dataset.rm, 10), 1); paint(); };
      });
      var free = C.el('#pFree');
      if (free) {
        free.onclick = function () { finish(); };
      } else {
        C.el('#pCash').onclick = function () { cashPad(); };
        C.el('#pUpi').onclick = function () { upiPad(); };
        C.el('#pCard').onclick = function () { addPart('card', left(), ''); };
        C.el('#pDue').onclick = function () { udhaarSheet(b, left(), addPart); };
      }
      C.el('#pSlip').onclick = function () { global.DRPrint.showBill(b); };
      C.el('#pCancel').onclick = function () { cancelSheet(b); };
    }

    function addPart(mode, amt, ref) {
      if (amt <= 0) {
        /* A Rs 0 bill — 100% discount, or every line marked MUFT — has nothing
           to collect but must still close, or it parks in "Paisa baaki" forever
           and the table can never be cleared. */
        if (left() <= 0) finish();
        return;
      }
      parts.push({ mode: mode, amountPaise: Math.min(amt, left()), ref: ref || '' });
      if (left() <= 0) finish();
      else paint();
    }

    function finish() {
      Ops.settle(b.id, parts);
      DR.go('cashier', { billId: b.id });
    }

    function cashPad() {
      var need = left();
      var buf = '';
      var html =
        '<div class="glass tint-cream card center" style="margin-bottom:14px">' +
          '<div class="t-xs dim">' + C.esc(T('Lena hai')) + '</div>' +
          '<div class="t-lg mono">' + C.money(need) + '</div>' +
          '<div class="t-xs dim mt8">' + C.esc(T('Diya')) + '</div>' +
          '<div class="t-lg mono" id="cpGot">' + C.money(need) + '</div>' +
          '<div class="t-sm mt8" id="cpChange"></div>' +
        '</div>' +
        '<div class="row gap6 wrap" style="margin-bottom:12px">' +
          [need, Math.ceil(need / 10000) * 10000, Math.ceil(need / 50000) * 50000, Math.ceil(need / 100000) * 100000]
            .filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; })
            .map(function (v) { return '<button class="btn btn-sm grow" data-quick="' + v + '">' + C.money(v, { decimals: 0 }) + '</button>'; }).join('') +
        '</div>' +
        '<div class="grid g3 gap8">' +
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map(function (k) {
            return '<button class="btn btn-lg" data-k="' + k + '">' + k + '</button>';
          }).join('') +
        '</div>' +
        '<button class="btn btn-go btn-lg btn-block mt14" id="cpOk">' + C.esc(T('Le liya ✓')) + '</button>';

      DR.sheet(T('Cash'), html, function (bb) {
        function got() { return buf === '' ? need : C.P(buf); }
        function paintPad() {
          bb.querySelector('#cpGot').textContent = C.money(got(), { decimals: 0 });
          var ch = got() - need;
          bb.querySelector('#cpChange').innerHTML = ch > 0
            ? C.esc(T('Wapas dijiye')) + ' <b class="mono">' + C.money(ch) + '</b>'
            : ch < 0 ? '<span style="color:var(--warn-ink)">' + C.esc(T('Baaki')) + ' <b class="mono">' + C.money(-ch) + '</b> ' + C.esc(T('— UPI/card se le lijiye')) + '</span>' : '';
        }
        C.els('[data-k]', bb).forEach(function (x) {
          x.onclick = function () {
            var k = x.dataset.k;
            if (k === '⌫') buf = buf.slice(0, -1);
            else buf = (buf + k).slice(0, 7);
            paintPad();
          };
        });
        C.els('[data-quick]', bb).forEach(function (x) {
          x.onclick = function () { buf = String(C.R(parseInt(x.dataset.quick, 10))); paintPad(); };
        });
        /* Accept LESS than the total — that is a part payment (cash now, UPI
           for the rest), which is completely normal at a counter and was
           previously impossible. Over-tender still records only what is due,
           and the change is shown above. */
        bb.querySelector('#cpOk').onclick = function () {
          var g = got();
          if (g <= 0) { DR.toast(T('Amount likhiye'), 'warn'); return; }
          DR.closeSheet();
          setTimeout(function () { addPart('cash', Math.min(g, need), ''); }, 100);
        };
        paintPad();
      });
    }

    /* UPI — the restaurant's own QR, zero MDR, no gateway.
       Because there is no gateway there is no callback, so a human confirms.
       We therefore capture the last 4 of the UTR: three seconds of typing,
       and a fake screenshot usually does not have one. */
    function upiPad() {
      var amt = left();
      var vpa = d.setup.upiVpa;
      var uri = 'upi://pay?pa=' + encodeURIComponent(vpa || '') +
        '&pn=' + encodeURIComponent(d.setup.outletName || 'Shop') +
        '&am=' + (amt / 100).toFixed(2) + '&cu=INR' +
        '&tn=' + encodeURIComponent('Bill ' + b.no);

      var qrBox = vpa
        ? (global.DRQR
            ? '<div id="upQr" class="center" style="background:#fff;padding:10px;border-radius:14px;display:inline-block"></div>'
            : '<div class="glass tint-cream card center"><div class="t-xs dim">UPI ID</div><div class="big mono">' + C.esc(vpa) + '</div></div>')
        : '<div class="glass tint-amber card"><b class="t-sm">' + C.esc(T('UPI ID set nahi hai')) + '</b><p class="t-xs dim mt8">' + C.esc(T('Settings mein daal dijiye — phir har bill ka apna QR banega.')) + '</p></div>';

      var html =
        '<div class="center" style="margin-bottom:12px">' + qrBox + '</div>' +
        '<div class="center t-lg mono" style="margin-bottom:14px">' + C.money(amt) + '</div>' +
        '<label class="lbl">' + C.esc(T('UTR ke aakhri 4 number (grahak ki screen par)')) + '</label>' +
        '<input class="field" id="upRef" type="tel" inputmode="numeric" maxlength="4" placeholder="' + C.esc(T('4 digit')) + '">' +
        '<p class="t-xs dimmer mt8">' + C.esc(T('Ye likhne se raat ko cash-UPI ka hisaab pakka milta hai.')) + '</p>' +
        '<button class="btn btn-go btn-lg btn-block mt14" id="upOk">' + C.esc(T('Paisa aa gaya ✓')) + '</button>';

      DR.sheet('UPI', html, function (bb) {
        if (vpa && global.DRQR) {
          try {
            var cv = global.DRQR.canvas(uri, 190);
            bb.querySelector('#upQr').appendChild(cv);
          } catch (e) {
            bb.querySelector('#upQr').innerHTML = '<div style="color:#000;font-family:monospace">' + C.esc(vpa) + '</div>';
          }
        }
        bb.querySelector('#upOk').onclick = function () {
          var ref = (bb.querySelector('#upRef').value || '').replace(/\D/g, '').slice(0, 4);
          DR.closeSheet();
          setTimeout(function () { addPart('upi', amt, ref); }, 100);
        };
      });
    }

    paint();
  }

  /* --------------------------------------------------------
     Paid — the moment the loop closes
     -------------------------------------------------------- */
  function paidScreen(root, b) {
    var change = (b.paidPaise || 0) - b.totals.grand;
    root.innerHTML =
      '<div class="glass tint-green card center pop" style="margin-bottom:14px;padding:26px 16px">' +
        '<div style="font-size:38px" aria-hidden="true">✓</div>' +
        '<h1 style="margin-top:6px">' + C.esc(T('Ho gaya')) + '</h1>' +
        '<div class="t-xl mono mt8">' + C.money(b.totals.grand, { decimals: 0 }) + '</div>' +
        '<div class="t-sm dim mt8">' + C.esc(b.no) + ' &middot; ' + C.esc(C.db().setup.lang === 'hi' ? C.DOC_TITLE[b.docType].hi : C.DOC_TITLE[b.docType].en) + '</div>' +
        (change > 0 ? '<div class="pill pill-amber mt14">' + C.esc(T('Wapas dijiye')) + ' ' + C.money(change) + '</div>' : '') +
      '</div>' +
      '<div class="grid g2 gap8">' +
        '<button class="btn btn-lg btn-primary" id="fPrint">\u{1F5A8} ' + C.esc(T('Bill')) + '</button>' +
        '<button class="btn btn-lg" id="fWa">\u{1F4AC} WhatsApp</button>' +
      '</div>' +
      '<button class="btn btn-lg btn-block mt14" id="fNext">' + C.esc(T('Agla order →')) + '</button>' +
      '<button class="btn btn-ghost btn-block mt8" id="fFix">' + C.esc(T('Bill theek karna hai?')) + '</button>';

    C.el('#fPrint').onclick = function () { global.DRPrint.showBill(b); };
    C.el('#fWa').onclick = function () { global.DRPrint.whatsapp(b); };
    C.el('#fNext').onclick = function () { DR.go('waiter'); };
    C.el('#fFix').onclick = function () { correctSheet(b); };
  }

  /* --------------------------------------------------------
     BILL BOOK + corrections
     -------------------------------------------------------- */
  function billBook() {
    var d = C.db();
    var list = d.bills.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 60);
    var html =
      '<input class="field" id="bbQ" placeholder="' + C.esc(T('Amount ya bill number')) + '" style="margin-bottom:12px">' +
      '<div id="bbList"></div>';

    DR.sheet(T('Bill book'), html, function (b) {
      function paint() {
        var q = (b.querySelector('#bbQ').value || '').trim().toLowerCase();
        var rows = list.filter(function (x) {
          if (!q) return true;
          return x.no.toLowerCase().indexOf(q) !== -1 ||
                 String(C.R(x.totals.grand).toFixed(0)).indexOf(q) !== -1;
        });
        b.querySelector('#bbList').innerHTML = rows.length
          ? '<div class="col gap6">' + rows.map(function (x) {
              return '<button class="btn" data-b="' + x.id + '" style="justify-content:space-between;height:auto;padding:10px 12px">' +
                '<span style="text-align:left"><b>' + C.esc(x.no) + '</b>' +
                '<br><span class="t-xs dim">' + C.hhmm(x.createdAt) +
                (x.tableLabel ? ' · ' + C.esc(T('Mez')) + ' ' + C.esc(x.tableLabel) : '') +
                ' · ' + C.esc(x.status === 'paid' ? T('paid') : x.status === 'cancelled' ? 'CANCELLED' : T('baaki')) + '</span></span>' +
                '<b class="mono">' + C.money(x.totals.grand, { decimals: 0 }) + '</b></button>';
            }).join('') + '</div>'
          : '<p class="dim center">' + C.esc(T('Kuch nahi mila')) + '</p>';
        C.els('[data-b]', b).forEach(function (btn) {
          btn.onclick = function () {
            var bill = Ops.billById(btn.dataset.b);
            DR.closeSheet();
            setTimeout(function () {
              if (bill.status === 'unpaid') DR.go('cashier', { billId: bill.id });
              else correctSheet(bill);
            }, 220);
          };
        });
      }
      b.querySelector('#bbQ').oninput = paint;
      paint();
    });
  }

  /* A bill is never edited. It is cancelled with a reason and a fresh one
     is issued with the disputed line struck off. Both survive. */
  function correctSheet(bill) {
    if (bill.status === 'cancelled') {
      global.DRPrint.showBill(bill);
      return;
    }
    /* Voided lines are already struck off and carry no money — never pre-tick
       them, and never show them, or a correction quietly re-bills them. */
    var keep = {};
    bill.lines.forEach(function (l) { if (!l.voided) keep[l.id] = true; });
    var liveLines = bill.lines.filter(function (l) { return !l.voided; });
    var paidNote = bill.status === 'paid'
      ? '<div class="glass tint-amber card" style="margin-bottom:12px"><b class="t-sm">' + C.esc(T('Ye bill paid hai — ')) +
        C.money(bill.paidPaise || bill.totals.grand) + ' ' + C.esc(T('liya ja chuka hai')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Naya bill banane par jitna zyada liya gaya hai wo wapas dena padega. App batayega kitna.')) + '</p></div>'
      : '';

    var html =
      paidNote +
      '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Jo item galat hai use hata dijiye. Purana bill cancel hoga aur naya bill turant banega — dono record mein rahenge.')) + '</p>' +
      '<div class="glass card" id="csLines" style="margin-bottom:12px"></div>' +
      '<label class="lbl">' + C.esc(T('Wajah')) + '</label>' +
      '<div class="col gap6" id="csR">' +
        C.VOID_REASONS.map(function (r) {
          return '<button class="btn btn-sm" data-r="' + r.id + '">' + C.esc(C.db().setup.lang === 'hi' ? r.hi : r.en) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="row gap8 mt14">' +
        '<button class="btn btn-danger grow" id="csCancelAll">' + C.esc(T('Poora bill cancel')) + '</button>' +
        '<button class="btn btn-primary grow" id="csFix">' + C.esc(T('Naya bill banao')) + '</button>' +
      '</div>';

    DR.sheet(T('Bill theek karo — ') + bill.no, html, function (b) {
      var reason = null;
      function paintLines() {
        b.querySelector('#csLines').innerHTML = liveLines.map(function (l) {
          return '<div class="row-b" style="padding:6px 0;border-top:1px solid var(--hair)">' +
            '<label class="row gap8 grow" style="min-width:0;cursor:pointer">' +
              '<input type="checkbox" data-k="' + l.id + '"' + (keep[l.id] ? ' checked' : '') + '>' +
              '<span class="truncate t-sm">' + C.qtyText(l.qtyMilli) + ' x ' + C.esc(l.name) + '</span>' +
            '</label>' +
            '<span class="mono t-sm">' + C.money(l.amountPaise, { decimals: 0 }) + '</span>' +
          '</div>';
        }).join('');
        C.els('[data-k]', b).forEach(function (x) {
          x.onchange = function () { keep[x.dataset.k] = x.checked; };
        });
      }
      paintLines();
      C.els('[data-r]', b).forEach(function (x) {
        x.onclick = function () {
          reason = x.dataset.r;
          C.els('[data-r]', b).forEach(function (y) { y.classList.toggle('btn-primary', y === x); });
        };
      });
      b.querySelector('#csCancelAll').onclick = function () {
        if (!reason) { DR.toast(T('Wajah chuniye'), 'warn'); return; }
        Ops.cancelBill(bill.id, reason);
        DR.closeSheet();
        DR.toast(T('Bill cancel ho gaya — record mein rahega'), 'warn', 3200);
        setTimeout(function () { DR.go('cashier'); }, 300);
      };
      b.querySelector('#csFix').onclick = function () {
        if (!reason) { DR.toast(T('Wajah chuniye'), 'warn'); return; }
        var keepIds = Object.keys(keep).filter(function (k) { return keep[k]; });
        if (!keepIds.length) { DR.toast(T('Poora cancel karna hai to doosra button'), 'warn'); return; }
        var r = Ops.correctBill(bill.id, keepIds, reason);
        DR.closeSheet();
        setTimeout(function () {
          if (r && r.refund > 0) {
            DR.toast(T('Grahak ko') + ' ' + C.money(r.refund) + ' ' + T('wapas dijiye'), 'warn', 6000);
          } else if (r && r.extraDue > 0) {
            DR.toast(T('Grahak se') + ' ' + C.money(r.extraDue) + ' ' + T('aur lena hai'), 'warn', 6000);
          }
          if (r && r.fresh) DR.go('cashier', { billId: r.fresh.id });
          else DR.go('cashier');
        }, 260);
      };
    });
  }

  function cancelSheet(bill) {
    var html = '<div class="col gap8">' + C.VOID_REASONS.map(function (r) {
      return '<button class="btn" data-r="' + r.id + '">' + C.esc(C.db().setup.lang === 'hi' ? r.hi : r.en) + '</button>';
    }).join('') + '</div>';
    DR.sheet(T('Bill cancel — wajah?'), html, function (b) {
      C.els('[data-r]', b).forEach(function (x) {
        x.onclick = function () {
          Ops.cancelBill(bill.id, x.dataset.r);
          DR.closeSheet();
          DR.toast(T('Cancel ho gaya — malik ko dikhega'), 'warn', 3000);
          setTimeout(function () { DR.go('cashier'); }, 260);
        };
      });
    });
  }

  /* --------------------------------------------------------
     SEEDHA BILL — no order, no table, no KOT
     -------------------------------------------------------- */
  function seedhaBill(root) {
    if (!draft) draft = { lines: [], q: '', catId: null };

    function paint() {
      var t = Ops.computeTotals(draft.lines, {});
      root.innerHTML =
        '<div class="row gap8" style="margin-bottom:10px">' +
          '<button class="btn btn-sm btn-ghost" id="sdBack">&#8592;</button>' +
          '<h1 style="font-size:22px">' + C.esc(T('Seedha bill')) + '</h1>' +
        '</div>' +
        '<p class="t-xs dim" style="margin-bottom:10px">' + C.esc(T('Bina order ke bill — walk-in, phone order, ya jo parche par likha tha.')) + '</p>' +

        (draft.lines.length
          ? '<div class="glass card" style="margin-bottom:10px;padding:8px 12px">' + draft.lines.map(function (l, i) {
              return '<div class="row-b" style="padding:5px 0;border-top:1px solid var(--hair)">' +
                '<span class="t-sm truncate grow">' + C.qtyText(l.qtyMilli) + ' x ' + C.esc(l.name) + '</span>' +
                '<span class="row gap6"><span class="mono t-sm">' + C.money(Ops.linePaise(l), { decimals: 0 }) + '</span>' +
                '<button class="btn btn-sm btn-ghost" data-x="' + i + '" style="min-height:26px;padding:0 8px">&#10005;</button></span>' +
              '</div>';
            }).join('') + '</div>'
          : '<div class="glass card center dim t-sm" style="margin-bottom:10px">' + C.esc(T('Item chuniye')) + '</div>') +

        '<input class="field" id="sdQ" placeholder="' + C.esc(T('Item dhoondhiye')) + '" style="margin-bottom:10px">' +
        '<div id="sdGrid"></div>' +

        '<div style="height:150px"></div>' +
        '<div style="position:fixed;left:10px;right:10px;bottom:calc(72px + var(--safe-b));z-index:45">' +
          '<div class="glass glass-raised" style="padding:8px;border-radius:20px">' +
            '<div class="row gap8">' +
              '<div class="grow" style="padding-left:8px">' +
                '<div class="t-xs dimmer">' + draft.lines.length + ' ' + C.esc(T('item')) + '</div>' +
                '<div class="mono" style="font-size:20px;font-weight:700">' + C.money(t.grand, { decimals: 0 }) + '</div>' +
              '</div>' +
              '<button class="btn btn-go btn-lg" id="sdIssue" style="min-width:140px"' +
                (draft.lines.length ? '' : ' disabled') + '>' + C.esc(T('Bill banao →')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      C.el('#sdBack').onclick = function () { draft = null; DR.go('cashier'); };
      var q = C.el('#sdQ');
      q.value = draft.q;
      q.oninput = function () { draft.q = q.value; paintGrid(); };
      C.els('[data-x]').forEach(function (x) {
        x.onclick = function () { draft.lines.splice(parseInt(x.dataset.x, 10), 1); paint(); };
      });
      C.el('#sdIssue').onclick = function () {
        var bill;
        try { bill = Ops.directBill(draft.lines, {}); }
        catch (e) { DR.toast(e.message, 'bad', 4000); return; }
        draft = null;
        DR.go('cashier', { billId: bill.id });
      };
      paintGrid();
    }

    function paintGrid() {
      var qq = (draft.q || '').toLowerCase().trim();
      var list = Ops.itemsForGrid(null);
      if (qq) list = list.filter(function (i) { return i.name.toLowerCase().indexOf(qq) !== -1; });
      list = list.slice(0, 40);
      C.el('#sdGrid').innerHTML = '<div class="grid g-auto">' + list.map(function (i) {
        return '<button class="glass sdTile" data-i="' + i.id + '" ' +
          'style="padding:10px 8px;min-height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:16px;color:inherit;font:inherit;cursor:pointer;text-align:center">' +
          '<span style="font-size:20px" aria-hidden="true">' + i.icon + '</span>' +
          '<span class="t-xs" style="font-weight:600;line-height:1.15">' + C.esc(i.name) + '</span>' +
          '<span class="t-xs mono dim">' + C.money(i.pricePaise, { decimals: 0 }) + '</span></button>';
      }).join('') + '</div>';

      C.els('.sdTile').forEach(function (b) {
        b.onclick = function () {
          var it = Ops.itemById(b.dataset.i);
          if (!it) return;
          if (it.uom === 'kg' || it.uom === 'g') {
            var v = prompt(T('Kitna') + ' ' + it.uom + '?', '1');
            if (v === null) return;
            var n = parseFloat(v);
            if (!n || n <= 0) return;
            draft.lines.push(mkLine(it, C.qty(n)));
          } else {
            var same = draft.lines.filter(function (l) { return l.itemId === it.id && l.variant === 'full'; })[0];
            if (same) same.qtyMilli += 1000;
            else draft.lines.push(mkLine(it, 1000));
          }
          paint();
        };
      });
    }

    function mkLine(it, qtyMilli) {
      return {
        id: C.uid('L'), itemId: it.id, name: it.name, icon: it.icon,
        variant: 'full', unitPaise: it.pricePaise, qtyMilli: qtyMilli, uom: it.uom,
        mods: [], note: '', lineType: 'SALE', taxTreatment: it.taxTreatment,
        isLiquor: !!it.isLiquor, fired: false, kotId: null, addedAt: C.now()
      };
    }

    paint();
  }

  /* --------------------------------------------------------
     Cash drawer
     -------------------------------------------------------- */
  function cashSheet() {
    var html =
      '<label class="lbl">' + C.esc(T('Kitna')) + '?</label>' +
      '<input class="field" id="cmAmt" type="number" inputmode="decimal" placeholder="0">' +
      '<label class="lbl mt14">' + C.esc(T('Kis liye?')) + '</label>' +
      '<div class="col gap6" id="cmR">' +
        C.CASH_REASONS.map(function (r) {
          return '<button class="btn btn-sm" data-r="' + r.id + '" style="justify-content:space-between">' +
            '<span>' + C.esc(C.db().setup.lang === 'hi' ? r.hi : r.en) + '</span>' +
            '<span class="t-xs dim">' + C.esc(r.dir === 'in' ? T('andar') : T('bahar')) + '</span></button>';
        }).join('') +
      '</div>' +
      '<label class="lbl mt14">' + C.esc(T('Kuch aur likhna hai?')) + '</label>' +
      '<input class="field" id="cmNote" placeholder="' + C.esc(T('jaise: dahi ke liye')) + '">' +
      '<button class="btn btn-primary btn-block mt14" id="cmSave">' + C.esc(T('Likho')) + '</button>';

    DR.sheet(T('Cash andar/bahar'), html, function (b) {
      var reason = null;
      C.els('[data-r]', b).forEach(function (x) {
        x.onclick = function () {
          reason = x.dataset.r;
          C.els('[data-r]', b).forEach(function (y) { y.classList.toggle('btn-primary', y === x); });
        };
      });
      b.querySelector('#cmSave').onclick = function () {
        var amt = C.P(b.querySelector('#cmAmt').value);
        if (!amt || !reason) { DR.toast(T('Amount aur wajah dono chahiye'), 'warn'); return; }
        Ops.addCash(reason, amt, b.querySelector('#cmNote').value.trim());
        DR.closeSheet();
        DR.toast(T('Likh liya — raat ke hisaab mein aa jaayega'), 'good');
      };
    });
  }

  /* --------------------------------------------------------
     Day close
     -------------------------------------------------------- */
  function dayCloseSheet() {
    var st = Ops.dayStats();
    var buf = '';
    var html =
      '<div class="glass card" style="margin-bottom:12px">' +
        '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Bikri')) + '</span><span class="mono">' + C.money(st.sales) + '</span></div>' +
        '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Bill')) + '</span><span class="mono">' + st.bills + '</span></div>' +
        '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Cash')) + '</span><span class="mono">' + C.money(st.byMode.cash || 0) + '</span></div>' +
        '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">UPI</span><span class="mono">' + C.money(st.byMode.upi || 0) + '</span></div>' +
        (st.byMode.card ? '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Card')) + '</span><span class="mono">' + C.money(st.byMode.card) + '</span></div>' : '') +
        (st.cashIn ? '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Cash daala')) + '</span><span class="mono">+' + C.money(st.cashIn) + '</span></div>' : '') +
        (st.cashOut ? '<div class="row-b t-sm" style="padding:3px 0"><span class="dim">' + C.esc(T('Cash nikala')) + '</span><span class="mono">-' + C.money(st.cashOut) + '</span></div>' : '') +
        '<div class="row-b" style="padding-top:8px;margin-top:6px;border-top:1px solid var(--hair-strong)">' +
          '<b>' + C.esc(T('Golak mein hona chahiye')) + '</b><b class="mono">' + C.money(st.expectedCash) + '</b></div>' +
      '</div>' +
      '<label class="lbl">' + C.esc(T('Ginti ke baad kitna nikla?')) + '</label>' +
      '<input class="field" id="dcAmt" type="number" inputmode="decimal" placeholder="0">' +
      '<div id="dcVar" class="mt14"></div>' +
      '<button class="btn btn-warn btn-lg btn-block mt14" id="dcOk">' + C.esc(T('Din band karo')) + '</button>';

    DR.sheet(T('Din band'), html, function (b) {
      var inp = b.querySelector('#dcAmt');
      inp.oninput = function () {
        var v = C.P(inp.value);
        var diff = v - st.expectedCash;
        b.querySelector('#dcVar').innerHTML = !inp.value ? '' :
          '<div class="glass ' + (Math.abs(diff) < 500 ? 'tint-green' : 'tint-amber') + ' card">' +
            '<div class="row-b"><span>' + C.esc(diff === 0 ? T('Bilkul sahi') : diff > 0 ? T('Zyada nikla') : T('Kam nikla')) + '</span>' +
            '<b class="mono">' + C.money(Math.abs(diff)) + '</b></div>' +
            (Math.abs(diff) >= 500 ? '<p class="t-xs dim mt8">' + C.esc(T('Cash nikala/daala likha tha? Wo yahan jud jaata hai.')) + '</p>' : '') +
          '</div>';
      };
      b.querySelector('#dcOk').onclick = function () {
        var raw = (inp.value || '').trim();
        if (!raw) { DR.toast(T('Pehle ginti ka amount likhiye'), 'warn'); inp.focus(); return; }
        var v = C.P(raw);
        var prev = C.db().session.closed[Ops.businessDay()];
        function doClose() {
          Ops.closeDay(v);
          DR.closeSheet();
          /* Day close = automatic backup. The whole business lives on this
             phone; a nightly file in Downloads is the cheapest insurance
             there is. The owner WhatsApps it to himself. */
          DR.toast(T('Din band. Raat ka hisaab Malik screen par hai.'), 'good', 3200);
          C.download('dhandho-backup-' + C.dayKey() + '.json', JSON.stringify(C.db(), null, 1), 'application/json')
            .then(function (ok) {
              if (!ok) {
                /* Never announce a backup that did not happen. On a phone that
                   cannot write files the cloud copy is the real safety net,
                   so say that instead of a comforting lie. */
                DR.toast(T('Backup file nahi ban payi — App ki jaanch mein Cloud dekh lijiye'), 'bad', 6000);
                return;
              }
              C.db().session.lastBackupAt = C.now();
              C.save(true);
              DR.toast(T('Raat ka backup download ho gaya — WhatsApp par apne aap ko bhej dijiye'), 'warn', 5600);
            });
          setTimeout(function () { DR.go('owner'); }, 400);
        }
        if (prev) {
          DR.closeSheet();
          setTimeout(function () {
            DR.confirm(T('Din pehle hi band ho chuka hai'),
              T('Pichhli ginti') + ' ' + C.money(prev.countedCash) + T('thi. Dobara band karein?'),
              T('Haan, dobara'), doClose);
          }, 260);
          return;
        }
        doClose();
      };
    });
  }

  /* --------------------------------------------------------
     UDHAAR — ask WHO before writing it down.

     This button used to say "khaate mein chadh jaayega" (it will go on the
     account) and then record a payment of mode 'due' against nobody. There was
     no account. The bill closed, the table cleared, the money was neither in
     the drawer nor owed by anyone nameable, and the only trace was a colour in
     one bar on the owner's screen. A shopkeeper cannot collect from that.

     So the name is now the price of using the button. Phone is optional but
     asked for, because it is the only thing that reliably identifies the same
     regular next week — three khatas for one person is how a balance goes
     missing.
     -------------------------------------------------------- */
  function udhaarSheet(bill, amount, addPart) {
    var recent = recentUdhaarNames();

    DR.sheet(T('Udhaar kiske naam?'),
      '<div class="glass tint-amber card" style="margin-bottom:12px">' +
        '<div class="row-b"><span class="t-sm">' + C.esc(T('Khaate mein jaayega')) + '</span>' +
        '<b class="mono t-lg">' + C.money(amount) + '</b></div>' +
      '</div>' +
      '<label class="lbl">' + C.esc(T('Naam')) + '</label>' +
      '<input class="field" id="udName" autocomplete="off" placeholder="' + C.esc(T('jaise Sharma ji')) + '">' +
      (recent.length
        ? '<div class="row gap8 wrap mt8">' + recent.map(function (n) {
            return '<button class="btn btn-sm btn-ghost" data-ud="' + C.esc(n) + '">' + C.esc(n) + '</button>';
          }).join('') + '</div>'
        : '') +
      '<div class="mt14"><label class="lbl">' + C.esc(T('Phone (marzi se)')) + '</label>' +
        '<input class="field" id="udPhone" type="tel" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="98xxxxxxxx"></div>' +
      '<p class="t-xs dim mt8">' + C.esc(T('Phone daal dijiye to agli baar wahi khaata khulega — naam ek jaisa hone par bhi.')) + '</p>' +
      '<button class="btn btn-primary mt20" id="udGo" style="width:100%">' + C.esc(T('Udhaar likh dijiye')) + '</button>',
      function (bx) {
        C.els('[data-ud]', bx).forEach(function (btn) {
          btn.onclick = function () { bx.querySelector('#udName').value = btn.dataset.ud; };
        });
        bx.querySelector('#udGo').onclick = function () {
          var name = (bx.querySelector('#udName').value || '').trim();
          var phone = (bx.querySelector('#udPhone').value || '').replace(/\D/g, '');
          if (!name) {
            DR.toast(T('Naam likhiye — bina naam ka udhaar wapas nahi aata'), 'warn', 3600);
            return;
          }
          /* Stored on the BILL, so it survives on the record and reaches the
             khata through the bridge. */
          bill.customer = { name: name, phone: phone || null };
          C.logEvent('UDHAAR_NAMED', { billId: bill.id, name: name, amount: amount });
          C.save(true);
          DR.closeSheet();
          setTimeout(function () { addPart('due', amount, name); }, 80);
        };
      });
  }

  /* Names this shop has given udhaar to recently — one tap instead of retyping
     a regular's name every week. */
  function recentUdhaarNames() {
    var seen = {}, out = [];
    var bills = (C.db().bills || []);
    for (var i = bills.length - 1; i >= 0 && out.length < 6; i--) {
      var c = bills[i].customer;
      if (c && c.name && !seen[c.name]) { seen[c.name] = 1; out.push(c.name); }
    }
    return out;
  }

  DR.register('cashier', cashierView);
  global.DRCashier = { correctSheet: correctSheet, billBook: billBook, dayCloseSheet: dayCloseSheet };
})(window);
