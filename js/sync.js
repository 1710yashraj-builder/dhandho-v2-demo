/* ============================================================
   DHANDHO RESTAURANT — cloud sync
   Local-first stays the truth on the device; this module mirrors it.

   Model:
   - rest_entities = state, one row per entity, last-write-wins by `rev`
     (a monotonic counter this device stamps on every mutation).
   - rest_events   = the append-only audit chain, pushed as-is.
   - Continuous: mutations mark entities dirty -> debounced push;
     other devices arrive via Realtime, with a 20s poll as the net.
   - Offline: everything queues; the moment the network returns it drains.
     Per-device invoice series means parallel offline billing can't collide.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore;
  var T = global.T;

  var client = null;
  var channel = null;
  var pushTimer = null;
  var pollTimer = null;
  var beatTimer = null;
  var pushing = false;
  var pulling = false;

  var KIND_COL = {
    order: 'orders', kot: 'kots', bill: 'bills', item: 'items',
    cat: 'categories', 'table': 'tables', staff: 'staff',
    cash: 'cash', recon: 'recon'
  };
  var CONFIG_KEYS = { setup: 1, fixed: 1, agg: 1 };
  /* Per-device fields that must never travel to other phones.
     pinHash is salted with the device id, so shipping it to a second phone
     hands that phone a lock whose key does not exist anywhere. */
  var SETUP_LOCAL_ONLY = { lite: 1, pinHash: 1, pinDev: 1 };

  function cfg() { return global.DR_CLOUD || { url: '', anonKey: '' }; }
  function available() { return !!(cfg().url && cfg().anonKey); }
  function cl() { return C.db().cloud; }
  function joined() { return available() && cl().joined && cl().enabled; }
  function myCode() { return C.db().device.code; }

  function getClient() {
    if (client || !available()) return client;
    client = global.supabase.createClient(cfg().url, cfg().anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /* Two "devices" in one browser (drill mode ?as=X) must not share a
           session — each gets its own auth storage bucket. */
        storageKey: 'dhr-auth' + (C.storeSuffix ? ':' + C.storeSuffix : '')
      },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    return client;
  }

  function ensureAuth() {
    var c = getClient();
    if (!c) return Promise.reject(new Error('cloud not configured'));
    return c.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return r.data.session.user.id;
      return c.auth.signInAnonymously().then(function (r2) {
        if (r2.error) throw r2.error;
        return r2.data.user.id;
      });
    });
  }

  /* --------------------------------------------------------
     Dirty tracking
     -------------------------------------------------------- */
  function nextRev() {
    var d = C.db();
    d.revCounter = (d.revCounter || 0) + 1;
    return d.revCounter;
  }

  function resolveEntity(kind, id) {
    var d = C.db();
    if (kind === 'config') {
      var src = d[id];
      if (!src) return null;
      if (id === 'setup') {
        var copy = {};
        Object.keys(src).forEach(function (k) { if (!SETUP_LOCAL_ONLY[k]) copy[k] = src[k]; });
        return copy;
      }
      return src;
    }
    var col = d[KIND_COL[kind]];
    if (!col) return null;
    for (var i = 0; i < col.length; i++) if (col[i].id === id) return col[i];
    return null;
  }

  function mark(kind, id) {
    var d = C.db();
    if (!available()) return;
    var obj = resolveEntity(kind, id);
    var rev = nextRev();
    if (obj && kind !== 'config') obj._rev = rev;
    if (!d.cloud.dirty) d.cloud.dirty = {};
    d.cloud.dirty[kind + '|' + id] = rev;
    C.save();
    schedulePush();
  }

  /* Config fingerprints as last pushed. Comparing them on every save costs a
     JSON.stringify of three small objects and catches every settings edit,
     wherever it was made. */
  var cfgSeen = null;

  function cfgPrint() {
    var out = {};
    Object.keys(CONFIG_KEYS).forEach(function (k) {
      var v = resolveEntity('config', k);
      out[k] = v ? JSON.stringify(v) : '';
    });
    return out;
  }

  function noteLocalSave() {
    if (!joined()) return;
    var now = cfgPrint();
    if (!cfgSeen) { cfgSeen = now; return; }
    Object.keys(now).forEach(function (k) {
      if (now[k] !== cfgSeen[k]) mark('config', k);
    });
    cfgSeen = now;
  }

  function markAll() {
    var d = C.db();
    Object.keys(KIND_COL).forEach(function (kind) {
      (d[KIND_COL[kind]] || []).forEach(function (e) { mark(kind, e.id); });
    });
    Object.keys(CONFIG_KEYS).forEach(function (k) { mark('config', k); });
  }

  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      push();
    }, 700);
  }

  /* --------------------------------------------------------
     Push
     -------------------------------------------------------- */
  function push() {
    var d = C.db();
    if (!joined() || !navigator.onLine || pushing) return Promise.resolve();
    var dirty = d.cloud.dirty || {};
    var keys = Object.keys(dirty);
    var evFrom = d.cloud.lastEventSeqPushed || 0;
    var events = d.events.filter(function (e) { return e.seq > evFrom; });
    if (!keys.length && !events.length) return Promise.resolve();

    pushing = true;
    var snapshot = {};
    var rows = [];
    keys.forEach(function (k) {
      snapshot[k] = dirty[k];
      var kind = k.split('|')[0], id = k.slice(kind.length + 1);
      var doc = resolveEntity(kind, id);
      if (!doc) return;
      rows.push({
        restaurant_id: d.cloud.restaurantId,
        kind: kind, entity_id: id,
        rev: dirty[k], dev_code: myCode(),
        /* updated_at is deliberately not sent: a trigger stamps it from the
           server clock, so one phone with a wrong date cannot push a row
           into the future and make every other phone skip past it. */
        doc: doc
      });
    });
    var evRows = events.map(function (e) {
      return {
        restaurant_id: d.cloud.restaurantId,
        dev_code: myCode(), seq: e.seq, ts: e.ts, type: e.type,
        by_staff: e.by, prev: e.prev, hash: e.hash, data: e.data
      };
    });

    var c = getClient();
    var p = Promise.resolve();
    if (rows.length) {
      p = p.then(function () {
        return c.from('rest_entities')
          .upsert(rows, { onConflict: 'restaurant_id,kind,entity_id' })
          .then(function (r) { if (r.error) throw r.error; });
      });
    }
    if (evRows.length) {
      p = p.then(function () {
        return c.from('rest_events')
          .upsert(evRows, { onConflict: 'restaurant_id,dev_code,seq', ignoreDuplicates: true })
          .then(function (r) { if (r.error) throw r.error; });
      });
    }
    return p.then(function () {
      var dd = C.db();
      Object.keys(snapshot).forEach(function (k) {
        if (dd.cloud.dirty && dd.cloud.dirty[k] === snapshot[k]) delete dd.cloud.dirty[k];
      });
      if (events.length) {
        dd.cloud.lastEventSeqPushed = Math.max(evFrom, events[events.length - 1].seq);
      }
      dd.cloud.lastPushAt = C.now();
      dd.cloud.lastError = null;
      C.save();
      pushing = false;
      if (Object.keys(dd.cloud.dirty || {}).length) schedulePush();
    }).catch(function (e) {
      pushing = false;
      var dd = C.db();
      dd.cloud.lastError = String(e.message || e);
      C.save();
    });
  }

  /* --------------------------------------------------------
     Pull + apply
     -------------------------------------------------------- */
  /* restore=true is used only by the first pull after a join, when local
     storage is empty by definition. Without it the echo-skip below would
     throw away every row this device once wrote itself -- i.e. a restored
     phone would come back missing exactly its own bills. */
  function applyRow(row, restore) {
    var d = C.db();
    if (!restore && row.dev_code === myCode()) return false;  /* our own echo */
    if (row.kind === 'config') {
      if (!CONFIG_KEYS[row.entity_id]) return false;
      var target = d[row.entity_id];
      Object.keys(row.doc).forEach(function (k) {
        if (row.entity_id === 'setup' && SETUP_LOCAL_ONLY[k]) return;
        target[k] = row.doc[k];
      });
      /* Record what we just accepted, so the save that follows does not read
         another phone's edit as our own and push it straight back -- which
         would have the two phones answering each other forever. */
      if (cfgSeen) {
        var fresh = resolveEntity('config', row.entity_id);
        cfgSeen[row.entity_id] = fresh ? JSON.stringify(fresh) : '';
      }
      return true;
    }
    var colName = KIND_COL[row.kind];
    if (!colName) return false;
    var col = d[colName];
    for (var i = 0; i < col.length; i++) {
      if (col[i].id === row.entity_id) {
        /* Last-write-wins by revision: never let an older remote copy
           clobber a newer local edit. */
        if ((col[i]._rev || 0) > row.rev) return false;
        col[i] = row.doc;
        return true;
      }
    }
    col.push(row.doc);
    return true;
  }

  var EPOCH = '1970-01-01T00:00:00Z';

  /* Rewind a server timestamp by a second so rows written in the same instant
     are never straddled by the cursor. */
  function backOff(ts) {
    var t = Date.parse(ts);
    if (!t) return EPOCH;
    return new Date(t - 1000).toISOString();
  }

  /* "GWV/2627/00042" -> 42. Anything unparseable counts as 0. */
  function billSeq(no) {
    var m = /\/(\d+)$/.exec(String(no || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  var repaintTimer = null;
  function requestRepaint() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(function () {
      repaintTimer = null;
      if (global.DR && global.DR.onRemoteApplied) global.DR.onRemoteApplied();
    }, 350);
  }

  function pull(opts) {
    var d = C.db();
    if (!joined() || !navigator.onLine || pulling) return Promise.resolve(0);
    var restore = !!(opts && opts.restore);
    pulling = true;
    /* The cursor is a server timestamp, not a row id. An upsert keeps its id,
       so an id cursor could only ever deliver brand-new rows and silently
       skipped every EDIT -- a changed price, a settled bill, a ready KOT --
       leaving all of them dependent on the websocket alone. */
    var cursor = restore ? EPOCH : (d.cloud.lastEntityMark || EPOCH);
    var applied = 0, maxRev = 0, maxMyBill = 0, newest = cursor;
    function page() {
      return getClient().from('rest_entities')
        .select('*')
        .eq('restaurant_id', d.cloud.restaurantId)
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(500)
        .then(function (r) {
          if (r.error) throw r.error;
          var rows = r.data || [];
          rows.forEach(function (row) {
            if (applyRow(row, restore)) applied++;
            if (row.rev > maxRev) maxRev = row.rev;
            /* Never reissue an invoice number this device already used. */
            if (restore && row.kind === 'bill' && row.dev_code === myCode()) {
              var n = billSeq(row.doc && row.doc.no);
              if (n > maxMyBill) maxMyBill = n;
            }
            if (row.updated_at > newest) newest = row.updated_at;
          });
          if (rows.length === 500) { cursor = newest; return page(); }
        });
    }
    return page().then(function () {
      var dd = C.db();
      /* Local edits made after a restore must outrank everything already
         in the cloud, or last-write-wins would quietly discard them. */
      if (maxRev > (dd.revCounter || 0)) dd.revCounter = maxRev;
      if (maxMyBill > (dd.counters.bill || 0)) dd.counters.bill = maxMyBill;
      /* Step back a second: two rows can share a timestamp, and re-applying
         a row we already have is free (last-write-wins), while missing one
         is a bill nobody sees. */
      dd.cloud.lastEntityMark = backOff(newest);
      dd.cloud.lastPullAt = C.now();
      dd.cloud.lastError = null;
      C.save();
      pulling = false;
      if (applied) requestRepaint();
      return applied;
    }).catch(function (e) {
      pulling = false;
      var dd = C.db();
      dd.cloud.lastError = String(e.message || e);
      C.save();
      return 0;
    });
  }

  /* The ledger is what makes "kaun sa item cancel hua" answerable. Kept
     only on the phone, a wipe would erase it -- which is exactly what
     someone covering a theft would do. The server refuses deletes, so a
     restored phone pulls the record back and the history survives the
     device. Capped so a year-old shop does not choke a 4GB handset. */
  var PAST_EVENT_CAP = 5000;

  function pullEvents() {
    var d = C.db();
    if (!joined() || !navigator.onLine) return Promise.resolve(0);
    return getClient().from('rest_events')
      .select('dev_code,seq,ts,type,by_staff,prev,hash,data')
      .eq('restaurant_id', d.cloud.restaurantId)
      .order('id', { ascending: false })
      .limit(PAST_EVENT_CAP)
      .then(function (r) {
        if (r.error) throw r.error;
        var rows = (r.data || []).slice().reverse();
        var dd = C.db();
        dd.eventsPast = rows.map(function (e) {
          return { seq: e.seq, ts: Number(e.ts), type: e.type, by: e.by_staff,
                   dev: e.dev_code, prev: e.prev, hash: e.hash, data: e.data || {} };
        });
        C.save(true);
        return dd.eventsPast.length;
      }).catch(function () { return 0; });
  }

  /* --------------------------------------------------------
     Realtime + timers
     -------------------------------------------------------- */
  function startRealtime() {
    var d = C.db();
    if (channel || !joined()) return;
    channel = getClient()
      .channel('rest:' + d.cloud.restaurantId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rest_entities',
        filter: 'restaurant_id=eq.' + d.cloud.restaurantId
      }, function (payload) {
        var row = payload['new'];
        if (!row || row.dev_code === myCode()) return;
        var dd = C.db();
        if (applyRow(row)) {
          /* Leave the poll cursor alone. Realtime can hand us a row out of
             order, and moving the mark forward here would make the poll skip
             anything written just before it. */
          C.save();
          requestRepaint();
        }
      })
      /* Role changes must land while the owner is still holding the phone
         out to the staff member — the 60s heartbeat is too slow to demo. */
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rest_devices',
        filter: 'restaurant_id=eq.' + d.cloud.restaurantId
      }, function () { refreshContext(); })
      .subscribe(function (status) {
        var dd = C.db();
        dd.cloud.realtime = status;
        C.save();
      });
  }
  function stopRealtime() {
    if (channel) { try { getClient().removeChannel(channel); } catch (e) {} channel = null; }
  }

  function refreshContext() {
    if (!joined() || !navigator.onLine) return Promise.resolve();
    return getClient().rpc('rest_get_context', { p_version: C.VERSION }).then(function (r) {
      if (r.error) throw r.error;
      var d = C.db();
      var v = r.data || {};
      if (v.me) {
        var oldRoles = (d.cloud.roles || []).join(',');
        d.cloud.roles = v.me.roles || d.cloud.roles;
        d.cloud.deviceId = v.me.id || d.cloud.deviceId;
        if (oldRoles !== (d.cloud.roles || []).join(',') && global.DR) {
          global.DR.refreshTop();
          if (global.DR.onRolesChanged) global.DR.onRolesChanged();
        }
      }
      if (v.devices) d.cloud.devices = v.devices;
      if (v.restaurant) {
        d.cloud.restaurantName = v.restaurant.name;
        d.cloud.pairCode = v.restaurant.pair_code;
        /* The server sends these to owner devices only — a staff phone
           gets null and must not overwrite what it never had. */
        if (v.restaurant.pair_secret) d.cloud.pairSecret = v.restaurant.pair_secret;
        if (v.restaurant.owner_code) d.cloud.ownerCode = v.restaurant.owner_code;
      }
      C.save();
    }).catch(function () {});
  }

  function start() {
    if (!joined()) return;
    ensureAuth().then(function () {
      startRealtime();
      pull();
      push();
      refreshContext();
      if (!pollTimer) pollTimer = setInterval(function () { pull(); push(); }, 20000);
      if (!beatTimer) beatTimer = setInterval(refreshContext, 60000);
    }).catch(function (e) {
      var d = C.db();
      d.cloud.lastError = 'auth: ' + String(e.message || e);
      C.save();
    });
  }
  function stop() {
    stopRealtime();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  /* --------------------------------------------------------
     Create / join / enable
     -------------------------------------------------------- */
  function createRestaurant(name) {
    return ensureAuth().then(function () {
      return getClient().rpc('rest_create_restaurant', {
        p_name: name || C.db().setup.outletName || 'Restaurant',
        p_dev_code: myCode(),
        p_label: (C.db().setup.outletName || '') + ' — owner',
        p_version: C.VERSION
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      var d = C.db();
      var v = r.data;
      d.cloud.joined = true;
      d.cloud.enabled = true;
      d.cloud.restaurantId = v.restaurant_id;
      d.cloud.deviceId = v.device_id;
      d.cloud.pairCode = v.pair_code;
      d.cloud.pairSecret = v.pair_secret;
      d.cloud.ownerCode = v.owner_code;
      d.cloud.roles = v.roles;
      d.cloud.restaurantName = d.setup.outletName;
      d.cloud.pendingCreate = false;
      C.save(true);
      markAll();
      start();
      return v;
    });
  }

  /* ownerCode is optional: an owner whose phone was wiped types it in and
     comes back with owner rights instead of joining as a plain waiter. */
  function joinRestaurant(code, secret, ownerCode, label) {
    return ensureAuth().then(function () {
      return getClient().rpc('rest_join_restaurant', {
        p_code: String(code).trim(),
        p_secret: String(secret).trim(),
        p_dev_code: myCode(),
        p_label: label || 'Staff phone',
        p_version: C.VERSION,
        p_owner_code: ownerCode ? String(ownerCode).trim() : null
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      var d = C.db();
      var v = r.data;
      /* A joining device adopts the restaurant's state wholesale — its own
         locally-seeded staff/menu would otherwise duplicate the owner's. */
      Object.keys(KIND_COL).forEach(function (k) { d[KIND_COL[k]] = []; });
      d.cloud.dirty = {};
      d.cloud.joined = true;
      d.cloud.enabled = true;
      d.cloud.restaurantId = v.restaurant_id;
      d.cloud.deviceId = v.device_id;
      d.cloud.roles = v.roles;
      d.cloud.restaurantName = v.restaurant_name;
      d.cloud.lastEntityMark = null;              /* pull everything */
      d.setup.done = true;                        /* config arrives via pull */
      /* The server refuses to let two phones share a device code, because
         the code IS the invoice series -- a clash would mean two different
         bills carrying the same legal invoice number. */
      if (v.dev_code && v.dev_code !== d.device.code) {
        d.device.code = v.dev_code;
        d.counters.bill = 0;
      }
      C.save(true);
      return pull({ restore: true }).then(function () {
        start();
        return pullEvents().then(function () { return v; });
      });
    });
  }

  function setEnabled(on) {
    var d = C.db();
    d.cloud.enabled = !!on;
    C.save(true);
    if (on) start(); else stop();
  }

  function setRoles(deviceId, roles) {
    return getClient().rpc('rest_set_roles', { p_device: deviceId, p_roles: roles })
      .then(function (r) {
        if (r.error) throw r.error;
        return refreshContext();
      });
  }

  /* Already paired as a waiter, but this really is the owner's phone. */
  function claimOwner(ownerCode) {
    return getClient().rpc('rest_claim_owner', { p_owner_code: String(ownerCode || '').trim() })
      .then(function (r) {
        if (r.error) throw r.error;
        return refreshContext();
      });
  }

  /* Phone lost, stolen, or the waiter left: cut it off. */
  function forgetDevice(deviceId) {
    return getClient().rpc('rest_forget_device', { p_device: deviceId })
      .then(function (r) {
        if (r.error) throw r.error;
        return refreshContext();
      });
  }

  /* Boot hook: resume an already-joined device; finish a create that was
     queued while offline. */
  function boot() {
    var d = C.db();
    if (!d.cloud) return;
    if (available() && d.cloud.pendingCreate && navigator.onLine) {
      createRestaurant(d.setup.outletName).catch(function () {});
      return;
    }
    if (joined()) start();
    window.addEventListener('online', function () {
      if (joined()) { push(); pull(); }
      else if (available() && C.db().cloud.pendingCreate) {
        createRestaurant(C.db().setup.outletName).catch(function () {});
      }
    });
  }

  global.DRSync = {
    available: available, joined: joined,
    mark: mark, markAll: markAll, noteLocalSave: noteLocalSave,
    push: push, pull: pull, pullEvents: pullEvents,
    createRestaurant: createRestaurant, joinRestaurant: joinRestaurant,
    setEnabled: setEnabled, setRoles: setRoles,
    claimOwner: claimOwner, forgetDevice: forgetDevice,
    refreshContext: refreshContext,
    start: start, stop: stop, boot: boot,
    _applyRow: applyRow, _resolveEntity: resolveEntity   /* exposed for tests */
  };
})(window);
