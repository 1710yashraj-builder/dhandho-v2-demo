/* ============================================================
   DHANDHO RESTAURANT — demo evening
   Fills the app with one plausible night of trade so an owner can see
   what his own screen will look like at 11pm, instead of an empty app.

   Everything it creates is real data through the real code paths — the
   same billing engine, the same hash chain. Nothing is faked for the
   screenshot. It is clearly badged DEMO while it is on.
   ============================================================ */
(function (global) {
  'use strict';

  function pick(arr, n) { return arr[n % arr.length]; }

  function seed() {
    var C = global.DRCore, Ops = global.DROps, D = global.DRData;
    var d = C.db();

    if (!d.setup.done) {
      /* Stand up a whole restaurant first. */
      d.setup.done = true;
      d.setup.outletName = 'Sharma Ji Ka Dhaba';
      d.setup.format = 'restaurant';
      d.setup.gstStatus = 'regular';
      d.setup.gstin = '09AAOCB6680J1Z0';
      d.setup.fssai = '12722016000199';
      d.setup.phone = '9876543210';
      d.setup.address = 'Birhana Road, Kanpur';
      d.setup.upiVpa = 'sharmaji@okaxis';
      d.setup.priceIncludesTax = true;
      d.setup.serviceChargePct = 0;
      d.setup.lang = 'hinglish';
      var built = D.buildPack('north', { catStart: 0 });
      d.categories = built.cats;
      d.items = built.items;
      d.tables = D.buildTables(14, ['Hall', 'AC']);
    }
    d.setup.demo = true;
    d.fixed = { rent: C.P(45000), gas: C.P(18000), salary: C.P(52000), other: C.P(12000), openDays: 30 };

    Ops.ensureSeedStaff();
    var waiters = d.staff.filter(function (s) { return s.role === 'waiter' && !s.spare; });
    var items = d.items.filter(function (i) { return i.active && i.available; });
    if (!items.length) return { ok: false, why: 'no items' };

    var mains = items.filter(function (i) { return i.pricePaise >= 12000; });
    var sides = items.filter(function (i) { return i.pricePaise < 12000; });
    if (!mains.length) mains = items;
    if (!sides.length) sides = items;

    var now = Date.now();
    var made = 0, n = 0;

    /* The business day rolls at 5am. If we simply counted back 5 hours from
       "now", a demo opened at 8am would push half the evening onto YESTERDAY's
       business day — and the owner screen only ever shows today. The result is
       a half-empty dashboard and a "Parcha bina bill: 14" accusation in front
       of the customer. So anchor the whole evening inside today's window. */
    var dayStart = new Date(now);
    if (dayStart.getHours() < 5) dayStart.setDate(dayStart.getDate() - 1);
    dayStart.setHours(5, 0, 0, 0);
    var availMin = Math.floor((now - dayStart.getTime()) / 60000);
    /* Never demand more room than the day has given us. Just after the 5am
       roll there are only minutes available, so the evening compresses rather
       than spilling onto yesterday where the owner screen cannot see it. */
    var span = Math.max(1, Math.min(300, availMin - 1));
    var step = span / 24;
    var lagMs = Math.max(5000, Math.min(1500000, Math.round(step * 0.6 * 60000)));

    /* Belt and braces: at exactly 05:00 the day is zero minutes wide, so clamp
       every timestamp into it. Nothing may land on yesterday or in the future. */
    var dayFloor = dayStart.getTime() + 1000;
    function inDay(ts) { return Math.max(dayFloor, Math.min(now - 500, ts)); }

    /* An evening: 22 settled bills spread across the window. */
    for (n = 0; n < 22; n++) {
      Ops.setStaff(pick(waiters, n).id);
      var minsAgo = span - n * step;                    /* oldest first */
      var when = inDay(now - minsAgo * 60000);

      var type = (n % 7 === 0) ? 'parcel' : 'dine';
      var tbl = d.tables[n % d.tables.length];
      var o = Ops.createOrder(type === 'dine' ? { type: 'dine', tableId: tbl.id } : { type: 'parcel' });
      o.createdAt = when;

      Ops.addLine(o.id, pick(mains, n * 3).id, { qtyMilli: ((n % 2) + 1) * 1000 });
      Ops.addLine(o.id, pick(sides, n * 5).id, { qtyMilli: ((n % 4) + 1) * 1000 });
      if (n % 3 === 0) Ops.addLine(o.id, pick(mains, n * 7 + 1).id, { mods: ['noonion'] });
      if (n % 5 === 0) Ops.addLine(o.id, pick(sides, n * 11).id, { mods: ['spicy'] });
      /* One comped sweet — so the owner card shows a real complimentary value */
      if (n === 9) Ops.addLine(o.id, pick(sides, 2).id, { lineType: 'COMPLIMENTARY' });

      var kot = Ops.fire(o.id);
      if (kot) {
        kot.createdAt = inDay(when + Math.round(lagMs * 0.2));
        kot.status = 'served';
        kot.servedAt = inDay(when + Math.round(lagMs * 0.8));
        kot.day = Ops.businessDay(kot.createdAt);
      }

      var opts = {};
      if (n === 6) { opts.discountPaise = C.P(60); opts.discountReason = 'regular'; }
      if (n === 15) { opts.discountPaise = C.P(120); opts.discountReason = 'complaint'; }

      var bill = Ops.billFromOrder(o.id, opts);
      bill.createdAt = inDay(when + lagMs);
      bill.day = Ops.businessDay(bill.createdAt);
      o.day = bill.day;

      /* Cash-heavy, as a Kanpur dhaba actually is. */
      var mode = (n % 3 === 0) ? 'upi' : 'cash';
      Ops.settle(bill.id, [{
        mode: mode,
        amountPaise: bill.totals.grand,
        ref: mode === 'upi' ? String(1000 + (n * 37) % 9000) : ''
      }]);
      bill.settledAt = inDay(bill.createdAt + 120000);
      made++;
    }

    /* One cancelled bill with a reason — this is what the owner card is for. */
    var oc = Ops.createOrder({ type: 'dine', tableId: d.tables[3].id });
    Ops.addLine(oc.id, mains[1].id, {});
    Ops.fire(oc.id);
    var bc = Ops.billFromOrder(oc.id, {});
    Ops.cancelBill(bc.id, 'wrong_item');

    /* One KOT that never became a bill — the cheapest theft signal there is. */
    var ok2 = Ops.createOrder({ type: 'dine', tableId: d.tables[5].id });
    Ops.addLine(ok2.id, mains[2].id, {});
    Ops.fire(ok2.id);
    ok2.status = 'void';

    /* Tables still running, so the floor is not empty when he looks — and the
       kitchen tickets are aged so the green/amber/red timer is visibly doing
       something instead of every ticket reading "0m". */
    var maxAge = Math.max(1, Math.min(20, availMin - 2));
    [[7, 0.15], [9, 0.45], [11, 0.8]].forEach(function (pair) {
      var i = pair[0];
      var ageMin = Math.max(1, Math.round(maxAge * pair[1]));
      var oo = Ops.createOrder({ type: 'dine', tableId: d.tables[i % d.tables.length].id });
      oo.createdAt = inDay(now - (ageMin + 2) * 60000);
      Ops.addLine(oo.id, pick(mains, i).id, {});
      Ops.addLine(oo.id, pick(sides, i * 3).id, { qtyMilli: 2000 });
      var k = Ops.fire(oo.id);
      if (k) { k.createdAt = inDay(now - ageMin * 60000); k.day = Ops.businessDay(k.createdAt); }
    });

    /* Online orders + a settlement that is short — the reconciliation demo. */
    Ops.quickAggOrder('swiggy', 'SW' + (77120), C.P(485));
    Ops.quickAggOrder('swiggy', 'SW' + (77145), C.P(312));
    Ops.quickAggOrder('zomato', 'ZO' + (55301), C.P(640));
    Ops.quickAggOrder('zomato', 'ZO' + (55318), C.P(228));

    /* Cash that legitimately left the drawer. */
    Ops.addCash('float', C.P(2000));
    Ops.addCash('purchase', C.P(340), 'dahi aur dhaniya');
    Ops.addCash('tip', C.P(200));

    C.logEvent('DEMO_SEED', { bills: made });
    C.save(true);
    return { ok: true, bills: made };
  }

  function clear() {
    var C = global.DRCore;
    C.reset();
  }

  global.DRDemo = { seed: seed, clear: clear };
})(window);
