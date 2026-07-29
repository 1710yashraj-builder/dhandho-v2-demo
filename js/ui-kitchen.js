/* ============================================================
   KITCHEN SURFACE
   A spare Android phone propped by the pass replaces a kitchen display
   unit listed at about Rs 20,000. Screen Wake Lock keeps it awake.

   Two taps, no typing, no menu, no settings. A cook has flour on his
   hands and eight minutes of backlog.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, DR = global.DR;
  var T = global.T;

  var wakeLock = null;
  var lastSeen = Date.now();
  /* Marking a ticket ready repaints the grid, so the next ticket slides into
     the exact screen position under the finger. Without this guard a double
     tap — or a cook re-tapping a laggy phone — marks two tickets ready. */
  var lastReady = 0;

  function requestWake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  /* Android drops the lock whenever the tab is hidden. Re-acquire every time
     it comes back or the kitchen screen sleeps mid-rush. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && global.DR && global.DR.view === 'kitchen') requestWake();
  });

  /* A wash of colour behind glass is not legible in a hot kitchen under a
     tube light. The age chip carries the signal as a solid colour, and the
     card gets a matching edge. */
  function ageClass(mins) {
    if (mins >= 12) return 'tint-red';
    if (mins >= 5) return 'tint-amber';
    return 'tint-green';
  }
  function agePill(mins) {
    if (mins >= 12) return 'pill-red';
    if (mins >= 5) return 'pill-amber';
    return 'pill-green';
  }
  function ageEdge(mins) {
    if (mins >= 12) return 'box-shadow:inset 4px 0 0 #ff6a5e;';
    if (mins >= 5) return 'box-shadow:inset 4px 0 0 #ffbe5c;';
    return 'box-shadow:inset 4px 0 0 #56e39f;';
  }

  function kitchenView(root) {
    requestWake();

    root.innerHTML =
      '<div class="row-b" style="margin-bottom:12px">' +
        '<h1>' + C.esc(T('Rasoi')) + '</h1>' +
        '<div class="row gap6">' +
          '<span class="pill pill-blue" id="kCount">0</span>' +
          '<button class="btn btn-sm btn-ghost" id="kReady">' + C.esc(T('Taiyaar')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div id="kCatchup"></div>' +
      '<div id="kList"></div>';

    C.el('#kReady').onclick = function () { readyDrawer(); };

    paint();
    DR.every(3000, paint);

    function paint() {
      var list = Ops.kotsLive().filter(function (k) { return k.status === 'new'; });
      var el = C.el('#kList');
      if (!el) return;

      /* Power came back and the phone pulled 90 minutes of tickets. Never
         auto-classify them — the cook clears the pile himself in one pass. */
      var gap = Date.now() - lastSeen;
      var old = list.filter(function (k) { return Date.now() - k.createdAt > 20 * 60000; });
      var cu = C.el('#kCatchup');
      if (gap > 10 * 60000 && old.length >= 3) {
        cu.innerHTML =
          '<div class="glass tint-amber card" style="margin-bottom:12px">' +
            '<b>' + C.esc(T('Purane parche hain')) + '</b>' +
            '<p class="t-sm dim mt8">' + C.esc(T('Screen band tha. Jo ban chuke hain unko tap karke hata dijiye — baaki chhod dijiye.')) + '</p>' +
          '</div>';
      } else { cu.innerHTML = ''; }
      lastSeen = Date.now();

      C.el('#kCount').textContent = list.length;

      if (!list.length) {
        el.innerHTML = '<div class="glass card center" style="padding:40px 16px">' +
          '<div style="font-size:34px" aria-hidden="true">\u{1F373}</div>' +
          '<p class="dim mt8">' + C.esc(T('Koi order baaki nahi')) + '</p></div>';
        return;
      }

      el.innerHTML = '<div class="grid g2 gap8">' + list.map(function (k) {
        var mins = Math.floor((Date.now() - k.createdAt) / 60000);
        var where = k.tableId ? (T('Mez').toUpperCase() + ' ' + tblLabel(k.tableId)) : (k.token || T('Parcel').toUpperCase());
        return '<div class="glass ' + ageClass(mins) + '" style="padding:12px 12px 12px 15px;border-radius:18px;' + ageEdge(mins) + '">' +
          '<div class="row-b" style="margin-bottom:8px">' +
            '<b style="font-size:17px">' + C.esc(where) + '</b>' +
            '<span class="pill ' + agePill(mins) + '" style="padding:2px 9px;font-weight:700">' + mins + 'm</span>' +
          '</div>' +
          '<div style="margin-bottom:10px">' + k.lines.map(function (l) {
            var mods = (l.mods || []).map(function (id) {
              var m = global.DRData.MODS.filter(function (x) { return x.id === id; })[0];
              return m ? m.en : id;
            });
            if (l.note) mods.push(l.note);
            return '<div class="kItem" data-item="' + C.esc(l.name) + '" style="padding:4px 0">' +
              '<div class="row gap8">' +
                '<b class="mono" style="font-size:17px;min-width:26px">' + C.qtyText(l.qtyMilli) + '</b>' +
                '<div class="grow"><div style="font-size:15px;font-weight:600">' + C.esc(l.name) +
                  (l.variant === 'half' ? ' (' + C.esc(T('Half').toUpperCase()) + ')' : '') +
                  (l.lineType !== 'SALE' ? ' <span class="pill pill-violet" style="padding:0 6px;font-size:9px">' + C.esc(T('Muft').toUpperCase()) + '</span>' : '') +
                '</div>' +
                (mods.length ? '<div class="t-xs" style="color:#ffe08a;font-weight:600">' + C.esc(mods.join(' · ')) + '</div>' : '') +
                '</div>' +
              '</div></div>';
          }).join('') + '</div>' +
          '<div class="row gap6">' +
            '<button class="btn btn-go grow" data-ready="' + k.id + '">' + C.esc(T('Ban gaya ✓')) + '</button>' +
            '<button class="btn btn-sm btn-ghost" data-slip="' + k.id + '" aria-label="Parcha">\u{1F5A8}</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';

      C.els('[data-ready]', el).forEach(function (b) {
        b.onclick = function () {
          if (Date.now() - lastReady < 450) return;
          lastReady = Date.now();
          Ops.setKotStatus(b.dataset.ready, 'ready');
          DR.toast(T('Taiyaar'), 'good', 1200);
          paint();
        };
      });
      C.els('[data-slip]', el).forEach(function (b) {
        b.onclick = function () {
          var k = C.db().kots.filter(function (x) { return x.id === b.dataset.slip; })[0];
          if (k) global.DRPrint.showKot(k);
        };
      });

      /* Long-press an item on a ticket -> khatam. The cook is the only person
         who knows the paneer just ran out, and he must not need the owner,
         a settings screen, or the internet to say so. */
      C.els('.kItem', el).forEach(function (row) {
        var name = row.dataset.item, press;
        var long = function (e) {
          if (e && e.preventDefault) e.preventDefault();
          var it = C.db().items.filter(function (x) { return x.name === name && x.active; })[0];
          if (!it) return;
          DR.confirm(it.name + ' ' + T('khatam?'),
            T('Har waiter ke phone par ye item turant grey ho jaayega. Wapas laane ke liye Menu mein tap kijiye.'),
            T('Haan, khatam'), function () {
              Ops.setAvailable(it.id, false);
              DR.toast(it.name + ' ' + T('khatam — sab ko dikh gaya'), 'warn', 3000);
            });
        };
        row.oncontextmenu = long;
        row.ontouchstart = function () { press = setTimeout(long, 600); };
        row.ontouchend = function () { clearTimeout(press); };
        row.ontouchmove = function () { clearTimeout(press); };
      });
    }
  }

  function readyDrawer() {
    var list = Ops.kotsLive().filter(function (k) { return k.status === 'ready'; });
    var html = list.length
      ? '<div class="col gap8">' + list.map(function (k) {
          var where = k.tableId ? (T('Mez') + ' ' + tblLabel(k.tableId)) : (k.token || T('Parcel'));
          return '<button class="btn btn-lg" data-s="' + k.id + '" style="justify-content:space-between">' +
            '<span>' + C.esc(where) + '</span>' +
            '<span class="t-xs dim">' + C.ago(k.readyAt || k.createdAt) + ' &middot; ' + C.esc(T('de diya?')) + '</span></button>';
        }).join('') + '</div>'
      : '<p class="dim center" style="padding:20px 0">' + C.esc(T('Kuch taiyaar nahi')) + '</p>';

    DR.sheet(T('Taiyaar'), html, function (b) {
      C.els('[data-s]', b).forEach(function (x) {
        x.onclick = function () {
          Ops.setKotStatus(x.dataset.s, 'served');
          DR.closeSheet();
          DR.toast(T('De diya'), 'good', 1200);
        };
      });
    });
  }

  function tblLabel(id) {
    var t = C.db().tables.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : '';
  }

  DR.register('kitchen', kitchenView);
})(window);
