/* Thin client over the v2 services — proves the loop end to end in a browser.
   The shipping app is Flutter; every button here calls the same server service
   the Flutter UI will call. */
(function () {
  'use strict';
  var S = null;          // last /state
  var view = 'counter';
  var activeOrder = null;

  function api(path, body) {
    return fetch('/api' + path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : undefined
    ).then(function (r) { return r.json(); });
  }
  function money(p) {
    return '₹' + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function el(sel) { return document.querySelector(sel); }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function refresh() {
    return api('/state').then(function (s) {
      S = s;
      el('#dev').textContent = s.device;
      el('#salesCount').textContent = s.sales.billCount;
      // the header shows cash actually taken, not merely billed
      el('#salesTotal').textContent = money(s.sales.collectedPaise ?? s.sales.grandPaise);
      renderCard(s.card);
      render();
    });
  }

  function renderCard(card) {
    var box = el('#card');
    if (!card) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    el('#cardTitle').textContent = card.title;
    el('#cardText').textContent = card.bodyHinglish || '';
    el('#cardYes').onclick = function () {
      api('/suggestion/confirm', { id: card.id }).then(function () {
        toast('Ho gaya'); refresh();
      });
    };
    el('#cardNo').onclick = function () {
      api('/suggestion/dismiss', { id: card.id }).then(refresh);
    };
  }

  function linesFor(orderId) {
    return (S.lines || []).filter(function (l) { return l.orderId === orderId && !l.voided; });
  }
  function orderTotal(orderId) {
    return linesFor(orderId).reduce(function (n, l) {
      return n + Math.round(l.unitPaise * l.qtyMilli / 1000);
    }, 0);
  }

  function render() {
    var m = el('#screen');
    if (view === 'counter') return renderCounter(m);
    if (view === 'kitchen') return renderKitchen(m);
    return renderOwner(m);
  }

  function renderCounter(m) {
    if (activeOrder) return renderOrder(m);
    var byTable = {};
    (S.openOrders || []).forEach(function (o) { if (o.tableId) byTable[o.tableId] = o; });
    m.innerHTML =
      '<h2>Mez</h2><div class="grid" id="tables"></div>';
    var g = el('#tables');
    (S.tables || []).forEach(function (t) {
      var o = byTable[t.id];
      var b = document.createElement('button');
      b.className = 'cell' + (o ? ' busy' : '');
      b.innerHTML = '<b>' + t.label + '</b><small>' + (o ? money(orderTotal(o.id)) : 'khali') + '</small>';
      b.onclick = function () {
        if (o) { activeOrder = o.id; render(); return; }
        api('/order', { tableId: t.id }).then(function (r) {
          activeOrder = r.id; return refresh();
        });
      };
      g.appendChild(b);
    });
  }

  function renderOrder(m) {
    var lines = linesFor(activeOrder);
    var total = orderTotal(activeOrder);
    m.innerHTML =
      '<h2>Order <span class="chip">' + money(total) + '</span></h2>' +
      '<div class="panel" id="lines"></div>' +
      '<h2>Menu</h2><div class="grid menu" id="menu"></div>' +
      '<div class="row" style="margin-top:12px">' +
        '<button class="btn" id="back">← Mez</button>' +
        '<button class="btn" id="fire">Rasoi bhejo</button>' +
      '</div>' +
      '<button class="btn go block" id="bill">Bill banao · ' + money(total) + '</button>';

    var lb = el('#lines');
    if (!lines.length) lb.innerHTML = '<span class="dim">Abhi kuch nahi</span>';
    else lb.innerHTML = lines.map(function (l) {
      return '<div class="line"><span>' + l.name +
        (l.qtyMilli !== 1000 ? ' <span class="dim">×' + (l.qtyMilli / 1000) + '</span>' : '') +
        (l.fired ? ' <span class="chip">bhej diya</span>' : '') +
        '</span><span>' + money(Math.round(l.unitPaise * l.qtyMilli / 1000)) + '</span></div>';
    }).join('');

    var mg = el('#menu');
    (S.menu || []).forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'cell item';
      b.innerHTML = '<b>' + it.name + '</b><small>' + money(it.pricePaise) +
        (it.available ? '' : ' · band') + '</small>';
      b.disabled = !it.available;
      b.onclick = function () {
        api('/line', { orderId: activeOrder, menuItemId: it.id }).then(refresh);
      };
      mg.appendChild(b);
    });

    el('#back').onclick = function () { activeOrder = null; render(); };
    el('#fire').onclick = function () {
      api('/fire', { orderId: activeOrder }).then(function (r) {
        toast(r.number ? 'Rasoi mein gaya — parcha #' + r.number : 'Kuch naya nahi');
        refresh();
      });
    };
    el('#bill').onclick = function () {
      if (!lines.length) { toast('Pehle item daaliye'); return; }
      // the server computes what is owed; we only say HOW it was paid
      api('/bill', { orderId: activeOrder, mode: 'cash' }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        var hits = (r.stockHits || []).map(function (h) {
          return h.name + ' −' + (h.consumedMilli / 1000);
        }).join(', ');
        toast('Bill ' + r.invoice.number + (hits ? ' · stock: ' + hits : ''));
        activeOrder = null;
        refresh();
      });
    };
  }

  function renderKitchen(m) {
    var kots = S.kots || [];
    if (!kots.length) { m.innerHTML = '<h2>Rasoi</h2><p class="dim">Koi parcha nahi.</p>'; return; }
    m.innerHTML = '<h2>Rasoi</h2>' + kots.map(function (k) {
      // look in kotOrders (every live ticket's order, billed or not) — using
      // only openOrders made an already-billed ticket show "Mez —"
      var order = (S.kotOrders || S.openOrders || []).filter(function (o) { return o.id === k.orderId; })[0];
      var table = order && (S.tables || []).filter(function (t) { return t.id === order.tableId; })[0];
      var items = (S.lines || []).filter(function (l) { return l.kotId === k.id; });
      return '<div class="panel kot">' +
        '<div class="line"><b>Mez ' + (table ? table.label : '—') + '</b>' +
        '<span class="chip">#' + k.number + ' · ' + k.status + '</span></div>' +
        items.map(function (l) {
          return '<div class="line"><span>' + l.name + '</span><span>×' + (l.qtyMilli / 1000) + '</span></div>';
        }).join('') +
        (k.status === 'new'
          ? '<button class="btn go block" data-ready="' + k.id + '">Ban gaya ✓</button>' : '') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(m.querySelectorAll('[data-ready]'), function (b) {
      b.onclick = function () {
        api('/kot/ready', { kotId: b.dataset.ready }).then(function () { toast('Taiyaar'); refresh(); });
      };
    });
  }

  function renderOwner(m) {
    m.innerHTML =
      '<h2>Aaj</h2>' +
      '<div class="panel"><div class="line"><span>Bikri</span><b>' + money(S.sales.grandPaise) + '</b></div>' +
      '<div class="line"><span>Haath mein aaya</span><b>' + money(S.sales.collectedPaise || 0) + '</b></div>' +
      (S.sales.udhaarPaise
        ? '<div class="line"><span>Udhaar</span><b>' + money(S.sales.udhaarPaise) + '</b></div>'
        : '') +
      '<div class="line"><span>Bill</span><b>' + S.sales.billCount + '</b></div></div>' +
      '<h2>Saamaan</h2><div class="panel" id="stock"></div>' +
      '<h2>Dish ka faayda</h2><div class="panel" id="margins"></div>';

    el('#stock').innerHTML = (S.stock || []).map(function (s) {
      var low = s.low > 0 && s.onHand <= s.low;
      return '<div class="line"><span>' + s.name + (low ? ' <span class="chip">kam</span>' : '') +
        '</span><span>' + s.onHand + ' ' + s.unit + '</span></div>';
    }).join('');

    var box = el('#margins');
    box.innerHTML = '<span class="dim">Ginti ho rahi hai…</span>';
    Promise.all((S.menu || []).map(function (it) {
      return api('/margin?menuItemId=' + it.id).then(function (r) { return { it: it, r: r }; });
    })).then(function (rows) {
      box.innerHTML = rows.map(function (x) {
        if (!x.r || x.r.costPaise === 0) {
          return '<div class="line"><span>' + x.it.name + '</span><span class="dim">recipe nahi</span></div>';
        }
        return '<div class="line"><span>' + x.it.name + '<small class="dim"> lagat ' + money(x.r.costPaise) + '</small></span>' +
          '<span>' + money(x.r.marginPaise) + ' <span class="dim">' + x.r.marginPct + '%</span></span></div>';
      }).join('');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      view = t.dataset.view;
      activeOrder = null;
      render();
    };
  });

  refresh();
  setInterval(refresh, 4000);
})();
