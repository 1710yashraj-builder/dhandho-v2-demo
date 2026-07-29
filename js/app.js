/* ============================================================
   DHANDHO RESTAURANT — shell
   Router, sheet, toasts, the status strips that refuse to be ignored,
   lite-mode detection, and the offline plumbing.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps;

  var DR = global.DR = {
    view: 'waiter',
    timers: [],
    sheetOnClose: null,
    /* Owner-PIN session flag. Lives in JS memory on purpose: closing or
       reloading the app locks the Malik screens again. */
    pinOk: false,
    storagePersisted: null
  };

  function pinHashOf(pin) {
    return C.sha256(String(pin) + '|' + C.db().device.id);
  }
  DR.pinHashOf = pinHashOf;

  /* The hash is salted with THIS device's id, so a hash set on another phone
     can never be satisfied here. That used to lock the owner out of his own
     Malik screen the moment he restored onto a new phone -- correct PIN,
     permanent refusal. A PIN belongs to the handset it was set on, so one
     set elsewhere counts as no PIN at all. */
  function pinActive() {
    var d = C.db();
    if (!d.setup.pinHash) return false;
    if (d.setup.pinDev && d.setup.pinDev !== d.device.id) {
      d.setup.pinHash = null;
      d.setup.pinDev = null;
      C.save();
      return false;
    }
    return true;
  }
  DR.pinActive = pinActive;

  /* --------------------------------------------------------
     Device roles — which screens this phone is allowed to show.
     A solo (un-paired) device has every role; a paired staff phone
     has only what the owner gave it. Doctor is always reachable —
     support must work from any phone.
     -------------------------------------------------------- */
  var ROLE_VIEWS = {
    waiter: ['waiter', 'order'],
    kitchen: ['kitchen'],
    cashier: ['cashier', 'waiter', 'order'],
    owner: ['waiter', 'order', 'kitchen', 'cashier', 'owner', 'settings', 'menu']
  };
  DR.allowedViews = function () {
    var d = C.db();
    var roles = (d.cloud && d.cloud.joined)
      ? (d.cloud.roles || ['waiter'])
      : ['waiter', 'kitchen', 'cashier', 'owner'];
    var out = { doctor: 1, setup: 1 };
    roles.forEach(function (r) {
      (ROLE_VIEWS[r] || []).forEach(function (v) { out[v] = 1; });
    });
    return out;
  };

  /* Called by the sync layer when another device's changes land. */
  DR.onRemoteApplied = function () {
    if (['waiter', 'kitchen', 'cashier', 'owner'].indexOf(DR.view) !== -1) DR.go(DR.view);
  };
  DR.onRolesChanged = function () {
    var allowed = DR.allowedViews();
    if (!allowed[DR.view]) DR.go('waiter');
    else DR.refreshTop();
  };

  /* --------------------------------------------------------
     Toast
     -------------------------------------------------------- */
  DR.toast = function (msg, kind, ms) {
    var wrap = C.el('#toaster');
    var n = C.h('div', { class: 'toast glass ' + (kind === 'warn' ? 'tint-amber' : kind === 'bad' ? 'tint-red' : kind === 'good' ? 'tint-green' : 'tint-blue') });
    n.textContent = msg;
    wrap.appendChild(n);
    requestAnimationFrame(function () { n.classList.add('show'); });
    setTimeout(function () {
      n.classList.remove('show');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 260);
    }, ms || 2600);
  };

  /* --------------------------------------------------------
     Sheet (the one modal surface, reused everywhere)
     -------------------------------------------------------- */
  var sheetTimer = null;

  DR.sheet = function (title, html, onOpen, onClose) {
    /* closeSheet schedules a 300ms wipe of the shared sheet body. Every
       "close this one, open the next" flow re-opens inside that window, so
       without cancelling it the new sheet is blanked while on screen. */
    if (sheetTimer) { clearTimeout(sheetTimer); sheetTimer = null; }
    var sheet = C.el('#sheet'), scrim = C.el('#scrim');
    C.el('#sheetTitle').textContent = title || '';
    C.el('#sheetBody').innerHTML = html || '';
    sheet.hidden = false; scrim.hidden = false;
    DR.sheetOnClose = onClose || null;
    /* Wire the buttons SYNCHRONOUSLY. requestAnimationFrame is throttled in
       background tabs and on low-power screens — attaching handlers inside it
       produces a sheet that looks fine and does nothing when tapped. */
    if (onOpen) onOpen(C.el('#sheetBody'));
    requestAnimationFrame(function () {
      sheet.classList.add('show'); scrim.classList.add('show');
      var f = C.el('#sheetBody').querySelector('input,select,textarea,button');
      if (f && !('ontouchstart' in window)) { try { f.focus(); } catch (e) {} }
    });
  };
  DR.closeSheet = function () {
    var sheet = C.el('#sheet'), scrim = C.el('#scrim');
    sheet.classList.remove('show'); scrim.classList.remove('show');
    if (sheetTimer) clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      sheetTimer = null;
      sheet.hidden = true; scrim.hidden = true;
      C.el('#sheetBody').innerHTML = '';
    }, 300);
    if (DR.sheetOnClose) { var f = DR.sheetOnClose; DR.sheetOnClose = null; f(); }
  };

  /* Confirm — never a browser confirm(), which looks like a bug on a phone. */
  DR.confirm = function (title, body, okLabel, onOk, danger) {
    DR.sheet(title,
      '<p class="dim" style="margin-bottom:16px">' + C.esc(body) + '</p>' +
      '<div class="row gap8">' +
        '<button class="btn btn-ghost grow" id="cfNo">' + C.esc(T('Nahi')) + '</button>' +
        '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' grow" id="cfYes">' + C.esc(okLabel || T('Haan')) + '</button>' +
      '</div>',
      function (b) {
        b.querySelector('#cfNo').onclick = DR.closeSheet;
        b.querySelector('#cfYes').onclick = function () { DR.closeSheet(); setTimeout(onOk, 60); };
      });
  };

  /* --------------------------------------------------------
     Status strips — network, printer, battery, unsynced count.
     A red dot on an 84px tile is not a warning. This is.
     -------------------------------------------------------- */
  var battery = null;
  DR.refreshAlerts = function () {
    var bar = C.el('#alertBar');
    var d = C.db();
    var msgs = [];

    if (!d.printer.ok) {
      msgs.push({
        k: 'red',
        t: T('PARCHA NAHI CHHAPA — kitchen ko haath se batao'),
        s: T('Printer se jawab nahi. Har order kitchen screen par bhi dikh raha hai.')
      });
    }
    if (battery && battery.level <= 0.10 && !battery.charging) {
      msgs.push({ k: 'red', t: T('BATTERY 10% se kam — abhi charge lagao'), s: T('Bill phone mein hain. Phone band hua to sync nahi hoga.') });
    } else if (battery && battery.level <= 0.20 && !battery.charging) {
      msgs.push({ k: 'amber', t: T('BATTERY kam hai'), s: T('Charge laga lijiye.') });
    }

    if (!msgs.length) { bar.className = 'hidden'; bar.innerHTML = ''; return; }
    bar.className = '';
    bar.innerHTML = msgs.map(function (m) {
      return '<div class="glass ' + (m.k === 'red' ? 'tint-red' : 'tint-amber') + '" ' +
        'style="margin:0 14px 8px;padding:9px 13px;border-radius:14px" role="alert">' +
        '<div style="font-weight:700;font-size:13px">' + C.esc(m.t) + '</div>' +
        '<div class="t-xs dim">' + C.esc(m.s) + '</div></div>';
    }).join('');
  };

  DR.setPrinterOk = function (ok, err) {
    var d = C.db();
    if (d.printer.ok === ok) return;
    d.printer.ok = ok;
    d.printer.lastError = ok ? null : (err || 'no response');
    if (!ok) d.printer.failCount += 1;
    C.save();
    DR.refreshAlerts();
  };

  /* --------------------------------------------------------
     Top bar
     -------------------------------------------------------- */
  DR.refreshTop = function () {
    var d = C.db();
    C.el('#outletName').textContent = d.setup.outletName || 'Dhandho Restaurant';
    var st = Ops.currentStaff();
    C.el('#btnStaff').innerHTML = '<span aria-hidden="true">&#128100;</span> ' +
      C.esc(st ? st.name.split(' ')[0] : T('Kaun?'));

    /* Tab labels follow the language too. */
    var tabs = { tabWaiter: 'Mez', tabKitchen: 'Rasoi', tabCashier: 'Counter', tabOwner: 'Malik' };
    Object.keys(tabs).forEach(function (id) {
      var e = C.el('#' + id);
      if (e) e.textContent = T(tabs[id]);
    });

    /* Role filtering: hide the tabs this phone was not given. */
    var allowed = DR.allowedViews();
    C.els('#tabbar button').forEach(function (b) {
      b.style.display = allowed[b.dataset.view] ? '' : 'none';
    });
    var gear = C.el('#btnSettings');
    if (gear) gear.style.display = allowed.settings ? '' : 'none';

    var prof = Ops.taxProfile();
    var online = navigator.onLine;
    var meta = [];
    /* Only surface connectivity when it actually matters. "Online" is the
       boring default and it was pushing the document type off the screen —
       an owner reading "TAX INVOI" is not reassuring. */
    if (!online) {
      meta.push('<span class="pill pill-amber" style="padding:1px 7px;font-size:9.5px">' + C.esc(T('Offline — sab chalu')) + '</span>');
    }
    /* The demo label lives in the chrome, not floating over it — a badge that
       covers a real button is worse than no badge. */
    if (d.setup.demo) {
      meta.push('<span class="pill pill-amber" style="padding:1px 7px;font-size:9.5px">DEMO</span>');
    }
    meta.push('<span class="dimmer">' + C.esc(d.setup.lang === 'hi' ? C.DOC_TITLE[prof.doc].hi : C.DOC_TITLE[prof.doc].en) + '</span>');
    C.el('#topMeta').innerHTML = meta.join('');

    C.el('#demoBadge').className = 'demo-badge hidden';
  };

  /* --------------------------------------------------------
     Router
     -------------------------------------------------------- */
  var VIEWS = {};
  DR.register = function (name, fn) { VIEWS[name] = fn; };

  DR.go = function (view, arg) {
    DR.clearTimers();
    /* Role guard: a paired staff phone silently lands on its own home
       screen instead of one it was never given. */
    var allowedNow = DR.allowedViews();
    if (!allowedNow[view]) {
      view = allowedNow.waiter ? 'waiter'
        : allowedNow.kitchen ? 'kitchen'
        : allowedNow.cashier ? 'cashier' : 'doctor';
      arg = undefined;
    }
    /* The owner's numbers are not the waiter's business. If a PIN is set,
       Malik / Settings / Menu ask for it once per app session. */
    var dd = C.db();
    if (pinActive() && !DR.pinOk &&
        (view === 'owner' || view === 'settings' || view === 'menu')) {
      renderPinGate(view, arg);
      return;
    }
    DR.view = view;
    var el = C.el('#screen');
    el.innerHTML = '';
    el.scrollTop = 0;
    C.els('#tabbar button').forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var fn = VIEWS[view];
    if (!fn) { el.innerHTML = '<p class="dim">Screen not found.</p>'; return; }
    try {
      fn(el, arg);
    } catch (err) {
      el.innerHTML = '<div class="glass card tint-red"><h3>' + C.esc(T('Kuch gadbad hui')) + '</h3>' +
        '<p class="t-sm dim mt8">' + C.esc(err.message) + '</p>' +
        '<button class="btn mt14" onclick="DR.go(\'waiter\')">' + C.esc(T('Wapas')) + '</button></div>';
      if (global.console) console.error(err);
    }
    DR.refreshTop();
    DR.refreshAlerts();
  };

  /* The PIN pad. Renders as a full screen (not a sheet — a sheet can be
     swiped away). Correct PIN unlocks for the rest of the session. */
  function renderPinGate(view, arg) {
    DR.view = view;
    var el = C.el('#screen');
    el.scrollTop = 0;
    C.els('#tabbar button').forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var buf = '';
    el.innerHTML =
      '<div class="rise center" style="max-width:340px;margin:40px auto 0">' +
        '<div style="font-size:34px" aria-hidden="true">&#128274;</div>' +
        '<h2 class="mt14">' + C.esc(T('PIN daaliye')) + '</h2>' +
        '<div class="row gap8 mt20" id="pinDots" style="justify-content:center">' +
          [0, 1, 2, 3].map(function () {
            return '<span style="width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);background:transparent"></span>';
          }).join('') +
        '</div>' +
        '<div class="grid g3 gap8 mt20" id="pinKeys">' +
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(function (k) {
            return k === ''
              ? '<span></span>'
              : '<button class="btn btn-lg" data-k="' + k + '">' + k + '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    function paint() {
      C.els('#pinDots span').forEach(function (s, i) {
        s.style.background = i < buf.length ? 'rgba(255,255,255,.9)' : 'transparent';
      });
    }
    C.els('#pinKeys button').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        if (k === '⌫') buf = buf.slice(0, -1);
        else if (buf.length < 4) buf += k;
        paint();
        if (buf.length === 4) {
          if (pinHashOf(buf) === C.db().setup.pinHash) {
            DR.pinOk = true;
            DR.go(view, arg);
          } else {
            buf = '';
            paint();
            DR.toast(T('Galat PIN'), 'bad', 1600);
          }
        }
      };
    });
    DR.refreshTop();
    DR.refreshAlerts();
  }

  DR.every = function (ms, fn) {
    fn();
    var id = setInterval(fn, ms);
    DR.timers.push(id);
    return id;
  };
  DR.clearTimers = function () {
    DR.timers.forEach(clearInterval);
    DR.timers = [];
  };

  /* --------------------------------------------------------
     Staff picker — including renaming a spare slot from the floor
     -------------------------------------------------------- */
  DR.pickStaff = function (after) {
    var d = C.db();
    Ops.ensureSeedStaff();
    var html = '<p class="t-sm dim" style="margin-bottom:12px">' + C.esc(T('Aaj kaun chala raha hai? Har bill par yahi naam jaayega.')) + '</p>' +
      '<div class="grid g2" id="staffGrid">' +
      d.staff.filter(function (s) { return s.active; }).map(function (s) {
        return '<button class="btn btn-lg ' + (s.spare ? 'btn-ghost' : '') + '" data-id="' + s.id + '" ' +
          'style="justify-content:flex-start">' +
          '<span aria-hidden="true">' + (s.role === 'owner' ? '&#128081;' : s.role === 'cashier' ? '&#129534;' : '&#129489;') + '</span>' +
          '<span class="truncate">' + C.esc(s.name) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="t-xs dimmer mt14">' + C.esc(T('Naya ladka aaya hai? "Extra" par der tak dabaiye aur naam badal dijiye.')) + '</p>';

    DR.sheet(T('Kaun hai shift par?'), html, function (b) {
      C.els('[data-id]', b).forEach(function (btn) {
        var id = btn.dataset.id;
        btn.onclick = function () {
          Ops.setStaff(id);
          DR.closeSheet();
          DR.refreshTop();
          if (after) setTimeout(after, 80);
        };
        var press;
        var startRename = function (e) {
          e.preventDefault();
          var s = C.db().staff.filter(function (x) { return x.id === id; })[0];
          var name = prompt(T('Naam likhiye'), s ? s.name : '');
          if (name && name.trim()) {
            Ops.renameStaff(id, name.trim().slice(0, 20));
            DR.closeSheet();
            setTimeout(function () { DR.pickStaff(after); }, 120);
          }
        };
        btn.oncontextmenu = startRename;
        btn.ontouchstart = function () { press = setTimeout(function () { startRename({ preventDefault: function () {} }); }, 650); };
        btn.ontouchend = function () { clearTimeout(press); };
        btn.ontouchmove = function () { clearTimeout(press); };
      });
    });
  };

  /* --------------------------------------------------------
     Lite mode — M4 kill switch, defaulted safely
     -------------------------------------------------------- */
  function applyLite() {
    var d = C.db();
    var weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
               (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    var lite = d.setup.lite === true || (d.setup.lite === null && weak);
    if (d.setup.lite === undefined || d.setup.lite === null) {
      d.setup.lite = !!weak;
      lite = !!weak;
      C.save();
    }
    document.documentElement.classList.toggle('lite', !!lite);
  }
  DR.applyLite = applyLite;
  DR.toggleLite = function () {
    var d = C.db();
    d.setup.lite = !d.setup.lite;
    C.save();
    applyLite();
    DR.toast(d.setup.lite ? T('Lite mode chalu — purane phone ke liye') : T('Glass mode chalu'), 'good');
  };

  /* --------------------------------------------------------
     Boot
     -------------------------------------------------------- */
  function boot() {
    C.load();
    applyLite();
    Ops.ensureSeedStaff();

    C.el('#btnHome').onclick = function () { DR.go('waiter'); };
    C.el('#btnStaff').onclick = function () { DR.pickStaff(); };
    C.el('#btnSettings').onclick = function () { DR.go('settings'); };
    var doc = C.el('#btnDoctor');
    if (doc) doc.onclick = function () { DR.go('doctor'); };

    /* Error ring buffer — feeds the doctor screen and Copy-to-Claude. */
    function pushErr(m) {
      try {
        var dd2 = C.db();
        dd2.errors.push({ ts: C.now(), m: String(m).slice(0, 220) });
        if (dd2.errors.length > 20) dd2.errors = dd2.errors.slice(-20);
        C.save();
      } catch (e) {}
    }
    window.addEventListener('error', function (ev) {
      pushErr((ev.message || 'error') + ' @' + String(ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0));
    });
    window.addEventListener('unhandledrejection', function (ev) {
      pushErr('promise: ' + String((ev.reason && ev.reason.message) || ev.reason).slice(0, 180));
    });
    C.el('#sheetClose').onclick = DR.closeSheet;
    C.el('#scrim').onclick = DR.closeSheet;

    C.els('#tabbar button').forEach(function (b) {
      b.onclick = function () { DR.go(b.dataset.view); };
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !C.el('#sheet').hidden) DR.closeSheet();
    });

    window.addEventListener('online', function () { DR.refreshTop(); DR.toast(T('Internet wapas aa gaya'), 'good'); });
    window.addEventListener('offline', function () { DR.refreshTop(); DR.toast(T('Internet gaya — sab kuch chalta rahega'), 'warn', 4000); });

    /* Ask the browser to protect our storage from automatic eviction.
       Without this, Android can silently wipe localStorage under storage
       pressure — which for a billing app means wiping the books. */
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function (granted) {
        DR.storagePersisted = granted;
      }).catch(function () {});
    }

    if (navigator.getBattery) {
      navigator.getBattery().then(function (b) {
        battery = b;
        ['levelchange', 'chargingchange'].forEach(function (ev) {
          b.addEventListener(ev, DR.refreshAlerts);
        });
        DR.refreshAlerts();
      }).catch(function () {});
    }

    /* Service worker only where it can actually work (needs http/https).
       ?nosw=1 skips it — a cache-first worker serving yesterday's JS is the
       single biggest time-waster when testing a change. */
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 &&
        location.search.indexOf('nosw=1') === -1) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    } else if (location.search.indexOf('nosw=1') !== -1 && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { r.unregister(); });
      }).catch(function () {});
      if (global.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });
    }

    if (global.DRSync) global.DRSync.boot();

    var d = C.db();
    if (!d.setup.done) { DR.go('setup'); return; }
    if (!d.session.staffId) { DR.go('waiter'); DR.pickStaff(); return; }
    DR.go('waiter');
  }

  /* Screens register themselves in the scripts after this one, so never
     boot synchronously — give them a turn of the event loop first. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})(window);
