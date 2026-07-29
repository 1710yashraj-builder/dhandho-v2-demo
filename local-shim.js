/* Routes the app's /api/* calls to the in-browser engine instead of a server.
   The UI code is byte-identical to the one that talks to the real backend —
   only the transport changes, which is exactly how the Flutter app will work
   offline. */
(function () {
  'use strict';
  var realFetch = window.fetch.bind(window);

  function ready() {
    return window.DhandhoLocal.boot();
  }
  var booted = ready();

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') !== 0) return realFetch(input, init);

    var path = url.slice(4);
    var qs = {};
    var q = path.indexOf('?');
    if (q !== -1) {
      path.slice(q + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        qs[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      path = path.slice(0, q);
    }
    var body = {};
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) {} }

    return booted.then(function () {
      var A = window.DhandhoLocal.api;
      switch (path) {
        case '/state': return A.state();
        case '/order': return A.order(body.tableId);
        case '/line': return A.addLine(body.orderId, body.menuItemId, body.variant);
        case '/line/qty': return A.setLineQty(body.lineId, body.qtyMilli);
        case '/fire': return A.fire(body.orderId);
        case '/bill': return A.bill(body.orderId, body.mode || 'cash');
        case '/order/cancel': return A.cancel(body.orderId, body.reason);
        case '/kot/ready': return A.kotStatus(body.kotId, 'ready');
        case '/bills': return A.bills();
        case '/suggestion/confirm': return A.confirmCard(body.id);
        case '/suggestion/dismiss': return A.dismissCard(body.id);
        case '/margin': return A.margin(qs.menuItemId);
        case '/reset': return A.reset();
        default: return Promise.reject(new Error('unknown route ' + path));
      }
    }).then(function (value) {
      return {
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(value); },
        text: function () { return Promise.resolve(JSON.stringify(value)); },
      };
    }).catch(function (err) {
      return {
        ok: false,
        status: 400,
        json: function () { return Promise.resolve({ error: String(err.message || err) }); },
        text: function () { return Promise.resolve(String(err.message || err)); },
      };
    });
  };
})();
