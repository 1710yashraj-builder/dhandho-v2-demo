/* ============================================================
   DOCTOR — the app checks itself.
   Reachable from EVERY phone regardless of role, because support has
   to work from the waiter's phone at 9pm. Shows plain ✓/⚠ lines, and
   "Copy to Claude" produces a structured bug report Yash pastes
   straight into a Claude chat.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, DR = global.DR;
  var T = global.T;

  function checks() {
    var d = C.db();
    var out = [];
    function add(name, ok, detail, soft) {
      out.push({ name: name, ok: !!ok, soft: !!soft, detail: detail || '' });
    }

    add(T('App version'), true, C.VERSION + ' · ' + d.device.code +
      (C.storeSuffix ? ' (' + C.storeSuffix + ')' : ''));
    add(T('Internet'), navigator.onLine,
      navigator.onLine ? 'Online' : T('Offline — sab chalu'), true);

    var chain = C.verifyChain();
    add(T('Hisaab ki zanjeer'), chain.ok,
      chain.ok ? chain.checked + ' entry ✓' : ('#' + chain.at));

    add(T('Storage surakshit'), DR.storagePersisted === true,
      DR.storagePersisted === true ? 'persist ✓'
        : DR.storagePersisted === false ? T('nahi mila') : '—', true);

    var size = 0;
    try { size = (localStorage.getItem(C.storeKey) || '').length; } catch (e) {}
    add(T('Data size'), size < 4200000, Math.round(size / 1024) + ' KB', true);

    var lb = d.session.lastBackupAt;
    add(T('Aakhri backup'), !!lb && (C.now() - lb) < 36 * 3600 * 1000,
      lb ? C.ago(lb) : T('kabhi nahi'), true);

    if (!global.DRSync || !global.DRSync.available()) {
      add('Cloud', false, T('abhi config nahi hua'), true);
    } else if (!d.cloud.enabled) {
      add('Cloud', false, T('band hai (sirf phone par)'), true);
    } else if (!d.cloud.joined) {
      add('Cloud', false, T('juda nahi'), true);
    } else {
      var pending = Object.keys(d.cloud.dirty || {}).length;
      add('Cloud sync', !pending && !d.cloud.lastError,
        (d.cloud.lastPushAt ? '↑ ' + C.ago(d.cloud.lastPushAt) : '—') +
        ' · ' + pending + ' pending' +
        (d.cloud.lastError ? ' · ' + String(d.cloud.lastError).slice(0, 48) : ''));
      add('Realtime', d.cloud.realtime === 'SUBSCRIBED', String(d.cloud.realtime || '—'), true);
    }

    add(T('Printer'), d.printer.ok, d.printer.ok ? 'OK' : String(d.printer.lastError || ''), true);
    add(T('Galtiyan (errors)'), !(d.errors && d.errors.length),
      (d.errors || []).length + '', true);
    add('Data', true, d.bills.length + ' bill · ' + d.orders.length + ' order · ' +
      d.items.length + ' item · ' + d.events.length + ' log' +
      ((d.eventsPast || []).length ? ' (+' + d.eventsPast.length + ' purana)' : ''));
    return out;
  }

  function report() {
    var d = C.db();
    var ch = checks();
    var L = [];
    L.push('DHANDHO RESTAURANT — bug report (paste this to Claude)');
    L.push('time: ' + new Date().toISOString());
    L.push('version: ' + C.VERSION + ' | device: ' + d.device.code +
      ' | roles: ' + ((d.cloud && d.cloud.roles) || []).join(','));
    L.push('outlet: ' + d.setup.outletName + ' | lang: ' + d.setup.lang +
      ' | gst: ' + d.setup.gstStatus + ' | format: ' + d.setup.format);
    L.push('ua: ' + navigator.userAgent);
    L.push('');
    L.push('--- checks ---');
    ch.forEach(function (c) {
      L.push((c.ok ? 'OK   ' : (c.soft ? 'WARN ' : 'FAIL ')) + c.name + ': ' + c.detail);
    });
    L.push('');
    L.push('--- cloud state ---');
    L.push(JSON.stringify({
      configured: !!(global.DRSync && global.DRSync.available()),
      enabled: d.cloud.enabled, joined: d.cloud.joined,
      restaurantId: d.cloud.restaurantId, cursor: d.cloud.lastEntityMark,
      eventSeqPushed: d.cloud.lastEventSeqPushed,
      dirty: Object.keys(d.cloud.dirty || {}).length,
      realtime: d.cloud.realtime, lastError: d.cloud.lastError
    }));
    L.push('');
    L.push('--- recent errors (' + (d.errors || []).length + ') ---');
    (d.errors || []).slice(-10).forEach(function (e) {
      L.push(new Date(e.ts).toISOString() + '  ' + e.m);
    });
    L.push('');
    L.push('--- last 25 audit events ---');
    (d.eventsPast || []).concat(d.events).slice(-25).forEach(function (e) {
      L.push('#' + e.seq + ' [' + (e.dev || '?') + '] ' + e.type +
             ' @' + C.hhmm(e.ts) + ' by ' + (e.by || '-'));
    });
    return L.join('\n');
  }

  function copyReport() {
    var txt = report();
    function fallback() {
      DR.sheet(T('Copy to Claude'),
        '<p class="t-xs dim" style="margin-bottom:10px">' + C.esc(T('Copy nahi hui — neeche se select karke copy kijiye')) + '</p>' +
        '<textarea class="field" style="min-height:220px;font-size:11px" readonly id="drRep"></textarea>',
        function (b) {
          var ta = b.querySelector('#drRep');
          ta.value = txt;
          ta.focus(); ta.select();
        });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        DR.toast(T('Report copy ho gayi — Claude ko paste kar dijiye'), 'good', 3600);
      }).catch(fallback);
    } else fallback();
  }

  function doctorView(root) {
    var ch = checks();
    var bad = ch.filter(function (c) { return !c.ok && !c.soft; }).length;
    var warn = ch.filter(function (c) { return !c.ok && c.soft; }).length;

    root.innerHTML =
      '<div class="row-b" style="margin-bottom:12px">' +
        '<h1>' + C.esc(T('App ki jaanch')) + '</h1>' +
        '<span class="pill ' + (bad ? 'pill-red' : warn ? 'pill-amber' : 'pill-green') + '">' +
          C.esc(bad ? bad + ' FAIL' : warn ? warn + ' ⚠' : T('Sab theek hai')) + '</span>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:12px;padding:8px 14px">' +
        ch.map(function (c) {
          var mark = c.ok ? '<span style="color:#56e39f">✓</span>'
            : c.soft ? '<span style="color:#ffbe5c">⚠</span>'
              : '<span style="color:#ff6a5e">✗</span>';
          return '<div class="row-b" style="padding:7px 0;border-top:1px solid rgba(255,255,255,.08)">' +
            '<span class="row gap8 t-sm" style="font-weight:560">' + mark + ' ' + C.esc(c.name) + '</span>' +
            '<span class="t-xs dim mono truncate" style="max-width:55%">' + C.esc(c.detail) + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +

      /* The owner's own phone can die mid-service, leaving him holding a
         waiter's handset with no way to become owner on it. Settings is
         owner-only, so this is the one screen every phone can still reach. */
      (function () {
        var d = C.db();
        var joined = d.cloud && d.cloud.joined;
        var isOwner = ((d.cloud && d.cloud.roles) || []).indexOf('owner') !== -1;
        if (!joined || isOwner) return '';
        return '<div class="glass card" style="margin-bottom:12px">' +
          '<b class="t-sm">' + C.esc(T('Ye malik ka apna phone hai?')) + '</b>' +
          '<p class="t-xs dim mt8">' + C.esc(T('Malik ka code daaliye — ye phone malik ban jaayega. Code sirf malik ke paas hota hai.')) + '</p>' +
          '<input class="field mt8" id="drOwnCode" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="XXXXXXXX">' +
          '<button class="btn btn-block mt8" id="drOwnGo">' + C.esc(T('Malik banao')) + '</button>' +
          '<p class="t-xs dimmer mt8" id="drOwnMsg"></p>' +
        '</div>';
      })() +

      '<button class="btn btn-primary btn-lg btn-block" id="drCopy">\u{1F4CB} ' + C.esc(T('Copy to Claude')) + '</button>' +
      '<div class="grid g2 gap8 mt8">' +
        '<button class="btn" id="drAgain">' + C.esc(T('Dobara jaanchein')) + '</button>' +
        '<button class="btn" id="drBackup">' + C.esc(T('Backup abhi lo')) + '</button>' +
      '</div>' +
      '<p class="t-xs dimmer mt14">' + C.esc(T('Kuch gadbad lage to "Copy to Claude" dabaiye aur report Yash ko WhatsApp kar dijiye.')) + '</p>';

    C.el('#drCopy').onclick = copyReport;
    C.el('#drAgain').onclick = function () { DR.go('doctor'); };

    var ownGo = C.el('#drOwnGo');
    if (ownGo) ownGo.onclick = function () {
      var msg = C.el('#drOwnMsg');
      var code = (C.el('#drOwnCode').value || '').trim();
      if (code.length !== 8) { msg.textContent = T('8 akshar ka code'); return; }
      ownGo.disabled = true;
      msg.textContent = T('Dekh rahe hain...');
      global.DRSync.claimOwner(code).then(function () {
        DR.refreshTop();
        DR.toast(T('Ye phone ab malik hai'), 'good', 3000);
        DR.go('owner');
      }).catch(function (e) {
        ownGo.disabled = false;
        msg.textContent = /wrong owner code/i.test(String(e.message || e))
          ? T('Code galat hai') : String(e.message || e).slice(0, 60);
      });
    };
    C.el('#drBackup').onclick = function () {
      C.download('dhandho-backup-' + C.dayKey() + '.json', JSON.stringify(C.db(), null, 1), 'application/json')
        .then(function (ok) {
          /* Only stamp the backup clock if a file really landed. Stamping it
             regardless is how "Aakhri backup" showed green on a phone that
             had never saved a single file. */
          if (!ok) {
            DR.toast(T('File save nahi ho payi — cloud backup dekhiye'), 'bad', 5000);
            return;
          }
          C.db().session.lastBackupAt = C.now();
          C.save(true);
          DR.toast(T('Poora backup download ho gaya'), 'good');
        });
    };
  }

  DR.register('doctor', doctorView);
  global.DRDoctor = { checks: checks, report: report, copyReport: copyReport };
})(window);
