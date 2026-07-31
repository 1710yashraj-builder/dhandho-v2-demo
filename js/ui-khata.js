/* ============================================================
   KHATA — the udhaar book, on screen.

   Every number here comes from the v2 engine's ledger, not from this app's
   own bills. That matters: the ledger is append-only and holds both halves of
   the story (the sale AND the repayment), so a disagreement with a customer is
   settled by pointing at the history rather than by remembering.

   The screen exists because the Udhaar button used to promise a khaata that
   did not exist. This is the khaata.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, DR = global.DR;
  var T = global.T;

  function engine() {
    return (global.DRSpine && global.DRSpine.boot() || Promise.resolve(false))
      .then(function (ok) {
        return ok && global.DhandhoLocal ? global.DhandhoLocal.api : null;
      });
  }

  function fail(e) {
    DR.toast((e && e.message) ? e.message : T('Khaata abhi nahi khula'), 'bad', 3600);
  }

  function khataView(root) {
    root.innerHTML =
      '<div class="glass card center" style="margin-bottom:12px">' +
        '<p class="dim t-sm">' + C.esc(T('Khaata khul raha hai…')) + '</p></div>';

    engine().then(function (api) {
      if (!api || !api.khataOutstanding) {
        root.innerHTML =
          '<div class="glass card tint-amber"><b>' + C.esc(T('Khaata abhi nahi khula')) + '</b>' +
          '<p class="t-xs dim mt8">' + C.esc(T('Billing chal rahi hai — sirf ye hissa nahi khula. App band karke dobara kholiye.')) + '</p></div>';
        return;
      }
      /* Anything queued in the bridge has not reached the ledger yet, so a
         balance shown now would be short. Drain first, then read. */
      return global.DRSpine.drain().catch(function () { return 0; })
        .then(function () { return api.khataOutstanding(); })
        .then(function (rows) { draw(root, api, rows); });
    }).catch(function (e) {
      fail(e);
      root.innerHTML = '<div class="glass card tint-red"><b>' + C.esc(T('Kuch gadbad hui')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc((e && e.message) || '') + '</p></div>';
    });
  }

  function draw(root, api, rows) {
    var owed = rows.filter(function (r) { return r.balancePaise > 0; });
    var advance = rows.filter(function (r) { return r.balancePaise < 0; });
    var total = owed.reduce(function (s, r) { return s + r.balancePaise; }, 0);

    root.innerHTML =
      '<div class="glass ' + (total > 0 ? 'tint-amber' : 'tint-green') + ' card" style="margin-bottom:12px">' +
        '<div class="t-xs dim">' + C.esc(T('Bazaar mein phansa hua')) + '</div>' +
        '<div class="t-xl mono">' + C.money(total, { decimals: 0 }) + '</div>' +
        '<div class="t-xs dim mt8">' + owed.length + ' ' + C.esc(T('log')) + '</div>' +
      '</div>' +

      (owed.length
        ? '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Kisse lena hai')) + '</b>' +
            '<div class="col gap8 mt8">' + owed.map(function (r) {
              var over = r.creditLimitPaise > 0 && r.balancePaise > r.creditLimitPaise;
              return '<button class="btn" data-cust="' + C.esc(r.customerId) + '" style="justify-content:space-between">' +
                '<span class="col" style="align-items:flex-start">' +
                  '<span>' + C.esc(r.name) + '</span>' +
                  '<span class="t-xs dim">' + C.esc(r.phone || T('phone nahi')) +
                    (r.lastActivityAt ? ' · ' + C.esc(C.ago(r.lastActivityAt)) : '') + '</span>' +
                '</span>' +
                '<span class="pill ' + (over ? 'pill-red' : 'pill-amber') + ' mono">' + C.money(r.balancePaise, { decimals: 0 }) + '</span>' +
              '</button>';
            }).join('') + '</div>' +
          '</div>'
        : '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Kisi ka udhaar baaki nahi')) + '</b>' +
            '<p class="t-xs dim mt8">' + C.esc(T('Counter par Udhaar dabate waqt naam poocha jaata hai — wahi naam yahan aata hai.')) + '</p>' +
          '</div>') +

      /* Someone who paid more than they owed is in credit. Shown separately so
         it is never mistaken for money still to collect. */
      (advance.length
        ? '<div class="glass card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Inka advance jama hai')) + '</b>' +
            '<div class="col gap8 mt8">' + advance.map(function (r) {
              return '<div class="row-b"><span>' + C.esc(r.name) + '</span>' +
                '<span class="pill pill-green mono">' + C.money(-r.balancePaise, { decimals: 0 }) + '</span></div>';
            }).join('') + '</div>' +
          '</div>'
        : '') +

      '<p class="t-xs dimmer center" style="margin-bottom:20px">' +
        C.esc(T('Har bikri aur har jama alag likhi jaati hai — kuch mitta nahi, sirf jud'+'ta hai.')) + '</p>';

    C.els('[data-cust]', root).forEach(function (btn) {
      btn.onclick = function () {
        var row = rows.filter(function (r) { return r.customerId === btn.dataset.cust; })[0];
        customerSheet(api, row, root);
      };
    });
  }

  function customerSheet(api, row, root) {
    if (!row) return;
    DR.sheet(row.name, '<p class="dim t-sm">…</p>', function (bx) {
      api.khataStatement(row.customerId, 60).then(function (st) {
        bx.innerHTML =
          '<div class="glass tint-amber card" style="margin-bottom:12px">' +
            '<div class="row-b"><span class="t-sm">' + C.esc(T('Baaki')) + '</span>' +
              '<b class="mono t-lg">' + C.money(row.balancePaise) + '</b></div>' +
            (row.phone ? '<div class="t-xs dim mt8">' + C.esc(row.phone) + '</div>' : '') +
          '</div>' +
          '<button class="btn btn-primary" id="khRepay" style="width:100%">' +
            C.esc(T('Paisa jama hua')) + '</button>' +
          '<div class="mt14"><b class="t-sm">' + C.esc(T('Poora hisaab')) + '</b>' +
            '<div class="col gap8 mt8">' + (st.length ? st.map(function (e) {
              var owe = e.direction > 0;
              return '<div class="row-b" style="padding:5px 0;border-top:1px solid var(--hair)">' +
                '<span class="col" style="align-items:flex-start">' +
                  '<span class="t-sm">' + C.esc(e.note || (owe ? T('Bikri') : T('Jama'))) + '</span>' +
                  '<span class="t-xs dimmer">' + C.esc(C.dmy(e.createdAt) + ' ' + C.hhmm(e.createdAt)) + '</span>' +
                '</span>' +
                '<span class="pill ' + (owe ? '' : 'pill-green') + ' mono">' +
                  (owe ? '+' : '−') + C.money(e.amountPaise, { decimals: 0 }) + '</span></div>';
            }).join('') : '<p class="t-xs dim">' + C.esc(T('Abhi kuch nahi')) + '</p>') + '</div></div>';

        bx.querySelector('#khRepay').onclick = function () {
          DR.closeSheet();
          setTimeout(function () { repaySheet(api, row, root); }, 120);
        };
      }).catch(function (e) {
        bx.innerHTML = '<p class="dim t-sm">' + C.esc((e && e.message) || '') + '</p>';
      });
    });
  }

  function repaySheet(api, row, root) {
    DR.sheet(T('Jama') + ' — ' + row.name,
      '<p class="t-sm dim" style="margin-bottom:10px">' + C.esc(T('Baaki')) + ' <b class="mono">' + C.money(row.balancePaise) + '</b></p>' +
      '<label class="lbl">' + C.esc(T('Kitna aaya')) + '</label>' +
      '<input class="field" id="rpAmt" type="number" inputmode="decimal" step="0.01" value="' + (row.balancePaise / 100) + '">' +
      '<div class="row gap8 mt14">' +
        ['cash', 'upi'].map(function (m) {
          return '<label class="row gap6 t-sm"><input type="radio" name="rpMode" value="' + m + '"' +
            (m === 'cash' ? ' checked' : '') + '> ' + C.esc(m === 'cash' ? T('Cash') : 'UPI') + '</label>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-primary mt20" id="rpGo" style="width:100%">' + C.esc(T('Likh dijiye')) + '</button>',
      function (bx) {
        bx.querySelector('#rpGo').onclick = function () {
          var rupees = parseFloat(bx.querySelector('#rpAmt').value);
          if (!isFinite(rupees) || rupees <= 0) { DR.toast(T('Raashi galat hai'), 'warn'); return; }
          var paise = C.P(String(rupees));
          var mode = (bx.querySelector('input[name=rpMode]:checked') || {}).value || 'cash';
          api.khataRepay({ customerId: row.customerId, amountPaise: paise, mode: mode })
            .then(function (r) {
              DR.closeSheet();
              /* This app's own audit chain should show the collection too — the
                 money physically arrived at this counter. */
              C.logEvent('KHATA_JAMA', { name: row.name, amountPaise: paise, mode: mode });
              C.save(true);
              DR.toast(row.name + ' — ' + C.esc(T('baaki')) + ' ' + C.money(r.balancePaise), 'good', 3600);
              khataView(C.el('#screen'));
            })
            .catch(fail);
        };
      });
  }

  DR.register('khata', khataView);
})(window);
