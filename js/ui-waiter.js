/* ============================================================
   WAITER SURFACE  —  the 10-second loop
   Target: table -> 3 items -> 1 modifier -> SEND in 6-7 taps.
   No scrolling on the home screen. No modal. No confirm dialog.
   No spinner. Zero settings anywhere on this surface.

   The acceptance test is not "is it fast for us". It is:
   a stranger takes a correct 4-item order in under 3 minutes,
   unaided, with nobody standing next to them.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, D = global.DRData, DR = global.DR;
  var T = global.T;

  var activeSection = null;

  /* --------------------------------------------------------
     MEZ — the home screen
     -------------------------------------------------------- */
  function waiterView(root) {
    var d = C.db();
    if (!d.setup.done) { DR.go('setup'); return; }

    var tables = d.tables;
    var sections = [];
    tables.forEach(function (t) { if (sections.indexOf(t.section) === -1) sections.push(t.section); });
    if (!activeSection || sections.indexOf(activeSection) === -1) activeSection = sections[0] || null;

    root.innerHTML =
      (sections.length > 1
        ? '<div class="row gap6 wrap" id="secChips" style="margin-bottom:12px">' +
          sections.map(function (s) {
            /* Show how many tables are running in each section, so a waiter
               never has to hunt through sections to find his own table. */
            var busy = tables.filter(function (t) {
              return t.section === s && Ops.orderForTable(t.id);
            }).length;
            return '<button class="btn btn-sm ' + (s === activeSection ? 'btn-primary' : '') + '" data-sec="' + C.esc(s) + '">' +
              C.esc(s) +
              (busy ? ' <span class="pill pill-green" style="padding:0 6px;font-size:10px;margin-left:4px">' + busy + '</span>' : '') +
              '</button>';
          }).join('') + '</div>'
        : '') +
      '<div id="mezGrid"></div>' +
      '<div class="mt14" id="mezExtras"></div>';

    if (sections.length > 1) {
      C.els('#secChips button').forEach(function (b) {
        /* Go through the router, which clears the old repaint interval first.
           Re-entering waiterView() directly stacks a new 4-second interval on
           every chip tap, and the grid ends up rebuilding under the finger. */
        b.onclick = function () { activeSection = b.dataset.sec; DR.go('waiter'); };
      });
    }

    paintMez();
    DR.every(4000, paintMez);

    function paintMez() {
      var dd = C.db();
      var grid = C.el('#mezGrid');
      if (!grid) return;

      var show = dd.tables.filter(function (t) { return !activeSection || t.section === activeSection; });
      var cells = show.map(function (t) {
        var o = Ops.orderForTable(t.id);
        var total = 0, mins = 0, kotPending = false;
        if (o) {
          total = Ops.computeTotals(o.lines, {}).grand;
          mins = Math.floor((Date.now() - o.createdAt) / 60000);
          kotPending = dd.kots.some(function (k) { return k.orderId === o.id && k.status === 'new'; });
        }
        var tint = !o ? '' : (kotPending ? 'tint-amber' : 'tint-green');
        return '<button class="glass ' + tint + ' tblTile" data-t="' + t.id + '" ' +
          'style="padding:8px 4px;min-height:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:16px;cursor:pointer;color:inherit;font:inherit">' +
          '<span style="font-size:19px;font-weight:700;line-height:1">' + C.esc(t.label) + '</span>' +
          (o
            ? '<span class="t-xs mono" style="font-weight:640">' + C.money(total, { decimals: 0 }) + '</span>' +
              '<span class="t-xs dimmer">' + mins + 'm</span>'
            : '<span class="t-xs dimmer">' + C.esc(T('khali')) + '</span>') +
          '</button>';
      }).join('');

      grid.innerHTML = '<div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:7px">' + cells + '</div>';
      C.els('.tblTile', grid).forEach(function (b) {
        b.onclick = function () { openTable(b.dataset.t); };
      });

      /* Parcel + online orders live in the same home screen as their own
         tiles with a token. A parcel that vanishes from the home screen is
         a parcel that never gets billed. */
      var loose = Ops.openOrders().filter(function (o) { return !o.tableId; });
      var ex = C.el('#mezExtras');
      ex.innerHTML =
        '<div class="row gap8 wrap" style="margin-bottom:10px">' +
          '<button class="btn btn-go grow" id="wNewParcel">\u{1F4E6} ' + C.esc(T('Parcel')) + '</button>' +
          '<button class="btn grow" id="wNewOnline">\u{1F6F5} ' + C.esc(T('Online order')) + '</button>' +
          '<button class="btn btn-ghost" id="wSeedha">\u{1F9FE} ' + C.esc(T('Seedha bill')) + '</button>' +
        '</div>' +
        (loose.length
          ? '<div class="grid g2 gap8">' + loose.map(function (o) {
              var tot = Ops.computeTotals(o.lines, {}).grand;
              return '<button class="glass tint-blue looseTile" data-o="' + o.id + '" ' +
                'style="padding:10px 12px;border-radius:16px;text-align:left;color:inherit;font:inherit;cursor:pointer">' +
                '<div class="row-b"><b>' + C.esc(o.token || 'Order') + '</b>' +
                '<span class="t-xs mono">' + C.money(tot, { decimals: 0 }) + '</span></div>' +
                '<div class="t-xs dimmer">' + (o.platform ? C.esc(o.platform) : C.esc(o.type)) + ' &middot; ' + C.ago(o.createdAt) + '</div>' +
                '</button>';
            }).join('') + '</div>'
          : '');

      C.el('#wNewParcel').onclick = function () {
        var o = Ops.createOrder({ type: 'parcel' });
        openOrder(o.id);
      };
      C.el('#wNewOnline').onclick = quickOnline;
      C.el('#wSeedha').onclick = function () { DR.go('cashier', { seedha: true }); };
      C.els('.looseTile', ex).forEach(function (b) {
        b.onclick = function () { openOrder(b.dataset.o); };
      });
    }
  }

  function openTable(tableId) {
    var o = Ops.orderForTable(tableId);
    if (!o) o = Ops.createOrder({ type: 'dine', tableId: tableId });
    openOrder(o.id);
  }

  /* --------------------------------------------------------
     Online order — 4 taps, no item re-punching.
     Reconciliation needs platform, order id and amount. It does not
     need to know he sold two paneer butter masalas.
     -------------------------------------------------------- */
  function quickOnline() {
    var d = C.db();
    var html =
      '<div class="row gap8" id="qoPlat" style="margin-bottom:14px">' +
        [['swiggy', 'Swiggy'], ['zomato', 'Zomato'], ['other', T('Aur')]].map(function (p, i) {
          return '<button class="btn grow ' + (i === 0 ? 'btn-primary' : '') + '" data-p="' + p[0] + '">' + C.esc(p[1]) + '</button>';
        }).join('') +
      '</div>' +
      '<label class="lbl">' + C.esc(T('Order ID (app par jo dikh raha hai)')) + '</label>' +
      '<input class="field" id="qoRef" placeholder="12345678" autocomplete="off">' +
      '<label class="lbl mt14">' + C.esc(T('Order ka total')) + '</label>' +
      '<input class="field" id="qoAmt" type="number" inputmode="decimal" placeholder="0">' +
      '<div id="qoCalc" class="mt14"></div>' +
      '<button class="btn btn-primary btn-lg btn-block mt14" id="qoSave">' + C.esc(T('Save')) + '</button>';

    DR.sheet(T('Online order'), html, function (b) {
      var plat = 'swiggy';
      C.els('[data-p]', b).forEach(function (btn) {
        btn.onclick = function () {
          plat = btn.dataset.p;
          C.els('[data-p]', b).forEach(function (x) { x.classList.toggle('btn-primary', x === btn); });
          calc();
        };
      });
      function calc() {
        var amt = C.P(b.querySelector('#qoAmt').value);
        var out = b.querySelector('#qoCalc');
        if (!amt) { out.innerHTML = ''; return; }
        var s = C.aggSettlement(amt, C.db().agg[plat] || C.db().agg.other);
        out.innerHTML =
          '<div class="glass tint-amber card">' +
            '<div class="row-b"><span class="t-sm">' + (plat === 'swiggy' ? 'Swiggy' : plat === 'zomato' ? 'Zomato' : 'Platform') + ' ' + C.esc(T('ne dikhaya')) + '</span>' +
            '<b class="mono">' + C.money(amt) + '</b></div>' +
            '<div class="row-b t-xs dim mt8"><span>' + C.esc(T('Commission + GST + gateway + TDS')) + '</span><span class="mono">-' + C.money(amt - s.net) + '</span></div>' +
            '<div class="row-b mt8" style="padding-top:8px;border-top:1px solid var(--hair-strong)">' +
            '<span class="t-sm"><b>' + C.esc(T('Aapke bank mein aayega')) + '</b></span>' +
            '<b class="mono" style="font-size:18px">' + C.money(s.net) + '</b></div>' +
            '<p class="t-xs dimmer mt8">' + C.esc(T('Is order par GST platform bharta hai (s.9(5)) — aap dobara mat bhariye.')) + '</p>' +
          '</div>';
      }
      b.querySelector('#qoAmt').oninput = calc;
      b.querySelector('#qoSave').onclick = function () {
        var ref = b.querySelector('#qoRef').value.trim();
        var amt = C.P(b.querySelector('#qoAmt').value);
        if (!amt) { DR.toast(T('Total likhiye'), 'warn'); return; }
        Ops.quickAggOrder(plat, ref, amt);
        DR.closeSheet();
        DR.toast(T('Online order save ho gaya'), 'good');
        DR.go('waiter');
      };
    });
  }

  /* --------------------------------------------------------
     ORDER — the loop screen. This layout is frozen at launch.
     Button positions here are a contract with the waiter.
     -------------------------------------------------------- */
  var orderState = { orderId: null, catId: null, q: '', lastLineId: null };

  function openOrder(orderId) {
    orderState.orderId = orderId;
    orderState.catId = null;
    orderState.q = '';
    orderState.lastLineId = null;
    DR.go('order', orderId);
  }

  function orderView(root, orderId) {
    orderId = orderId || orderState.orderId;
    var o = Ops.orderById(orderId);
    if (!o || o.status !== 'open') { DR.go('waiter'); return; }
    orderState.orderId = orderId;

    var d = C.db();
    var tbl = d.tables.filter(function (t) { return t.id === o.tableId; })[0];
    var title = tbl ? ('Mez ' + tbl.label) : (o.token || 'Order');
    var cats = Ops.categories();

    root.innerHTML =
      '<div class="row-b" style="margin-bottom:10px">' +
        '<div class="row gap8">' +
          '<button class="btn btn-sm btn-ghost" id="oBack" aria-label="Back">&#8592;</button>' +
          '<h1 style="font-size:22px">' + C.esc(title) + '</h1>' +
        '</div>' +
        '<button class="btn btn-sm btn-ghost" id="oMore" aria-label="More">&#8942;</button>' +
      '</div>' +

      '<div id="oLines"></div>' +

      '<div class="chiprow" id="oMods" style="margin:10px 0;align-items:center"></div>' +

      '<div class="row gap6" style="margin-bottom:10px">' +
        '<input class="field grow" id="oSearch" placeholder="' + C.esc(T('Item dhoondhiye')) + '" autocomplete="off" style="min-height:42px">' +
        '<button class="btn btn-sm" id="oVoice" title="Bol kar dhoondhiye" aria-label="Voice search">\u{1F3A4}</button>' +
      '</div>' +

      '<div class="chiprow" id="oCats" style="margin-bottom:10px"></div>' +
      '<div id="oGrid"></div>' +

      '<div style="height:150px"></div>' +
      '<div id="oBar" style="position:fixed;left:10px;right:10px;bottom:calc(72px + var(--safe-b));z-index:45"></div>';

    C.el('#oBack').onclick = function () { DR.go('waiter'); };
    C.el('#oMore').onclick = function () { orderMenu(o); };

    /* U1 — the search box must never be rebuilt while a thumb is typing.
       Typing repaints ONLY the grid. */
    var search = C.el('#oSearch');
    search.value = orderState.q;
    search.oninput = function () { orderState.q = search.value; paintGrid(); };

    C.el('#oVoice').onclick = voiceSearch;

    paintCats();
    paintGrid();
    paintLines();
    paintMods();
    paintBar();

    function paintCats() {
      C.el('#oCats').innerHTML =
        '<button class="btn btn-sm ' + (!orderState.catId ? 'btn-primary' : '') + '" data-c="">' + C.esc(T('Sab')) + '</button>' +
        cats.map(function (c) {
          return '<button class="btn btn-sm ' + (orderState.catId === c.id ? 'btn-primary' : '') + '" data-c="' + c.id + '">' + C.esc(c.name) + '</button>';
        }).join('');
      C.els('#oCats button').forEach(function (b) {
        b.onclick = function () {
          orderState.catId = b.dataset.c || null;
          paintCats(); paintGrid();
        };
      });
    }

    function paintGrid() {
      var q = (orderState.q || '').toLowerCase().trim();
      var list = Ops.itemsForGrid(orderState.catId);
      if (q) list = Ops.itemsForGrid(null).filter(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; });
      list = list.slice(0, 60);

      C.el('#oGrid').innerHTML = list.length
        ? '<div class="grid g-auto">' + list.map(function (i) {
            var off = !i.available;
            return '<button class="glass itemTile' + (off ? ' tint-red' : '') + '" data-i="' + i.id + '" ' +
              (off ? 'disabled ' : '') +
              'style="padding:10px 8px;min-height:88px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:16px;color:inherit;font:inherit;cursor:pointer;text-align:center">' +
              '<span style="font-size:22px;line-height:1" aria-hidden="true">' + i.icon + '</span>' +
              '<span class="t-xs" style="font-weight:600;line-height:1.15">' + C.esc(i.name) + '</span>' +
              '<span class="t-xs mono dim">' + (off ? C.esc(T('khatam')) : C.money(i.pricePaise, { decimals: 0 })) +
              (i.uom !== 'plate' ? '/' + i.uom : '') + '</span>' +
              '</button>';
          }).join('') + '</div>'
        : '<p class="dim center" style="padding:24px 0">' + C.esc(T('Kuch nahi mila')) + '</p>';

      C.els('.itemTile').forEach(function (b) {
        var it = Ops.itemById(b.dataset.i);
        b.onclick = function () { quickAdd(it); };
        var press;
        var long = function (e) { if (e && e.preventDefault) e.preventDefault(); itemOptions(it); };
        b.oncontextmenu = long;
        b.ontouchstart = function () { press = setTimeout(function () { long(); }, 500); };
        b.ontouchend = function () { clearTimeout(press); };
        b.ontouchmove = function () { clearTimeout(press); };
      });
    }

    function quickAdd(it) {
      if (!it.available) { DR.toast(it.name + ' ' + T('khatam hai'), 'warn'); return; }
      if (it.uom === 'kg' || it.uom === 'g') { weightPad(it); return; }
      var l = Ops.addLine(orderId, it.id, {});
      if (l) orderState.lastLineId = l.id;
      paintLines(); paintBar(); paintMods();
    }

    function itemOptions(it) {
      var half = it.halfPaise > 0;
      var html =
        '<div class="row gap8" style="margin-bottom:14px">' +
          (half ? '<button class="btn btn-lg grow" data-v="half">' + C.esc(T('Half')) + ' &middot; ' + C.money(it.halfPaise, { decimals: 0 }) + '</button>' : '') +
          '<button class="btn btn-lg btn-primary grow" data-v="full">' + C.esc(T('Full')) + ' &middot; ' + C.money(it.pricePaise, { decimals: 0 }) + '</button>' +
        '</div>' +
        '<label class="lbl">' + C.esc(T('Kitne?')) + '</label>' +
        '<div class="row gap8" style="margin-bottom:14px">' +
          [1, 2, 3, 4, 5, 6].map(function (n) {
            return '<button class="btn grow" data-q="' + n + '">' + n + '</button>';
          }).join('') +
        '</div>' +
        '<label class="lbl">' + C.esc(T('Kaise?')) + '</label>' +
        '<div class="row gap6 wrap" id="ioMods" style="margin-bottom:14px">' +
          D.MODS.map(function (m) {
            return '<button class="btn btn-sm" data-m="' + m.id + '">' + C.esc(modLabel(m)) + '</button>';
          }).join('') +
        '</div>' +
        '<label class="lbl">' + C.esc(T('Kuch aur likhna hai?')) + '</label>' +
        '<input class="field" id="ioNote" placeholder="' + C.esc(T('jaise: gravy alag')) + '">' +
        '<div class="row gap8 mt14">' +
          '<button class="btn btn-ghost grow" data-t="COMPLIMENTARY">' + C.esc(T('Muft')) + '</button>' +
          '<button class="btn btn-ghost grow" data-t="STAFF_MEAL">' + C.esc(T('Staff')) + '</button>' +
          '<button class="btn btn-go grow" style="flex:2" id="ioAdd">' + C.esc(T('Jodo')) + '</button>' +
        '</div>';

      DR.sheet(it.name, html, function (b) {
        var variant = 'full', qtyN = 1, mods = [], lineType = 'SALE';
        C.els('[data-v]', b).forEach(function (x) {
          x.onclick = function () {
            variant = x.dataset.v;
            C.els('[data-v]', b).forEach(function (y) { y.classList.toggle('btn-primary', y === x); });
          };
        });
        C.els('[data-q]', b).forEach(function (x) {
          x.onclick = function () {
            qtyN = parseInt(x.dataset.q, 10);
            C.els('[data-q]', b).forEach(function (y) { y.classList.toggle('btn-primary', y === x); });
          };
        });
        C.els('[data-m]', b).forEach(function (x) {
          x.onclick = function () {
            var id = x.dataset.m, i = mods.indexOf(id);
            if (i === -1) mods.push(id); else mods.splice(i, 1);
            x.classList.toggle('btn-go', mods.indexOf(id) !== -1);
          };
        });
        C.els('[data-t]', b).forEach(function (x) {
          x.onclick = function () {
            lineType = x.dataset.t;
            C.els('[data-t]', b).forEach(function (y) { y.classList.toggle('btn-warn', y === x); });
          };
        });
        b.querySelector('#ioAdd').onclick = function () {
          var l = Ops.addLine(orderId, it.id, {
            variant: variant, qtyMilli: qtyN * 1000, mods: mods,
            note: b.querySelector('#ioNote').value.trim(), lineType: lineType
          });
          if (l) orderState.lastLineId = l.id;
          DR.closeSheet();
          paintLines(); paintBar(); paintMods();
        };
      });
    }

    /* Weight counter — mithai, namkeen, bakery. Decimal kilos, exact math. */
    function weightPad(it) {
      var buf = '';
      var html =
        '<div class="glass tint-cream card center" style="margin-bottom:14px">' +
          '<div class="t-xs dim">' + C.money(it.pricePaise) + ' per ' + it.uom + '</div>' +
          '<div class="t-xl mono" id="wpQty">0</div>' +
          '<div class="t-xs dim">' + it.uom + '</div>' +
          '<div class="t-lg mono mt8" id="wpAmt">' + C.money(0) + '</div>' +
        '</div>' +
        '<div class="grid g3 gap8" id="wpKeys">' +
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(function (k) {
            return '<button class="btn btn-lg" data-k="' + k + '">' + k + '</button>';
          }).join('') +
        '</div>' +
        '<div class="row gap6 wrap mt14">' +
          ['0.25', '0.5', '1', '2'].map(function (q) {
            return '<button class="btn btn-sm grow" data-quick="' + q + '">' + q + ' ' + it.uom + '</button>';
          }).join('') +
        '</div>' +
        '<button class="btn btn-go btn-lg btn-block mt14" id="wpAdd">' + C.esc(T('Jodo')) + '</button>';

      DR.sheet(it.name, html, function (b) {
        function paint() {
          var v = parseFloat(buf || '0') || 0;
          b.querySelector('#wpQty').textContent = buf || '0';
          b.querySelector('#wpAmt').textContent = C.money(C.mulDiv(it.pricePaise, C.qty(v), 1000));
        }
        C.els('[data-k]', b).forEach(function (x) {
          x.onclick = function () {
            var k = x.dataset.k;
            if (k === '⌫') buf = buf.slice(0, -1);
            else if (k === '.') { if (buf.indexOf('.') === -1) buf = (buf || '0') + '.'; }
            else buf = (buf === '0' ? '' : buf) + k;
            if (buf.replace('.', '').length > 6) buf = buf.slice(0, -1);
            paint();
          };
        });
        C.els('[data-quick]', b).forEach(function (x) {
          x.onclick = function () { buf = x.dataset.quick; paint(); };
        });
        b.querySelector('#wpAdd').onclick = function () {
          var v = parseFloat(buf || '0') || 0;
          if (v <= 0) { DR.toast(T('Wazan daaliye'), 'warn'); return; }
          var l = Ops.addLine(orderId, it.id, { qtyMilli: C.qty(v) });
          if (l) orderState.lastLineId = l.id;
          DR.closeSheet();
          paintLines(); paintBar(); paintMods();
        };
        paint();
      });
    }

    function modLabel(m) {
      var lang = C.db().setup.lang;
      return lang === 'hi' ? m.hi : lang === 'en' ? m.en : m.hing;
    }

    /* One-tap modifiers applied to the item just added — the whole point
       is that "bina pyaz" costs one tap, not a sheet. */
    function paintMods() {
      var wrap = C.el('#oMods');
      if (!wrap) return;
      var oo = Ops.orderById(orderId);
      var last = oo && oo.lines.filter(function (l) { return l.id === orderState.lastLineId && !l.fired; })[0];
      if (!last) { wrap.innerHTML = ''; return; }
      wrap.innerHTML =
        '<span class="t-xs dimmer" style="align-self:center">' + C.esc(last.name) + ':</span>' +
        D.MODS.map(function (m) {
          var on = last.mods.indexOf(m.id) !== -1;
          return '<button class="btn btn-sm ' + (on ? 'btn-go' : 'btn-ghost') + '" data-mm="' + m.id + '">' + C.esc(modLabel(m)) + '</button>';
        }).join('');
      C.els('[data-mm]', wrap).forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.mm, i = last.mods.indexOf(id);
          if (i === -1) {
            last.mods.push(id);
            if (id === 'half') {
              var it = Ops.itemById(last.itemId);
              if (it && it.halfPaise) { last.variant = 'half'; last.unitPaise = it.halfPaise; }
            }
          } else {
            last.mods.splice(i, 1);
            if (id === 'half') {
              var it2 = Ops.itemById(last.itemId);
              if (it2) { last.variant = 'full'; last.unitPaise = it2.pricePaise; }
            }
          }
          C.save();
          paintMods(); paintLines(); paintBar();
        };
      });
    }

    function paintLines() {
      var oo = Ops.orderById(orderId);
      var box = C.el('#oLines');
      if (!oo || !box) return;
      var lines = oo.lines.filter(function (l) { return !l.voided; });
      if (!lines.length) {
        box.innerHTML = '<div class="glass card center dim t-sm">' + C.esc(T('Item par tap kijiye')) + '</div>';
        return;
      }
      box.innerHTML = '<div class="glass card" style="padding:8px 12px">' +
        lines.map(function (l) {
          var mods = l.mods.map(function (id) {
            var m = D.MODS.filter(function (x) { return x.id === id; })[0];
            return m ? modLabel(m) : id;
          });
          if (l.note) mods.push(l.note);
          return '<div class="row-b" data-l="' + l.id + '" style="padding:6px 0;border-top:1px solid var(--hair)">' +
            '<div class="row gap6 grow" style="min-width:0">' +
              '<span class="pill" style="padding:2px 8px;font-size:11px">' + C.qtyText(l.qtyMilli) + (l.uom !== 'plate' ? l.uom : '') + '</span>' +
              '<div class="grow" style="min-width:0">' +
                '<div class="truncate t-sm" style="font-weight:560">' + C.esc(l.name) +
                  (l.variant === 'half' ? ' <span class="t-xs dim">(half)</span>' : '') +
                  (l.lineType !== 'SALE' ? ' <span class="pill pill-violet" style="padding:0 6px;font-size:9px">' + C.esc(l.lineType === 'COMPLIMENTARY' ? T('Muft') : T('Staff')) + '</span>' : '') +
                '</div>' +
                (mods.length ? '<div class="t-xs" style="color:var(--warn-ink)">' + C.esc(mods.join(' · ')) + '</div>' : '') +
              '</div>' +
            '</div>' +
            '<div class="row gap6">' +
              '<span class="mono t-sm">' + C.money(Ops.linePaise(l), { decimals: 0 }) + '</span>' +
              (l.fired
                ? '<span class="pill pill-green" style="padding:1px 7px;font-size:9px">' + C.esc(T('gaya')) + '</span>'
                : '<button class="btn btn-sm btn-ghost" data-del="' + l.id + '" aria-label="Remove" style="min-height:28px;padding:0 8px">&#10005;</button>') +
            '</div>' +
          '</div>';
        }).join('') + '</div>';

      C.els('[data-del]', box).forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          Ops.removeLine(orderId, b.dataset.del);
          if (orderState.lastLineId === b.dataset.del) orderState.lastLineId = null;
          paintLines(); paintBar(); paintMods();
        };
      });
      /* A line already sent to the kitchen can only be voided, with a reason. */
      C.els('[data-l]', box).forEach(function (row) {
        var lid = row.dataset.l;
        var l = lines.filter(function (x) { return x.id === lid; })[0];
        if (!l || !l.fired) return;
        var press;
        var long = function (e) { if (e && e.preventDefault) e.preventDefault(); voidLinePrompt(lid); };
        row.oncontextmenu = long;
        row.ontouchstart = function () { press = setTimeout(long, 600); };
        row.ontouchend = function () { clearTimeout(press); };
        row.ontouchmove = function () { clearTimeout(press); };
      });
    }

    function voidLinePrompt(lineId) {
      var html = '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Kitchen ko already chala gaya hai. Hatane ki wajah likhni padegi — ye malik ko dikhega.')) + '</p>' +
        '<div class="col gap8">' + C.VOID_REASONS.map(function (r) {
          return '<button class="btn" data-r="' + r.id + '">' + C.esc(C.db().setup.lang === 'hi' ? r.hi : r.en) + '</button>';
        }).join('') + '</div>';
      DR.sheet(T('Item hatao'), html, function (b) {
        C.els('[data-r]', b).forEach(function (x) {
          x.onclick = function () {
            Ops.voidLine(orderId, lineId, x.dataset.r);
            DR.closeSheet();
            paintLines(); paintBar();
            DR.toast(T('Hata diya — malik ko dikhega'), 'warn');
          };
        });
      });
    }

    function paintBar() {
      var oo = Ops.orderById(orderId);
      var bar = C.el('#oBar');
      if (!oo || !bar) return;
      var fresh = oo.lines.filter(function (l) { return !l.fired && !l.voided; });
      var totals = Ops.computeTotals(oo.lines, {});
      bar.innerHTML =
        '<div class="glass glass-raised" style="padding:8px;border-radius:20px">' +
          '<div class="row gap8">' +
            '<div class="grow" style="padding-left:8px">' +
              '<div class="t-xs dimmer">' + oo.lines.filter(function (l) { return !l.voided; }).length + ' ' + C.esc(T('item')) + '</div>' +
              '<div class="mono" style="font-size:19px;font-weight:700">' + C.money(totals.grand, { decimals: 0 }) + '</div>' +
            '</div>' +
            (fresh.length
              ? '<button class="btn btn-go btn-lg flash-ok" id="oFire" style="min-width:132px">' +
                '\u{1F525} ' + C.esc(T('BHEJO')) + ' (' + fresh.length + ')</button>'
              : '<button class="btn btn-primary btn-lg" id="oBill" style="min-width:132px">\u{1F9FE} ' + C.esc(T('BILL')) + '</button>') +
          '</div>' +
        '</div>';

      var fire = C.el('#oFire');
      if (fire) fire.onclick = function () {
        var kot = Ops.fire(orderId);
        if (!kot) return;
        fire.classList.add('go');
        global.DRPrint.kot(kot);
        DR.toast(T('Kitchen mein chala gaya — parcha #') + kot.no, 'good', 1800);
        setTimeout(function () { paintLines(); paintBar(); paintMods(); }, 240);
      };
      var bill = C.el('#oBill');
      if (bill) bill.onclick = function () {
        if (!Ops.liveLines(oo).length) { DR.toast(T('Pehle item daaliye'), 'warn'); return; }
        DR.go('cashier', { orderId: orderId });
      };
    }

    function orderMenu(order) {
      var html =
        '<div class="col gap8">' +
          '<button class="btn" id="omBill">\u{1F9FE} ' + C.esc(T('Bill banao →')) + '</button>' +
          '<button class="btn" id="omGuest">\u{1F464} ' + C.esc(T('Grahak ka naam / phone')) + '</button>' +
          '<button class="btn" id="omMove">\u{2194} ' + C.esc(T('Doosre mez par bhejo')) + '</button>' +
          '<button class="btn btn-danger" id="omCancel">' + C.esc(T('Order cancel karo')) + '</button>' +
        '</div>';
      DR.sheet(T('Aur'), html, function (b) {
        b.querySelector('#omBill').onclick = function () { DR.closeSheet(); DR.go('cashier', { orderId: order.id }); };
        b.querySelector('#omGuest').onclick = function () { DR.closeSheet(); setTimeout(function () { guestSheet(order); }, 200); };
        b.querySelector('#omMove').onclick = function () { DR.closeSheet(); setTimeout(function () { moveSheet(order); }, 200); };
        b.querySelector('#omCancel').onclick = function () {
          DR.closeSheet();
          setTimeout(function () {
            DR.confirm(T('Order cancel?'), T('Jo kitchen ja chuka hai wo record mein rahega.'), T('Haan, cancel'), function () {
              order.status = 'void';
              C.logEvent('ORDER_CANCEL', { orderId: order.id });
              C.save(true);
              DR.go('waiter');
            }, true);
          }, 200);
        };
      });
    }

    function guestSheet(order) {
      DR.sheet(T('Grahak'),
        '<label class="lbl">' + C.esc(T('Naam')) + '</label><input class="field" id="gsName" value="' + C.esc(order.guestName) + '">' +
        '<label class="lbl mt14">' + C.esc(T('Phone (WhatsApp bill ke liye)')) + '</label>' +
        '<input class="field" id="gsPhone" type="tel" inputmode="numeric" value="' + C.esc(order.guestPhone) + '">' +
        '<button class="btn btn-primary btn-block mt14" id="gsSave">' + C.esc(T('Save')) + '</button>',
        function (b) {
          b.querySelector('#gsSave').onclick = function () {
            order.guestName = b.querySelector('#gsName').value.trim();
            order.guestPhone = b.querySelector('#gsPhone').value.replace(/\D/g, '').slice(0, 10);
            C.save(true);
            DR.closeSheet();
            DR.toast(T('Save ho gaya'), 'good');
          };
        });
    }

    function moveSheet(order) {
      var dd = C.db();
      var free = dd.tables.filter(function (t) { return !Ops.orderForTable(t.id); });
      if (!free.length) { DR.toast(T('Koi mez khali nahi'), 'warn'); return; }
      DR.sheet(T('Kaunse mez par?'),
        '<div class="grid g4 gap8">' + free.map(function (t) {
          return '<button class="btn btn-lg" data-t="' + t.id + '">' + C.esc(t.label) + '</button>';
        }).join('') + '</div>',
        function (b) {
          C.els('[data-t]', b).forEach(function (x) {
            x.onclick = function () {
              /* moveOrder also re-points the tickets already in the kitchen,
                 so the kitchen screen and the bill never name different tables. */
              Ops.moveOrder(order.id, x.dataset.t);
              DR.closeSheet();
              DR.go('order', order.id);
            };
          });
        });
    }

    /* Voice search. Honest about needing internet — and honest that a
       tandoor and an exhaust fan will beat it. Never on the critical path. */
    function voiceSearch() {
      var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!SR) { DR.toast(T('Is phone par bolna kaam nahi karta — type kijiye'), 'warn'); return; }
      if (!navigator.onLine) { DR.toast(T('Bolne ke liye internet chahiye — abhi type kijiye'), 'warn', 3400); return; }
      var r = new SR();
      r.lang = 'hi-IN';
      r.interimResults = false;
      r.maxAlternatives = 3;
      DR.toast(T('Boliye...'), 'good', 1500);
      r.onresult = function (e) {
        var said = e.results[0][0].transcript || '';
        orderState.q = said;
        var s = C.el('#oSearch');
        if (s) s.value = said;
        paintGrid();
      };
      r.onerror = function () { DR.toast(T('Sunayi nahi diya — type kijiye'), 'warn'); };
      try { r.start(); } catch (err) { DR.toast(T('Mic nahi khula'), 'warn'); }
    }
  }

  DR.register('waiter', waiterView);
  DR.register('order', orderView);
  global.DRWaiter = { openOrder: openOrder };
})(window);
