/* ============================================================
   DHANDHO RESTAURANT — setup, menu, settings
   The activation visit lives here. Target: a shop billing in under
   five minutes, standing at its own counter.

   Wizard rules:
   - Picking a language changes the wizard ITSELF, instantly. The
     language screen is the first impression of the language.
   - Nothing except the shop name is mandatory — but anything typed
     is validated (a wrong GSTIN on a bill is a compliance problem,
     not a typo).
   - Picking a business type pre-selects the right ready menu, so the
     common path is tap-tap-tap-done.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, D = global.DRData;
  var T = global.T;

  /* --------------------------------------------------------
     ONBOARDING
     -------------------------------------------------------- */
  var step = 0;
  var draft = null;

  /* Which ready menus fit which business — pre-selected, editable. */
  var PACK_DEFAULTS = {
    restaurant: ['north'],
    cafe: ['cafe'],
    counter: ['mithai', 'bakery'],
    cloud: ['north', 'chinese']
  };

  var GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  var UPI_RE = /^[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{2,}$/;

  function setupView(root) {
    var d = C.db();
    if (!draft) {
      draft = {
        lang: d.setup.lang || 'hinglish',
        outletName: d.setup.outletName || '',
        format: d.setup.format || 'restaurant',
        gstStatus: d.setup.gstStatus || 'unregistered',
        gstin: '', fssai: '', phone: '', upiVpa: '',
        packs: PACK_DEFAULTS[d.setup.format || 'restaurant'].slice(),
        packsTouched: false,
        tables: 12
      };
      step = 0;
    }
    render(root);
  }

  function shell(title, sub, body, backLabel, nextLabel, canNext) {
    return '' +
      '<div class="rise" style="max-width:560px;margin:0 auto">' +
        '<div class="row gap6" style="margin-bottom:6px">' +
          [0, 1, 2, 3, 4].map(function (i) {
            return '<span style="height:4px;border-radius:9px;flex:1;background:' +
              (i <= step ? 'var(--on-glass)' : 'var(--hair-strong)') + '"></span>';
          }).join('') +
        '</div>' +
        '<h1 style="margin:16px 0 6px">' + title + '</h1>' +
        '<p class="dim t-sm" style="margin-bottom:18px">' + sub + '</p>' +
        body +
        '<div class="row gap8 mt20">' +
          (backLabel ? '<button class="btn btn-ghost" id="soBack">' + backLabel + '</button>' : '') +
          '<button class="btn btn-primary btn-lg grow" id="soNext"' + (canNext === false ? ' disabled' : '') + '>' + nextLabel + '</button>' +
        '</div>' +
      '</div>';
  }

  /* Inline validation hint under a field. Amber = fix it, blue = FYI. */
  function hint(id, msg, kind) {
    return '<p id="' + id + '" class="t-xs mt8" style="margin-left:2px;color:' +
      (kind === 'info' ? 'var(--on-glass-2)' : 'var(--warn-ink)') + ';min-height:14px">' +
      (msg ? C.esc(msg) : '') + '</p>';
  }
  function setHint(id, msg) {
    var e = C.el('#' + id);
    if (e) e.textContent = msg || '';
  }

  function render(root) {
    var html = '', after = null;

    /* ---------------- STEP 0 — language + name ---------------- */
    if (step === 0) {
      html = shell(
        C.esc(T('Aapke restaurant ka apna system')),
        C.esc(T('Paanch minute mein chalu. Kuch khareedne ki zaroorat nahi.')),
        '<label class="lbl">' + C.esc(T('Screen kis bhasha mein?')) + '</label>' +
        '<div class="grid g3" id="langPick">' +
          [['hi', 'हिंदी'], ['hinglish', 'Hinglish'], ['en', 'English']].map(function (l) {
            return '<button class="btn ' + (draft.lang === l[0] ? 'btn-primary' : '') + '" data-l="' + l[0] + '">' + l[1] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="mt20"><label class="lbl">' + C.esc(T('Dukaan ka naam')) + '</label>' +
        '<input class="field" id="soName" placeholder="Sharma Ji Ka Dhaba" value="' + C.esc(draft.outletName) + '" autocomplete="off"></div>' +
        '<button class="btn btn-sm btn-ghost btn-block mt20" id="soDemo">' + C.esc(T('Pehle chal kar dekhna hai? Demo shaam kholiye')) + '</button>' +
        (global.DRSync && global.DRSync.available()
          ? '<button class="btn btn-sm btn-ghost btn-block mt8" id="soJoin">' + C.esc(T('Doosra phone jodo / Purana hisaab wapas lao')) + '</button>'
          : ''),
        '', C.esc(T('Aage →')), !!draft.outletName
      );
      after = function () {
        C.els('#langPick button').forEach(function (b) {
          b.onclick = function () {
            draft.lang = b.dataset.l;
            /* The whole point: the wizard itself switches language NOW.
               Persist it so T() and the tab bar pick it up immediately. */
            C.db().setup.lang = draft.lang;
            C.save();
            global.DR.refreshTop();
            render(root);
          };
        });
        var inp = C.el('#soName');
        inp.oninput = function () {
          draft.outletName = inp.value.trim();
          C.el('#soNext').disabled = !draft.outletName;
        };
        inp.onkeydown = function (e) { if (e.key === 'Enter' && draft.outletName) next(root); };
        C.el('#soDemo').onclick = function () {
          var r = global.DRDemo.seed();
          if (!r.ok) { global.DR.toast(T('Demo nahi bana'), 'bad'); return; }
          draft = null; step = 0;
          global.DR.toast(T('Demo shaam taiyaar') + ' — ' + r.bills + ' ' + T('bill'), 'good', 3000);
          global.DR.go('owner');
        };
        var joinBtn = C.el('#soJoin');
        if (joinBtn) joinBtn.onclick = joinSheet;
      };
    }

    /* ---------------- STEP 1 — business type ---------------- */
    else if (step === 1) {
      var fmts = [
        ['restaurant', '\u{1F37D}', T('Restaurant'), T('Table, waiter, kitchen')],
        ['cafe', '☕', T('Cafe / Fast food'), T('Counter par order')],
        ['counter', '\u{1F36C}', T('Mithai / Bakery'), T('Kilo ke hisaab se')],
        ['cloud', '\u{1F6F5}', T('Cloud kitchen'), T('Sirf online delivery')]
      ];
      html = shell(
        C.esc(T('Kis tarah ka kaam hai?')),
        C.esc(T('Isse screen aur menu aapke hisaab se set ho jaayega.')),
        '<div class="grid g2" id="fmtPick">' +
          fmts.map(function (f) {
            return '<button class="btn btn-lg ' + (draft.format === f[0] ? 'btn-primary' : '') + '" data-f="' + f[0] + '" ' +
              'style="flex-direction:column;align-items:flex-start;padding:14px;height:auto;min-height:84px">' +
              '<span style="font-size:22px" aria-hidden="true">' + f[1] + '</span>' +
              '<span style="font-weight:650">' + C.esc(f[2]) + '</span>' +
              '<span class="t-xs dim">' + C.esc(f[3]) + '</span></button>';
          }).join('') +
        '</div>',
        '←', C.esc(T('Aage →')), true
      );
      after = function () {
        C.els('#fmtPick button').forEach(function (b) {
          b.onclick = function () {
            draft.format = b.dataset.f;
            /* Smart default: the right ready menu comes pre-picked — unless
               the user already chose menus by hand. */
            if (!draft.packsTouched) draft.packs = PACK_DEFAULTS[draft.format].slice();
            render(root);
          };
        });
      };
    }

    /* ---------------- STEP 2 — GST ---------------- */
    else if (step === 2) {
      var opts = [
        ['unregistered', T('GST nahi hai'), T('Turnover 20 lakh se kam. Bill par tax nahi lagega.')],
        ['regular', T('Regular GST (5%)'), T('Normal restaurant. 5% GST, input credit nahi milta.')],
        ['composition', T('Composition scheme'), T('1.5 crore tak. Aap tax collect nahi kar sakte.')],
        ['hotel18', T('Hotel ka restaurant (18%)'), T('Kamra Rs 7,500+ ka hai. 18% with input credit.')]
      ];
      var prof = C.GST_PROFILES[draft.gstStatus] || C.GST_PROFILES.unregistered;
      var docLabel = draft.lang === 'hi' ? C.DOC_TITLE[prof.doc].hi : C.DOC_TITLE[prof.doc].en;

      html = shell(
        C.esc(T('GST kaisa hai?')),
        C.esc(T('Isi se tay hota hai ki bill par kya chhapega. Galat bill par CA rok deta hai.')) + ' ' +
          C.esc(T('Baad mein settings se badal sakte hain.')),
        '<div class="col gap8" id="gstPick">' +
          opts.map(function (o) {
            return '<button class="btn ' + (draft.gstStatus === o[0] ? 'btn-primary' : '') + '" data-g="' + o[0] + '" ' +
              'style="flex-direction:column;align-items:flex-start;height:auto;padding:12px 14px">' +
              '<span style="font-weight:650">' + C.esc(o[1]) + '</span>' +
              '<span class="t-xs dim" style="text-align:left">' + C.esc(o[2]) + '</span></button>';
          }).join('') +
        '</div>' +
        /* Live consequence — the owner sees what his bill will say. */
        '<p class="t-sm mt14"><span class="dim">' + C.esc(T('Bill par chhapega:')) + '</span> ' +
          '<span class="pill pill-blue">' + C.esc(docLabel) + '</span></p>' +
        '<div id="gstNote" class="mt14"></div>' +
        '<div class="grid g2 mt14">' +
          '<div><label class="lbl">' + C.esc(T('GSTIN (agar hai)')) + '</label>' +
            '<input class="field" id="soGstin" value="' + C.esc(draft.gstin) + '" placeholder="09ABCDE1234F1Z5" autocapitalize="characters" autocomplete="off" maxlength="15">' +
            hint('gstinHint', '') + '</div>' +
          '<div><label class="lbl">' + C.esc(T('FSSAI number')) + '</label>' +
            '<input class="field" id="soFssai" type="tel" inputmode="numeric" value="' + C.esc(draft.fssai) + '" placeholder="' + C.esc(T('14 digit')) + '" maxlength="14">' +
            hint('fssaiHint', '') + '</div>' +
        '</div>' +
        '<p class="t-xs dimmer mt8">' + C.esc(T('FSSAI number har bill par chhapna 1 January 2022 se zaroori hai. Zyada dukaanon par abhi bhi nahi hai.')) + '</p>',
        '←', C.esc(T('Aage →')), true
      );
      after = function () {
        C.els('#gstPick button').forEach(function (b) {
          b.onclick = function () { draft.gstStatus = b.dataset.g; render(root); };
        });
        var gi = C.el('#soGstin'), fs = C.el('#soFssai');
        gi.oninput = function () {
          draft.gstin = gi.value.trim().toUpperCase();
          gi.value = draft.gstin;
          checkGstin();
        };
        fs.oninput = function () {
          draft.fssai = fs.value.replace(/\D/g, '').slice(0, 14);
          fs.value = draft.fssai;
          checkFssai();
        };
        checkGstin(); checkFssai();

        var note = C.el('#gstNote'), txt = '';
        if (draft.gstStatus === 'composition') {
          txt = '<div class="glass tint-amber card"><b>' + C.esc(T('Dhyan dijiye')) + '</b><p class="t-sm mt8">' +
            C.esc(T('Composition mein aap Swiggy/Zomato par nahi bech sakte, aur bill par tax nahi lagega. Bill ko "Bill of Supply" kehte hain — app apne aap sahi bana dega.')) + '</p></div>';
        } else if (draft.gstStatus === 'unregistered') {
          txt = '<div class="glass tint-blue card"><p class="t-sm">' +
            C.esc(T('GST nahi hai to bill par tax nahi lagega. Bina registration ke tax lena alag se jurmana hai — app aapko bachaayega.')) + '</p></div>';
        } else if (draft.gstStatus === 'regular') {
          txt = '<div class="glass tint-blue card"><p class="t-sm">' +
            C.esc(T('5% GST lagega. Standalone restaurant ko input credit nahi milta — ye kanoon hai, app ki setting nahi.')) + '</p></div>';
        }
        note.innerHTML = txt;
      };
    }

    /* ---------------- STEP 3 — menu ---------------- */
    else if (step === 3) {
      var packs = D.packList();
      html = shell(
        C.esc(T('Menu daalein')),
        C.esc(T('Ready menu se shuru kijiye — daam baad mein badal sakte hain. Ek minute ka kaam.')) +
          (draft.packs.length && !draft.packsTouched
            ? ' <span style="color:var(--warn-ink)">' + C.esc(T('Aapke kaam ke hisaab se hum ne chun liya hai — chahein to badal dijiye.')) + '</span>'
            : ''),
        '<div class="col gap8" id="packPick">' +
          packs.map(function (p) {
            var on = draft.packs.indexOf(p.key) !== -1;
            return '<button class="btn ' + (on ? 'btn-go' : '') + '" data-p="' + p.key + '" ' +
              'style="justify-content:space-between;height:auto;padding:12px 14px">' +
              '<span style="text-align:left"><span style="font-weight:650">' + C.esc(draft.lang === 'hi' ? p.labelHi : p.label) + '</span>' +
              '<br><span class="t-xs dim">' + p.count + ' ' + C.esc(T('items')) + (p.addon ? ' · ' + C.esc(T('add-on')) : '') + '</span></span>' +
              '<span aria-hidden="true">' + (on ? '✓' : '+') + '</span></button>';
          }).join('') +
        '</div>' +
        '<div class="glass card mt14">' +
          '<div class="row-b"><b class="t-sm">' + C.esc(T('Apne menu card ki photo')) + '</b><span class="pill pill-amber">' + C.esc(T('Rep karega')) + '</span></div>' +
          '<p class="t-xs dim mt8">' + C.esc(T('Photo lijiye — hamara aadmi aapka poora menu bhar dega. Tab tak upar wale ready menu se kaam chalu rakhiye.')) + '</p>' +
          '<input type="file" accept="image/*" capture="environment" id="soPhoto" class="hidden">' +
          '<button class="btn btn-sm mt8" id="soPhotoBtn">\u{1F4F7} ' + C.esc(T('Menu card ki photo')) + '</button>' +
          '<div id="soPhotoOut" class="t-xs mt8"></div>' +
        '</div>',
        '←', C.esc(T('Aage →')), true
      );
      after = function () {
        C.els('#packPick button').forEach(function (b) {
          b.onclick = function () {
            var k = b.dataset.p, i = draft.packs.indexOf(k);
            if (i === -1) draft.packs.push(k); else draft.packs.splice(i, 1);
            draft.packsTouched = true;
            render(root);
          };
        });
        C.el('#soPhotoBtn').onclick = function () { C.el('#soPhoto').click(); };
        C.el('#soPhoto').onchange = function (e) {
          var f = e.target.files && e.target.files[0];
          if (!f) return;
          draft.menuPhotoName = f.name;
          C.el('#soPhotoOut').innerHTML =
            '<span class="pill pill-green">' + C.esc(T('✓ Photo save ho gayi')) + '</span> ' +
            '<span class="dim">' + C.esc(T('Menu 10 minute mein taiyaar ho jaayega.')) + '</span>';
        };
      };
    }

    /* ---------------- STEP 4 — tables + payment ---------------- */
    else if (step === 4) {
      var needTables = draft.format === 'restaurant';
      html = shell(
        C.esc(T('Aakhri cheez')),
        C.esc(T('Table aur paise lene ka tareeka.')),
        (needTables
          ? '<label class="lbl">' + C.esc(T('Kitne table hain?')) + '</label>' +
            '<div class="row gap8"><input class="field grow" id="soTables" type="number" inputmode="numeric" min="1" max="60" value="' + draft.tables + '">' +
            '<span class="pill">' + C.esc(T('mez')) + '</span></div>'
          : '<div class="glass tint-blue card"><p class="t-sm">' + C.esc(T('Counter ka kaam hai — table ki zaroorat nahi. Parcel token apne aap banega (P1, P2...).')) + '</p></div>') +
        '<div class="mt14"><label class="lbl">' + C.esc(T('UPI ID (bill par QR ke liye)')) + '</label>' +
        '<input class="field" id="soUpi" placeholder="dukaan@okaxis" value="' + C.esc(draft.upiVpa) + '" autocapitalize="none" autocomplete="off">' +
        hint('upiHint', '') + '</div>' +
        '<div class="mt14"><label class="lbl">' + C.esc(T('Phone number')) + '</label>' +
        '<input class="field" id="soPhone" type="tel" inputmode="numeric" placeholder="98XXXXXXXX" value="' + C.esc(draft.phone) + '" maxlength="10">' +
        hint('phoneHint', '') + '</div>' +
        '<p class="t-xs dimmer mt14">' + C.esc(T('Service charge 0% par set hai. Apne aap service charge lagana kanoonan mana hai (CCPA 2022, Delhi High Court 2025). Chahein to settings mein khud chalu kar sakte hain.')) + '</p>',
        '←', C.esc(T('Dukaan chalu karo ✓')), true
      );
      after = function () {
        if (needTables) C.el('#soTables').oninput = function (e) { draft.tables = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)); };
        var up = C.el('#soUpi'), ph = C.el('#soPhone');
        up.oninput = function () { draft.upiVpa = up.value.trim(); checkUpi(); };
        ph.oninput = function () {
          draft.phone = ph.value.replace(/\D/g, '').slice(0, 10);
          ph.value = draft.phone;
          checkPhone();
        };
        checkUpi(); checkPhone();
      };
    }

    root.innerHTML = html;
    if (after) after();
    var nb = C.el('#soNext'), bb = C.el('#soBack');
    if (nb) nb.onclick = function () { next(root); };
    if (bb) bb.onclick = function () { step = Math.max(0, step - 1); render(root); };
  }

  /* --------------------------------------------------------
     JOIN — a staff phone pairs, or a new phone restores the books.
     QR scan when the camera + BarcodeDetector exist; the typed code
     always works.
     -------------------------------------------------------- */
  function joinSheet() {
    var canScan = !!(global.BarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    global.DR.sheet(T('Doosra phone jodo / Purana hisaab wapas lao'),
      '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Malik ke phone par: Settings → Naya phone jodo. Wahan ka QR yahan scan kijiye, ya code haath se daaliye.')) + '</p>' +
      (canScan ? '<button class="btn btn-primary btn-block" id="jnScan">\u{1F4F7} ' + C.esc(T('QR scan karo')) + '</button>' +
                 '<div class="center hidden" id="jnCamBox" style="margin-top:10px"><video id="jnCam" playsinline style="width:100%;max-width:320px;border-radius:14px"></video></div>'
               : '') +
      '<label class="lbl mt14">' + C.esc(T('Code (6 digit)')) + '</label>' +
      '<input class="field" id="jnCode" type="tel" inputmode="numeric" maxlength="6" autocomplete="off">' +
      '<label class="lbl mt14">' + C.esc(T('Secret (QR ke neeche likha hai)')) + '</label>' +
      '<input class="field" id="jnSecret" autocapitalize="none" autocomplete="off">' +
      '<label class="lbl mt14">' + C.esc(T('Malik ka code — sirf tab jab ye malik ka apna phone ho')) + '</label>' +
      '<input class="field" id="jnOwner" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="' + C.esc(T('khali chhod dijiye')) + '">' +
      '<button class="btn btn-go btn-lg btn-block mt14" id="jnGo">' + C.esc(T('Jodo')) + '</button>' +
      '<p class="t-xs dimmer mt8" id="jnStatus"></p>',
      function (b) {
        var stream = null;
        function stopCam() {
          if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        }
        function doJoin(code, secret) {
          var st = b.querySelector('#jnStatus');
          var ownerEl = b.querySelector('#jnOwner');
          var owner = ownerEl ? ownerEl.value.trim() : '';
          st.textContent = T('Jud raha hai...');
          global.DRSync.joinRestaurant(code, secret, owner).then(function (v) {
            stopCam();
            global.DR.pinOk = false;
            global.DR.closeSheet();
            global.DR.toast(T('Jud gaya') + ' — ' + C.esc(v.restaurant_name || ''), 'good', 3200);
            setTimeout(function () { global.DR.go('waiter'); }, 300);
          }).catch(function (e) {
            st.textContent = T('Nahi juda') + ': ' + String(e.message || e).slice(0, 60);
          });
        }
        var scanBtn = b.querySelector('#jnScan');
        if (scanBtn) scanBtn.onclick = function () {
          var box = b.querySelector('#jnCamBox'), video = b.querySelector('#jnCam');
          box.classList.remove('hidden');
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(function (s) {
              stream = s;
              video.srcObject = s;
              video.play();
              var det = new global.BarcodeDetector({ formats: ['qr_code'] });
              (function tick() {
                if (!stream) return;
                det.detect(video).then(function (codes) {
                  var hit = (codes || []).map(function (c) { return c.rawValue; })
                    .filter(function (v) { return v && v.indexOf('DHR1|') === 0; })[0];
                  if (hit) {
                    var parts = hit.split('|');
                    b.querySelector('#jnCode').value = parts[1] || '';
                    b.querySelector('#jnSecret').value = parts[2] || '';
                    doJoin(parts[1], parts[2]);
                  } else {
                    setTimeout(tick, 350);
                  }
                }).catch(function () { setTimeout(tick, 500); });
              })();
            })
            .catch(function () {
              global.DR.toast(T('Camera nahi khula — code haath se daaliye'), 'warn', 3600);
            });
        };
        b.querySelector('#jnGo').onclick = function () {
          var code = b.querySelector('#jnCode').value.trim();
          var secret = b.querySelector('#jnSecret').value.trim();
          if (code.length !== 6 || !secret) { global.DR.toast(T('Code aur secret dono chahiye'), 'warn'); return; }
          doJoin(code, secret);
        };
      },
      function () { /* onClose */ });
  }

  /* ---- live field checks (never block on empty — only on wrong) ---- */
  function checkGstin() {
    if (!draft.gstin) { setHint('gstinHint', ''); return true; }
    if (!GSTIN_RE.test(draft.gstin)) {
      setHint('gstinHint', T('GSTIN sahi nahi lag raha — 15 akshar hote hain (jaise 09ABCDE1234F1Z5)'));
      return false;
    }
    if (draft.gstStatus === 'unregistered') {
      setHint('gstinHint', T('GSTIN daala hai to aap registered hain — upar sahi GST chun lijiye'));
      return true;                       /* a nudge, not a block */
    }
    setHint('gstinHint', '');
    return true;
  }
  function checkFssai() {
    if (!draft.fssai) { setHint('fssaiHint', ''); return true; }
    if (draft.fssai.length !== 14) {
      setHint('fssaiHint', T('FSSAI 14 digit ka hota hai — abhi') + ' ' + draft.fssai.length + ' ' + T('digit hain'));
      return false;
    }
    setHint('fssaiHint', '');
    return true;
  }
  function checkPhone() {
    if (!draft.phone) { setHint('phoneHint', ''); return true; }
    if (!/^[6-9][0-9]{9}$/.test(draft.phone)) {
      setHint('phoneHint', T('Phone 10 digit ka hota hai'));
      return false;
    }
    setHint('phoneHint', '');
    return true;
  }
  function checkUpi() {
    if (!draft.upiVpa) { setHint('upiHint', ''); return true; }
    if (!UPI_RE.test(draft.upiVpa)) {
      setHint('upiHint', T('UPI ID aisi dikhti hai: naam@bank'));
      return false;
    }
    setHint('upiHint', '');
    return true;
  }

  function next(root) {
    if (step === 2 && (!checkGstin() || !checkFssai())) return;
    if (step === 4 && (!checkPhone() || !checkUpi())) return;
    if (step < 4) { step += 1; render(root); return; }
    finish();
  }

  function finish() {
    var d = C.db();
    d.setup.done = true;
    d.setup.lang = draft.lang;
    d.setup.outletName = draft.outletName;
    d.setup.format = draft.format;
    d.setup.gstStatus = draft.gstStatus;
    d.setup.gstin = draft.gstin;
    d.setup.fssai = draft.fssai;
    d.setup.phone = draft.phone;
    d.setup.upiVpa = draft.upiVpa;
    d.setup.serviceChargePct = 0;
    d.setup.priceIncludesTax = true;
    d.setup.tables = draft.tables;

    /* Menu */
    if (!draft.packs.length) draft.packs = PACK_DEFAULTS[draft.format].slice();
    var sort = 0;
    draft.packs.forEach(function (k) {
      var built = D.buildPack(k, { catStart: sort });
      sort += built.cats.length;
      d.categories = d.categories.concat(built.cats);
      d.items = d.items.concat(built.items);
    });

    /* Tables */
    if (draft.format === 'restaurant') {
      var sections = draft.tables > 16 ? ['Hall', 'AC', 'Chhat'] : ['Hall'];
      d.tables = D.buildTables(draft.tables, sections);
    } else {
      d.tables = [];
    }

    C.logEvent('SETUP_DONE', {
      outlet: d.setup.outletName, format: d.setup.format,
      gst: d.setup.gstStatus, items: d.items.length, tables: d.tables.length
    });
    C.save(true);

    /* Cloud attaches itself: online → create now; offline → the moment
       the network returns (sync.boot picks pendingCreate up). */
    if (global.DRSync && global.DRSync.available()) {
      if (navigator.onLine) {
        global.DRSync.createRestaurant(d.setup.outletName).then(function () {
          global.DR.toast(T('Cloud chalu — har bill ab surakshit hai'), 'good', 3000);
        }).catch(function () {
          C.db().cloud.pendingCreate = true;
          C.save(true);
        });
      } else {
        d.cloud.pendingCreate = true;
        C.save(true);
      }
    }

    var prof = Ops.taxProfile();
    var docLabel = d.setup.lang === 'hi' ? C.DOC_TITLE[prof.doc].hi : C.DOC_TITLE[prof.doc].en;
    var facts = [
      [d.setup.outletName, ''],
      [d.items.length + ' ' + T('items'), '\u{1F37D}'],
      (d.tables.length ? [d.tables.length + ' ' + T('table'), '\u{1FA91}'] : null),
      [docLabel, '\u{1F9FE}']
    ].filter(Boolean);

    draft = null; step = 0;
    global.DR.go('waiter');

    /* The one moment celebration is allowed (M1: rare, first-time). */
    global.DR.sheet(T('Dukaan taiyaar hai!'),
      '<div class="center pop" style="padding:6px 0 2px">' +
        '<div style="font-size:40px" aria-hidden="true">\u{1F389}</div>' +
      '</div>' +
      '<div class="glass card" style="margin:10px 0 16px">' +
        facts.map(function (f) {
          return '<div class="row gap8" style="padding:5px 0">' +
            '<span aria-hidden="true">' + (f[1] || '✓') + '</span>' +
            '<span class="t-sm" style="font-weight:560">' + C.esc(f[0]) + '</span></div>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-go btn-lg btn-block" id="fsGo">' + C.esc(T('Pehla order lijiye →')) + '</button>',
      function (b) {
        b.querySelector('#fsGo').onclick = function () {
          global.DR.closeSheet();
          setTimeout(function () { global.DR.pickStaff(); }, 220);
        };
      });
  }

  /* --------------------------------------------------------
     MENU MANAGEMENT
     -------------------------------------------------------- */
  function menuView(root) {
    var d = C.db();
    var cats = Ops.categories();

    root.innerHTML =
      '<div class="row-b" style="margin-bottom:12px">' +
        '<h1>' + C.esc(T('Menu')) + '</h1>' +
        '<div class="row gap6">' +
          '<button class="btn btn-sm" id="mAdd">' + C.esc(T('+ Item')) + '</button>' +
          '<button class="btn btn-sm btn-ghost" id="mPack">' + C.esc(T('+ Ready menu')) + '</button>' +
        '</div>' +
      '</div>' +
      '<input class="field" id="mSearch" placeholder="' + C.esc(T('Item dhoondhiye')) + '" style="margin-bottom:12px">' +
      '<div id="mList"></div>';

    function paint() {
      var q = (C.el('#mSearch').value || '').toLowerCase();
      var html = cats.map(function (cat) {
        var list = d.items.filter(function (i) {
          return i.active && i.catId === cat.id && (!q || i.name.toLowerCase().indexOf(q) !== -1);
        });
        if (!list.length) return '';
        return '<div class="glass card" style="margin-bottom:10px">' +
          '<div class="row-b" style="margin-bottom:8px"><b>' + C.esc(cat.name) + '</b>' +
          '<span class="t-xs dimmer">' + list.length + '</span></div>' +
          list.map(function (i) {
            return '<div class="row-b" style="padding:7px 0;border-top:1px solid var(--hair)">' +
              '<div class="row gap8 grow" style="min-width:0">' +
                '<span aria-hidden="true">' + i.icon + '</span>' +
                '<div class="grow" style="min-width:0">' +
                  '<div class="truncate" style="font-weight:560">' + C.esc(i.name) +
                    (i.isLiquor ? ' <span class="pill pill-violet" style="padding:1px 6px;font-size:9px">' + C.esc(T('No GST')) + '</span>' : '') +
                    (!i.available ? ' <span class="pill pill-red" style="padding:1px 6px;font-size:9px">' + C.esc(T('Khatam')) + '</span>' : '') +
                  '</div>' +
                  '<div class="t-xs dimmer">' + C.money(i.pricePaise) +
                    (i.halfPaise ? ' &middot; ' + C.esc(T('Half').toLowerCase()) + ' ' + C.money(i.halfPaise) : '') +
                    (i.uom !== 'plate' ? ' &middot; /' + i.uom : '') + '</div>' +
                '</div>' +
              '</div>' +
              '<button class="btn btn-sm btn-ghost" data-edit="' + i.id + '">' + C.esc(T('Badlein')) + '</button>' +
            '</div>';
          }).join('') + '</div>';
      }).join('');
      C.el('#mList').innerHTML = html || '<p class="dim">' + C.esc(T('Koi item nahi mila.')) + '</p>';
      C.els('[data-edit]').forEach(function (b) {
        b.onclick = function () { editItem(b.dataset.edit, function () { menuView(root); }); };
      });
    }

    C.el('#mSearch').oninput = paint;
    C.el('#mAdd').onclick = function () { editItem(null, function () { menuView(root); }); };
    C.el('#mPack').onclick = function () { addPack(function () { menuView(root); }); };
    paint();
  }

  function editItem(id, after) {
    var d = C.db();
    var it = id ? Ops.itemById(id) : null;
    var cats = Ops.categories();
    var isNew = !it;
    if (isNew) {
      it = { id: null, catId: cats.length ? cats[0].id : null, name: '', icon: '\u{1F37D}',
             pricePaise: 0, halfPaise: 0, uom: 'plate', veg: true,
             taxTreatment: 'GST_5', isLiquor: false, available: true, sold: 0, active: true };
    }

    var html =
      '<label class="lbl">' + C.esc(T('Naam')) + '</label><input class="field" id="eiName" value="' + C.esc(it.name) + '">' +
      '<div class="grid g2 mt14">' +
        '<div><label class="lbl">' + C.esc(T('Daam (full)')) + '</label><input class="field" id="eiPrice" type="number" inputmode="decimal" step="0.01" value="' + (it.pricePaise / 100 || '') + '"></div>' +
        '<div><label class="lbl">' + C.esc(T('Half plate (0 = nahi)')) + '</label><input class="field" id="eiHalf" type="number" inputmode="decimal" step="0.01" value="' + (it.halfPaise / 100 || 0) + '"></div>' +
      '</div>' +
      '<div class="grid g2 mt14">' +
        '<div><label class="lbl">' + C.esc(T('Category')) + '</label><select class="field" id="eiCat">' +
          cats.map(function (c) { return '<option value="' + c.id + '"' + (c.id === it.catId ? ' selected' : '') + '>' + C.esc(c.name) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label class="lbl">' + C.esc(T('Kaise bikta hai')) + '</label><select class="field" id="eiUom">' +
          [['plate', T('Plate / piece')], ['kg', T('Kilo (decimal)')], ['pc', T('Piece')], ['g', T('Gram')]].map(function (u) {
            return '<option value="' + u[0] + '"' + (u[0] === it.uom ? ' selected' : '') + '>' + C.esc(u[1]) + '</option>';
          }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="row gap8 mt14 wrap">' +
        '<label class="row gap6 t-sm"><input type="checkbox" id="eiVeg"' + (it.veg ? ' checked' : '') + '> ' + C.esc(T('Veg')) + '</label>' +
        '<label class="row gap6 t-sm"><input type="checkbox" id="eiLiq"' + (it.isLiquor ? ' checked' : '') + '> ' + C.esc(T('Sharab (GST se bahar)')) + '</label>' +
        '<label class="row gap6 t-sm"><input type="checkbox" id="eiAvail"' + (it.available ? ' checked' : '') + '> ' + C.esc(T('Aaj mil raha hai')) + '</label>' +
      '</div>' +
      '<div class="row gap8 mt20">' +
        (isNew ? '' : '<button class="btn btn-danger" id="eiDel">' + C.esc(T('Hatao')) + '</button>') +
        '<button class="btn btn-primary grow" id="eiSave">' + C.esc(T('Save')) + '</button>' +
      '</div>';

    global.DR.sheet(isNew ? T('Naya item') : T('Item badlein'), html, function (b) {
      b.querySelector('#eiSave').onclick = function () {
        var name = b.querySelector('#eiName').value.trim();
        if (!name) { global.DR.toast(T('Naam likhiye pehle'), 'warn'); return; }
        var price = C.P(b.querySelector('#eiPrice').value);
        var half = C.P(b.querySelector('#eiHalf').value);
        var liq = b.querySelector('#eiLiq').checked;
        var rec = {
          catId: b.querySelector('#eiCat').value,
          name: name,
          icon: D.iconFor(name),
          pricePaise: price,
          halfPaise: half,
          uom: b.querySelector('#eiUom').value,
          veg: b.querySelector('#eiVeg').checked,
          isLiquor: liq,
          taxTreatment: liq ? 'ALCOHOL_OUTSIDE_GST' : 'GST_5',
          available: b.querySelector('#eiAvail').checked
        };
        if (isNew) {
          rec.id = C.uid('I'); rec.sold = 0; rec.active = true;
          C.db().items.push(rec);
          C.logEvent('ITEM_ADD', { id: rec.id, name: rec.name, price: rec.pricePaise });
        } else {
          var old = { name: it.name, price: it.pricePaise };
          Object.keys(rec).forEach(function (k) { it[k] = rec[k]; });
          C.logEvent('ITEM_EDIT', { id: it.id, from: old, to: { name: rec.name, price: rec.pricePaise } });
        }
        C.save(true);
        global.DR.closeSheet();
        global.DR.toast(T('Save ho gaya'), 'good');
        if (after) setTimeout(after, 120);
      };
      var del = b.querySelector('#eiDel');
      if (del) del.onclick = function () {
        it.active = false;
        C.logEvent('ITEM_REMOVE', { id: it.id, name: it.name });
        C.save(true);
        global.DR.closeSheet();
        if (after) setTimeout(after, 120);
      };
    });
  }

  function addPack(after) {
    var packs = D.packList();
    var lang = C.db().setup.lang;
    var html = '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Poora ready menu jod dijiye. Daam baad mein badal sakte hain.')) + '</p>' +
      '<div class="col gap8">' + packs.map(function (p) {
        return '<button class="btn" data-p="' + p.key + '" style="justify-content:space-between">' +
          '<span>' + C.esc(lang === 'hi' ? p.labelHi : p.label) + '</span><span class="t-xs dim">' + p.count + ' ' + C.esc(T('items')) + '</span></button>';
      }).join('') + '</div>';
    global.DR.sheet(T('Ready menu jodein'), html, function (b) {
      C.els('[data-p]', b).forEach(function (btn) {
        btn.onclick = function () {
          var d = C.db();
          var built = D.buildPack(btn.dataset.p, { catStart: d.categories.length });
          d.categories = d.categories.concat(built.cats);
          d.items = d.items.concat(built.items);
          C.logEvent('MENU_PACK_ADD', { pack: btn.dataset.p, items: built.items.length });
          C.save(true);
          global.DR.closeSheet();
          global.DR.toast(built.items.length + ' ' + T('items jud gaye'), 'good');
          if (after) setTimeout(after, 120);
        };
      });
    });
  }

  /* --------------------------------------------------------
     SETTINGS
     -------------------------------------------------------- */
  function settingsView(root) {
    var d = C.db();
    var chain = C.verifyChain();
    var be = Ops.breakEven();

    root.innerHTML =
      '<h1 style="margin-bottom:14px">' + C.esc(T('Settings')) + '</h1>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Dukaan')) + '</b>' +
        '<div class="mt8"><label class="lbl">' + C.esc(T('Naam')) + '</label><input class="field" id="stName" value="' + C.esc(d.setup.outletName) + '"></div>' +
        '<div class="grid g2 mt8">' +
          '<div><label class="lbl">' + C.esc(T('GSTIN')) + '</label><input class="field" id="stGstin" value="' + C.esc(d.setup.gstin) + '"></div>' +
          '<div><label class="lbl">' + C.esc(T('FSSAI')) + '</label><input class="field" id="stFssai" value="' + C.esc(d.setup.fssai) + '"></div>' +
        '</div>' +
        '<div class="grid g2 mt8">' +
          '<div><label class="lbl">' + C.esc(T('Phone')) + '</label><input class="field" id="stPhone" value="' + C.esc(d.setup.phone) + '"></div>' +
          '<div><label class="lbl">' + C.esc(T('UPI ID')) + '</label><input class="field" id="stUpi" value="' + C.esc(d.setup.upiVpa) + '"></div>' +
        '</div>' +
        '<div class="mt8"><label class="lbl">' + C.esc(T('Pata (bill par)')) + '</label><input class="field" id="stAddr" value="' + C.esc(d.setup.address) + '"></div>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Tax')) + '</b>' +
        '<div class="mt8"><label class="lbl">' + C.esc(T('GST status')) + '</label><select class="field" id="stGst">' +
          Object.keys(C.GST_PROFILES).map(function (k) {
            var lbl = { unregistered: T('GST nahi hai'), regular: T('Regular GST (5%)'),
                        composition: T('Composition scheme'), hotel18: T('Hotel ka restaurant (18%)') }[k] || C.GST_PROFILES[k].label;
            return '<option value="' + k + '"' + (k === d.setup.gstStatus ? ' selected' : '') + '>' + C.esc(lbl) + '</option>';
          }).join('') +
        '</select></div>' +
        '<label class="row gap8 mt14 t-sm"><input type="checkbox" id="stIncl"' + (d.setup.priceIncludesTax !== false ? ' checked' : '') + '> ' + C.esc(T('Menu ke daam mein GST shaamil hai')) + '</label>' +
        '<div class="mt14"><label class="lbl">' + C.esc(T('Service charge %')) + '</label>' +
          '<input class="field" id="stSc" type="number" inputmode="decimal" min="0" max="20" step="0.5" value="' + (d.setup.serviceChargePct || 0) + '">' +
        '</div>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Mahine ka pakka kharcha')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Isse pata chalta hai roz kitna karna zaroori hai.')) + '</p>' +
        '<div class="grid g2 mt8">' +
          '<div><label class="lbl">' + C.esc(T('Kiraya')) + '</label><input class="field" id="stRent" type="number" inputmode="numeric" value="' + (d.fixed.rent / 100 || '') + '"></div>' +
          '<div><label class="lbl">' + C.esc(T('Gas')) + '</label><input class="field" id="stGas" type="number" inputmode="numeric" value="' + (d.fixed.gas / 100 || '') + '"></div>' +
          '<div><label class="lbl">' + C.esc(T('Tankhwah')) + '</label><input class="field" id="stSal" type="number" inputmode="numeric" value="' + (d.fixed.salary / 100 || '') + '"></div>' +
          '<div><label class="lbl">' + C.esc(T('Baaki kharcha')) + '</label><input class="field" id="stOth" type="number" inputmode="numeric" value="' + (d.fixed.other / 100 || '') + '"></div>' +
        '</div>' +
        '<p class="t-sm mt8">' + C.esc(T('Roz kam se kam')) + ' <b>' + C.money(be.perDayPaise) + '</b> ' + C.esc(T('karna hai.')) + '</p>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<div class="row-b"><b>' + C.esc(T('Hisaab ki suraksha')) + '</b>' +
        '<span class="pill ' + (chain.ok ? 'pill-green' : 'pill-red') + '">' + C.esc(chain.ok ? T('✓ Sahi') : T('⚠ Toota')) + '</span></div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Har bill, har void, har discount ek zanjeer mein juda hai. Koi purana record chupke se badal nahi sakta — zanjeer toot jaayegi aur yahan dikh jaayega.')) + '</p>' +
        '<p class="t-xs dimmer mt8">' + chain.checked + ' ' + C.esc(T('entry jaanchi gayi')) + (chain.ok ? '' : ' · #' + chain.at + ' ' + C.esc(T('par gadbad'))) + '</p>' +
        '<button class="btn btn-sm mt8" id="stChain">' + C.esc(T('Abhi jaanchein')) + '</button>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<div class="row-b"><b>' + C.esc(T('Malik lock')) + '</b>' +
          (d.setup.pinHash ? '<span class="pill pill-green">PIN ✓</span>' : '') + '</div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Malik, Settings aur Menu par 4 digit ka lock. Staff bill kaat sakta hai, hisaab nahi dekh sakta.')) + '</p>' +
        '<div class="row gap8 mt8">' +
          '<input class="field grow" id="stPin" type="tel" inputmode="numeric" maxlength="4" placeholder="' + C.esc(T('4 digit ka PIN')) + '" autocomplete="off">' +
          '<button class="btn btn-sm" id="stPinSet">' + C.esc(d.setup.pinHash ? T('PIN badlo') : T('PIN lagao')) + '</button>' +
          (d.setup.pinHash ? '<button class="btn btn-sm btn-ghost" id="stPinOff">' + C.esc(T('PIN hatao')) + '</button>' : '') +
        '</div>' +
        '<p class="t-xs dimmer mt8">' + C.esc(T('Ye lock staff ko rokta hai, chor ko nahi — phone ka lock bhi rakhiye.')) + '</p>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px" id="stCloudCard">' + cloudCardHtml() + '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Aapka data')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Poora hisaab kabhi bhi, muft, apne paas. Hum band bhi ho jaayein to aapka record aapka hai.')) + '</p>' +
        '<div class="row gap8 wrap mt8">' +
          '<button class="btn btn-sm" id="stExpBills">' + C.esc(T('Bill export')) + '</button>' +
          '<button class="btn btn-sm" id="stExpItems">' + C.esc(T('Item-wise export')) + '</button>' +
          '<button class="btn btn-sm" id="stExpAll">' + C.esc(T('Poora backup (JSON)')) + '</button>' +
        '</div>' +
        '<input type="file" accept=".json,application/json" id="stRestoreFile" class="hidden">' +
        '<button class="btn btn-sm btn-ghost mt8" id="stRestore">' + C.esc(T('Backup file se wapas lao')) + '</button>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<div class="row-b"><b>' + C.esc(T('Screen')) + '</b>' +
          '<button class="btn btn-sm" id="stLite">' + C.esc(d.setup.lite ? T('Lite chalu') : T('Glass chalu')) + '</button></div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Purana ya dheema phone ho to Lite mode chalaiye — sab kuch wahi rahega, sirf chamak hat jaayegi.')) + '</p>' +
        '<div class="mt14"><label class="lbl">' + C.esc(T('Roshni')) + '</label><select class="field" id="stTheme">' +
          [['auto', T('Apne aap (phone jaisa)')], ['dark', T('Raat — kaala')], ['light', T('Din — safed')]].map(function (t) {
            return '<option value="' + t[0] + '"' + (t[0] === (d.setup.theme || 'auto') ? ' selected' : '') + '>' + C.esc(t[1]) + '</option>';
          }).join('') +
        '</select>' +
        '<p class="t-xs dimmer mt8">' + C.esc(T('Kaunter par dhoop aati ho to "Din" chuniye — screen padhne mein aasaan ho jaayegi.')) + '</p></div>' +
        '<div class="mt14"><label class="lbl">' + C.esc(T('Bhasha')) + '</label><select class="field" id="stLang">' +
          [['hi', 'हिंदी'], ['hinglish', 'Hinglish'], ['en', 'English']].map(function (l) {
            return '<option value="' + l[0] + '"' + (l[0] === d.setup.lang ? ' selected' : '') + '>' + l[1] + '</option>';
          }).join('') +
        '</select></div>' +
      '</div>' +

      '<div class="glass card" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Menu')) + '</b>' +
        '<div class="row gap8 wrap mt8"><button class="btn btn-sm" id="stMenu">' + C.esc(T('Menu kholein')) + '</button>' +
        '<button class="btn btn-sm" id="stStock">' + C.esc(T('Saamaan')) + '</button>' +
        '<button class="btn btn-sm btn-ghost" id="stStaff">' + C.esc(T('Staff')) + '</button></div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Saamaan mein: kya kitna bacha hai, kis dish mein kya lagta hai, aur ek plate par kitna bachta hai.')) + '</p>' +
      '</div>' +

      '<div class="glass ' + (d.setup.demo ? 'tint-amber' : '') + ' card" style="margin-bottom:10px">' +
        '<div class="row-b"><b>' + C.esc(T('Demo')) + '</b>' + (d.setup.demo ? '<span class="pill pill-amber">' + C.esc(T('Demo data chalu')) + '</span>' : '') + '</div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Ek poori shaam ka hisaab bhar dega — dikhane ke liye. Asli dukaan chalane se pehle "Sab mitao" dabaiye.')) + '</p>' +
        '<button class="btn btn-sm mt8" id="stDemo">' + C.esc(d.setup.demo ? T('Aur ek shaam bharo') : T('Demo shaam bharo')) + '</button>' +
      '</div>' +

      '<div class="glass card tint-red" style="margin-bottom:10px">' +
        '<b>' + C.esc(T('Naya shuru karein')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Saara data mit jaayega. Pehle backup le lijiye.')) + '</p>' +
        '<button class="btn btn-sm btn-danger mt8" id="stReset">' + C.esc(T('Sab mitao')) + '</button>' +
      '</div>';

    function bindText(id, apply) {
      var e = C.el(id);
      if (e) e.onchange = function () { apply(e.value); C.save(true); global.DR.refreshTop(); };
    }
    bindText('#stName', function (v) { C.db().setup.outletName = v.trim(); });
    bindText('#stGstin', function (v) { C.db().setup.gstin = v.trim().toUpperCase(); });
    bindText('#stFssai', function (v) { C.db().setup.fssai = v.replace(/\D/g, '').slice(0, 14); });
    bindText('#stPhone', function (v) { C.db().setup.phone = v.replace(/\D/g, '').slice(0, 10); });
    bindText('#stUpi', function (v) { C.db().setup.upiVpa = v.trim(); });
    bindText('#stAddr', function (v) { C.db().setup.address = v.trim(); });
    bindText('#stRent', function (v) { C.db().fixed.rent = C.P(v); });
    bindText('#stGas', function (v) { C.db().fixed.gas = C.P(v); });
    bindText('#stSal', function (v) { C.db().fixed.salary = C.P(v); });
    bindText('#stOth', function (v) { C.db().fixed.other = C.P(v); });

    C.el('#stGst').onchange = function (e) {
      var old = C.db().setup.gstStatus;
      C.db().setup.gstStatus = e.target.value;
      C.logEvent('GST_STATUS_CHANGE', { from: old, to: e.target.value });
      C.save(true);
      global.DR.toast(T('Bill ab') + ' "' + C.DOC_TITLE[Ops.taxProfile().doc].en + '" ' + T('banega'), 'good', 3200);
      settingsView(root);
    };
    C.el('#stIncl').onchange = function (e) { C.db().setup.priceIncludesTax = e.target.checked; C.save(true); };
    C.el('#stSc').onchange = function (e) {
      var v = Math.max(0, Math.min(20, parseFloat(e.target.value) || 0));
      C.db().setup.serviceChargePct = v;
      C.logEvent('SERVICE_CHARGE_SET', { pct: v });
      C.save(true);
      if (v > 0) global.DR.toast(T('Har bill par cashier ko khud lagana padega — apne aap nahi lagega'), 'warn', 4200);
    };
    C.el('#stLang').onchange = function (e) {
      C.db().setup.lang = e.target.value;
      C.save(true);
      global.DR.go('settings');
    };
    C.el('#stLite').onclick = function () { global.DR.toggleLite(); settingsView(root); };
    C.el('#stTheme').onchange = function (e) {
      C.db().setup.theme = e.target.value;
      C.save(true);
      global.DR.applyTheme();
    };
    C.el('#stMenu').onclick = function () { global.DR.go('menu'); };
    C.el('#stStock').onclick = function () { global.DR.go('stock'); };
    C.el('#stStaff').onclick = function () { global.DR.pickStaff(); };
    C.el('#stChain').onclick = function () {
      var r = C.verifyChain();
      global.DR.toast(r.ok
        ? T('Poori zanjeer sahi hai') + ' (' + r.checked + ')'
        : T('Gadbad entry #') + r.at + ' ' + T('par hai'), r.ok ? 'good' : 'bad', 4000);
      settingsView(root);
    };

    bindCloudCard(root);

    C.el('#stPinSet').onclick = function () {
      var v = (C.el('#stPin').value || '').replace(/\D/g, '');
      if (v.length !== 4) { global.DR.toast(T('4 digit ka PIN'), 'warn'); return; }
      C.db().setup.pinHash = global.DR.pinHashOf(v);
      C.db().setup.pinDev = C.db().device.id;   /* this PIN belongs to this handset */
      C.logEvent('PIN_SET', {});
      C.save(true);
      global.DR.pinOk = true;              /* the owner who just set it stays unlocked */
      global.DR.toast(T('PIN lag gaya'), 'good');
      settingsView(root);
    };
    var pinOff = C.el('#stPinOff');
    if (pinOff) pinOff.onclick = function () {
      C.db().setup.pinHash = null;
      C.db().setup.pinDev = null;
      C.logEvent('PIN_REMOVE', {});
      C.save(true);
      global.DR.toast(T('PIN hat gaya'), 'good');
      settingsView(root);
    };
    C.el('#stDemo').onclick = function () {
      var r = global.DRDemo.seed();
      global.DR.toast(r.ok ? T('Demo shaam bhar gayi') : T('Demo nahi bana'), r.ok ? 'good' : 'bad');
      if (r.ok) setTimeout(function () { global.DR.go('owner'); }, 500);
    };
    C.el('#stExpBills').onclick = exportBills;
    C.el('#stExpItems').onclick = exportItems;
    C.el('#stExpAll').onclick = exportAll;

    C.el('#stReset').onclick = function () {
      global.DR.confirm(T('Sab mitana hai?'), T('Saara hisaab, menu aur bill mit jaayenge. Ye wapas nahi aayega.'), T('Haan, mitao'), function () {
        C.reset();
        location.reload();
      }, true);
    };
  }

  /* --------------------------------------------------------
     CLOUD card + pairing + roles
     -------------------------------------------------------- */
  function cloudCardHtml() {
    var d = C.db();
    var S = global.DRSync;
    if (!S || !S.available()) {
      return '<b>Cloud</b><p class="t-xs dim mt8">' + C.esc(T('abhi config nahi hua')) + '</p>';
    }
    if (!d.cloud.joined) {
      return '<div class="row-b"><b>Cloud</b><span class="pill pill-amber">' + C.esc(T('juda nahi')) + '</span></div>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Cloud backup + doosre phone — har bill turant surakshit, phone kho jaaye to wapas.')) + '</p>' +
        '<button class="btn btn-sm btn-go mt8" id="stCloudOn">' + C.esc(T('Cloud backup chalu karo')) + '</button>';
    }
    var pending = Object.keys(d.cloud.dirty || {}).length;
    return '' +
      '<div class="row-b"><b>Cloud</b>' +
        '<span class="pill ' + (d.cloud.enabled ? 'pill-green' : 'pill-amber') + '">' +
        C.esc(d.cloud.enabled ? '✓ ' + T('chalu') : T('band hai (sirf phone par)')) + '</span></div>' +
      '<p class="t-xs dim mt8">' + C.esc(d.cloud.restaurantName || d.setup.outletName) +
        ' · ' + (d.cloud.devices || []).length + ' ' + C.esc(T('phone')) +
        (d.cloud.lastPushAt ? ' · ↑ ' + C.ago(d.cloud.lastPushAt) : '') +
        (pending ? ' · ' + pending + ' ' + C.esc(T('baaki')) : '') + '</p>' +
      '<div class="row gap8 wrap mt8">' +
        '<button class="btn btn-sm btn-primary" id="stPair">' + C.esc(T('Naya phone jodo')) + '</button>' +
        '<button class="btn btn-sm" id="stDevices">' + C.esc(T('Phone aur unke kaam')) + '</button>' +
        '<button class="btn btn-sm btn-ghost" id="stCloudToggle">' +
          C.esc(d.cloud.enabled ? T('Sirf phone par rakho') : T('Cloud wapas chalu karo')) + '</button>' +
      '</div>' +
      (d.cloud.enabled
        ? ''
        : '<p class="t-xs mt8" style="color:var(--warn-ink)">' + C.esc(T('Cloud band hai — naya data sirf is phone par hai. Backup file hi suraksha hai.')) + '</p>');
  }

  function pairSheet() {
    var d = C.db();
    if (!d.cloud.pairCode) { global.DR.toast(T('juda nahi'), 'warn'); return; }
    var payload = 'DHR1|' + d.cloud.pairCode + '|' + d.cloud.pairSecret;
    global.DR.sheet(T('Naya phone jodo'),
      '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Naye phone par app kholiye → "Doosra phone jodo" → ye QR scan kijiye.')) + '</p>' +
      '<div class="center" id="pairQrBox" style="background:#fff;border-radius:14px;padding:12px;display:inline-block;margin:0 auto"></div>' +
      '<div class="glass card mt14"><div class="t-xs dim">' + C.esc(T('Ya ye code haath se daaliye:')) + '</div>' +
        '<div class="mono t-lg center" style="letter-spacing:2px">' + C.esc(d.cloud.pairCode) + '</div>' +
        '<div class="mono t-sm center dim" style="word-break:break-all">' + C.esc(d.cloud.pairSecret) + '</div></div>' +
      '<p class="t-xs dimmer mt8">' + C.esc(T('Ye QR chaabi hai — sirf apne staff ko dikhaiye.')) + '</p>' +
      (d.cloud.ownerCode
        ? '<div class="glass tint-amber card mt14">' +
            '<b class="t-sm">' + C.esc(T('Malik ka code — likh kar rakhiye')) + '</b>' +
            '<div class="mono t-lg center" style="letter-spacing:3px;margin:8px 0">' + C.esc(d.cloud.ownerCode) + '</div>' +
            '<p class="t-xs dim">' + C.esc(T('Phone kho jaaye ya app dobara install karni pade, to naye phone par ye code daalne se aapka poora malik ka hisaab wapas aa jaayega. Staff ko mat dijiye.')) + '</p>' +
          '</div>'
        : ''),
      function (b) {
        try {
          var cv = global.DRQR.canvas(payload, 240);
          b.querySelector('#pairQrBox').appendChild(cv);
        } catch (e) {
          b.querySelector('#pairQrBox').textContent = payload;
        }
      });
  }

  var ROLE_DEFS = [
    ['waiter', 'Mez'], ['kitchen', 'Rasoi'], ['cashier', 'Counter'], ['owner', 'Malik']
  ];

  function devicesSheet(root) {
    var S = global.DRSync;
    S.refreshContext().then(function () {
      var d = C.db();
      var list = d.cloud.devices || [];
      global.DR.sheet(T('Phone aur unke kaam'),
        (list.length ? '' : '<p class="dim t-sm">—</p>') +
        list.map(function (dev) {
          var mine = dev.id === d.cloud.deviceId;
          return '<div class="glass card" style="margin-bottom:8px">' +
            '<div class="row-b"><b class="t-sm">' + C.esc(dev.label || dev.dev_code) +
              (mine ? ' <span class="pill pill-blue" style="padding:1px 7px;font-size:9px">' + C.esc(T('ye phone')) + '</span>' : '') + '</b>' +
            '<span class="t-xs dimmer">' + (dev.last_seen ? C.ago(new Date(dev.last_seen).getTime()) : '—') + '</span></div>' +
            '<div class="row gap6 wrap mt8" data-dev="' + dev.id + '">' +
              ROLE_DEFS.map(function (r) {
                var on = (dev.roles || []).indexOf(r[0]) !== -1;
                return '<button class="btn btn-sm ' + (on ? 'btn-go' : 'btn-ghost') + '" data-role="' + r[0] + '">' + C.esc(T(r[1])) + '</button>';
              }).join('') +
            '</div>' +
            (mine ? '' :
              '<button class="btn btn-sm btn-ghost mt8" data-forget="' + dev.id + '">' +
                C.esc(T('Ye phone hata do')) + '</button>') +
            '</div>';
        }).join(''),
        function (b) {
          C.els('[data-forget]', b).forEach(function (btn) {
            btn.onclick = function () {
              global.DR.confirm(T('Ye phone hata do'),
                T('Is phone ka hisaab se rishta khatam ho jaayega — na naya bill bhej payega, na purana dekh payega. Bills jo pehle ban chuke hain wo surakshit rahenge.'),
                T('Haan, hatao'), function () {
                  S.forgetDevice(btn.dataset.forget).then(function () {
                    global.DR.closeSheet();
                    global.DR.toast(T('Phone hata diya'), 'good', 1800);
                    devicesSheet(root);
                  }).catch(function (e) {
                    global.DR.toast(String(e.message || e), 'bad');
                  });
                });
            };
          });
          C.els('[data-dev]', b).forEach(function (row) {
            var devId = row.dataset.dev;
            C.els('[data-role]', row).forEach(function (btn) {
              btn.onclick = function () {
                btn.classList.toggle('btn-go');
                btn.classList.toggle('btn-ghost');
                var roles = C.els('.btn-go', row).map(function (x) { return x.dataset.role; });
                if (!roles.length) {
                  btn.classList.add('btn-go'); btn.classList.remove('btn-ghost');
                  global.DR.toast(T('Kam se kam ek kaam chahiye'), 'warn');
                  return;
                }
                S.setRoles(devId, roles).then(function () {
                  global.DR.toast(T('Save ho gaya'), 'good', 1400);
                }).catch(function (e) {
                  global.DR.toast(String(e.message || e), 'bad');
                });
              };
            });
          });
        });
    });
  }

  function bindCloudCard(root) {
    var S = global.DRSync;
    var on = C.el('#stCloudOn');
    if (on) on.onclick = function () {
      on.disabled = true;
      S.createRestaurant(C.db().setup.outletName).then(function () {
        global.DR.toast(T('Cloud chalu — har bill ab surakshit hai'), 'good', 3200);
        settingsView(root);
      }).catch(function (e) {
        on.disabled = false;
        global.DR.toast(String(e.message || e), 'bad', 4200);
      });
    };
    var pair = C.el('#stPair');
    if (pair) pair.onclick = pairSheet;
    var devs = C.el('#stDevices');
    if (devs) devs.onclick = function () { devicesSheet(root); };
    var tog = C.el('#stCloudToggle');
    if (tog) tog.onclick = function () {
      var d = C.db();
      if (d.cloud.enabled) {
        global.DR.confirm(T('Sirf phone par rakho'),
          T('Cloud band hoga — naya hisaab sirf is phone par rahega, doosre phone ruk jaayenge. Kabhi bhi wapas chalu kar sakte hain.'),
          T('Haan'), function () {
            S.setEnabled(false);
            settingsView(root);
          });
      } else {
        S.setEnabled(true);
        global.DR.toast(T('Cloud wapas chalu ho gaya'), 'good');
        settingsView(root);
      }
    };
    var rf = C.el('#stRestore');
    if (rf) rf.onclick = function () { C.el('#stRestoreFile').click(); };
    var rfi = C.el('#stRestoreFile');
    if (rfi) rfi.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var raw = String(rd.result);
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (err) {}
        if (!parsed || parsed.v !== 1 || !parsed.setup) {
          global.DR.toast(T('Ye backup file nahi lag rahi'), 'bad', 4200);
          return;
        }
        global.DR.confirm(T('Backup file se wapas lao'),
          T('Is phone ka abhi ka data hat kar backup wala aa jaayega.') + ' (' +
          (parsed.bills || []).length + ' bill · ' + C.esc(parsed.setup.outletName || '') + ')',
          T('Haan, wapas lao'), function () {
            try {
              localStorage.setItem(C.storeKey, raw);
              location.reload();
            } catch (err) {
              global.DR.toast(T('Restore nahi hua'), 'bad');
            }
          }, true);
      };
      rd.readAsText(f);
    };
  }

  /* --------------------------------------------------------
     EXPORTS — free, full, forever. Works after cancellation too,
     because it never needed us in the first place.
     (Column headers stay English: these files go to CAs and Excel.)
     -------------------------------------------------------- */
  function exportBills() {
    var d = C.db();
    var rows = d.bills.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    var csv = C.toCSV(rows, [
      { label: 'Bill No', get: function (b) { return b.no; } },
      { label: 'Date', get: function (b) { return C.dmy(b.createdAt); } },
      { label: 'Time', get: function (b) { return C.hhmm(b.createdAt); } },
      { label: 'Business Day', key: 'day' },
      { label: 'Document', key: 'docType' },
      { label: 'Type', key: 'type' },
      { label: 'Table/Token', get: function (b) { return b.tableLabel || b.token || ''; } },
      { label: 'Food', get: function (b) { return C.R(b.totals.foodGross).toFixed(2); } },
      { label: 'Liquor (no GST)', get: function (b) { return C.R(b.totals.liquorGross).toFixed(2); } },
      { label: 'Discount', get: function (b) { return C.R(b.totals.discount).toFixed(2); } },
      { label: 'Service charge', get: function (b) { return C.R(b.totals.serviceCharge).toFixed(2); } },
      { label: 'Taxable', get: function (b) { return C.R(b.totals.taxableBase).toFixed(2); } },
      { label: 'CGST', get: function (b) { return C.R(b.totals.cgst).toFixed(2); } },
      { label: 'SGST', get: function (b) { return C.R(b.totals.sgst).toFixed(2); } },
      { label: 'Round off', get: function (b) { return C.R(b.totals.roundOff).toFixed(2); } },
      { label: 'Total', get: function (b) { return C.R(b.totals.grand).toFixed(2); } },
      { label: 'Status', key: 'status' },
      { label: 'Cancel reason', get: function (b) { return b.cancelReason || ''; } },
      { label: 'Correction of', get: function (b) { return b.correctionOf || ''; } },
      { label: 'Paid by', get: function (b) { return (b.payments || []).map(function (p) { return p.mode + ' ' + C.R(p.amountPaise).toFixed(2) + (p.ref ? ' #' + p.ref : ''); }).join(' + '); } },
      { label: 'Staff', get: function (b) { var s = d.staff.filter(function (x) { return x.id === b.staffId; })[0]; return s ? s.name : ''; } },
      { label: 'Device', key: 'deviceCode' }
    ]);
    C.download('dhandho-bills-' + C.dayKey() + '.csv', csv);
    global.DR.toast(T('Bill file download ho gayi'), 'good');
  }

  function exportItems() {
    var d = C.db();
    var rows = [];
    d.bills.forEach(function (b) {
      b.lines.forEach(function (l) {
        rows.push({
          no: b.no, day: b.day, time: C.hhmm(b.createdAt), status: b.status,
          name: l.name, qty: C.qtyText(l.qtyMilli), uom: l.uom, variant: l.variant,
          type: l.lineType, unit: C.R(l.unitPaise).toFixed(2),
          amount: C.R(l.amountPaise).toFixed(2), value: C.R(l.valuePaise).toFixed(2)
        });
      });
    });
    var csv = C.toCSV(rows, [
      { label: 'Bill No', key: 'no' }, { label: 'Day', key: 'day' }, { label: 'Time', key: 'time' },
      { label: 'Bill status', key: 'status' }, { label: 'Item', key: 'name' },
      { label: 'Qty', key: 'qty' }, { label: 'Unit', key: 'uom' }, { label: 'Variant', key: 'variant' },
      { label: 'Line type', key: 'type' }, { label: 'Rate', key: 'unit' },
      { label: 'Charged', key: 'amount' }, { label: 'Value', key: 'value' }
    ]);
    C.download('dhandho-items-' + C.dayKey() + '.csv', csv);
    global.DR.toast(T('Item file download ho gayi'), 'good');
  }

  function exportAll() {
    C.download('dhandho-backup-' + C.dayKey() + '.json', JSON.stringify(C.db(), null, 1), 'application/json');
    global.DR.toast(T('Poora backup download ho gaya'), 'good');
  }

  global.DRSetup = { exportBills: exportBills, exportItems: exportItems, exportAll: exportAll, editItem: editItem };

  global.DR.register('setup', setupView);
  global.DR.register('menu', menuView);
  global.DR.register('settings', settingsView);
})(window);
