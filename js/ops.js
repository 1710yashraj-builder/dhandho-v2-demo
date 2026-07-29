/* ============================================================
   DHANDHO RESTAURANT — operations
   Orders, KOTs, bills, payments, cash drawer, day close, reports.

   RULE: every rupee in this app is computed in this file. No screen
   does its own arithmetic. That is why two screens can never disagree.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore;
  var D = global.DRData;

  /* Tell the sync layer an entity changed. No-op when cloud is absent. */
  function M(kind, id) {
    if (global.DRSync) global.DRSync.mark(kind, id);
  }

  /* Restaurants run past midnight. The business day rolls at 5am, so a
     1:10am bill belongs to last night's takings — which is what the owner
     counts and what the staff remember. */
  var DAY_ROLL_HOURS = 5;
  function businessDay(ts) {
    return C.dayKey((ts || Date.now()) - DAY_ROLL_HOURS * 3600 * 1000);
  }

  /* --------------------------------------------------------
     Session / staff
     -------------------------------------------------------- */
  function ensureSeedStaff() {
    var d = C.db();
    if (!d.staff.length) {
      d.staff = [
        { id: C.uid('S'), name: 'Owner', role: 'owner', active: true },
        { id: C.uid('S'), name: 'Waiter 1', role: 'waiter', active: true },
        { id: C.uid('S'), name: 'Waiter 2', role: 'waiter', active: true },
        { id: C.uid('S'), name: 'Counter', role: 'cashier', active: true },
        /* Spare slots, renameable from the waiter's own phone. Two waiters
           call in sick and the nephew is on the floor — that must not need
           the owner, a server, or a settings screen. */
        { id: C.uid('S'), name: 'Extra 1', role: 'waiter', active: true, spare: true },
        { id: C.uid('S'), name: 'Extra 2', role: 'waiter', active: true, spare: true }
      ];
      C.save();
    }
    return d.staff;
  }
  function setStaff(id) {
    var d = C.db();
    d.session.staffId = id;
    C.save();
  }
  function currentStaff() {
    var d = C.db();
    return d.staff.filter(function (s) { return s.id === d.session.staffId; })[0] || null;
  }
  function renameStaff(id, name) {
    var d = C.db(), s = d.staff.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var old = s.name;
    s.name = name; s.spare = false;
    C.logEvent('STAFF_RENAME', { id: id, from: old, to: name });
    C.save();
    M('staff', id);
  }

  /* --------------------------------------------------------
     Menu helpers
     -------------------------------------------------------- */
  function items() { return C.db().items.filter(function (i) { return i.active; }); }
  function itemById(id) { return C.db().items.filter(function (i) { return i.id === id; })[0]; }
  function categories() { return C.db().categories.slice().sort(function (a, b) { return a.sort - b.sort; }); }

  /* Item grid order: what actually sells here, at this hour, first.
     Falls back to menu order until the shop has its own history. */
  function itemsForGrid(catId) {
    var list = items().filter(function (i) { return !catId || i.catId === catId; });
    return list.sort(function (a, b) {
      if (b.sold !== a.sold) return b.sold - a.sold;
      return a.name.localeCompare(b.name);
    });
  }
  function setAvailable(itemId, yes) {
    var it = itemById(itemId);
    if (!it) return;
    it.available = !!yes;
    C.logEvent(yes ? 'ITEM_BACK' : 'ITEM_KHATAM', { itemId: itemId, name: it.name });
    C.save();
    M('item', itemId);
  }

  /* --------------------------------------------------------
     Tokens (parcel / online) — an order with no table still needs a
     name the counter can shout.
     -------------------------------------------------------- */
  function nextToken() {
    var d = C.db(), day = businessDay();
    if (d.session.tokenDay !== day) { d.session.tokenDay = day; d.counters.token = 0; }
    d.counters.token += 1;
    /* Multi-device: prefix with the device letter so two phones never shout
       the same token number ("K1" and "M1" instead of two "P1"s). */
    var prefix = (d.cloud && d.cloud.joined) ? d.device.code.charAt(0) : 'P';
    return prefix + d.counters.token;
  }

  /* --------------------------------------------------------
     Orders
     -------------------------------------------------------- */
  function openOrders() {
    return C.db().orders.filter(function (o) { return o.status === 'open'; });
  }
  function orderForTable(tableId) {
    return openOrders().filter(function (o) { return o.tableId === tableId; })[0] || null;
  }
  function orderById(id) { return C.db().orders.filter(function (o) { return o.id === id; })[0]; }

  function createOrder(opts) {
    var d = C.db();
    var o = {
      id: C.uid('O'),
      type: opts.type || 'dine',            // dine | parcel | delivery | online
      tableId: opts.tableId || null,
      token: (opts.type && opts.type !== 'dine') ? nextToken() : null,
      guestName: opts.guestName || '',
      guestPhone: opts.guestPhone || '',
      platform: opts.platform || null,      // swiggy | zomato | other
      platformOrderId: opts.platformOrderId || '',
      brandId: opts.brandId || null,
      lines: [],
      status: 'open',
      staffId: d.session.staffId,
      createdAt: C.now(),
      day: businessDay()
    };
    d.orders.push(o);
    C.logEvent('ORDER_OPEN', { orderId: o.id, type: o.type, tableId: o.tableId, token: o.token });
    C.save();
    M('order', o.id);
    return o;
  }

  function makeLine(item, opts) {
    opts = opts || {};
    /* "Half" can arrive either as a variant or as a modifier chip. If we honour
       only the variant, the kitchen slip and the bill print "Half" while the
       line keeps the FULL price — the customer is overcharged for a half plate.
       Treat both as the same thing, and consume the chip so it isn't printed twice. */
    var mods = (opts.mods || []).slice();
    var halfChip = mods.indexOf('half') !== -1;
    var half = (opts.variant === 'half' || halfChip) && item.halfPaise > 0;
    if (half && halfChip) mods = mods.filter(function (m) { return m !== 'half'; });
    var unit = half ? item.halfPaise : item.pricePaise;
    var q = opts.qtyMilli || 1000;
    var lineType = opts.lineType || 'SALE';
    return {
      id: C.uid('L'),
      itemId: item.id,
      name: item.name,
      icon: item.icon,
      variant: half ? 'half' : 'full',
      unitPaise: unit,
      qtyMilli: q,
      uom: item.uom,
      mods: mods,
      note: opts.note || '',
      lineType: lineType,
      taxTreatment: item.taxTreatment,
      isLiquor: !!item.isLiquor,
      fired: false,
      kotId: null,
      addedAt: C.now()
    };
  }
  function linePaise(line) {
    if (line.lineType !== 'SALE') return 0;              // comp / staff meal: charged zero
    return C.mulDiv(line.unitPaise, line.qtyMilli, 1000);
  }
  function lineValuePaise(line) {                        // what it WOULD have cost — owner sees comp cost
    return C.mulDiv(line.unitPaise, line.qtyMilli, 1000);
  }

  function addLine(orderId, itemId, opts) {
    var o = orderById(orderId), it = itemById(itemId);
    if (!o || !it) return null;
    /* Same item, same variant, same mods, not yet fired -> bump the quantity
       instead of stacking duplicate rows. Fewer rows = faster kitchen. */
    var key = itemId + '|' + (opts && opts.variant || 'full') + '|' +
              ((opts && opts.mods || []).join(',')) + '|' + (opts && opts.lineType || 'SALE');
    var same = o.lines.filter(function (l) {
      return !l.fired && (l.itemId + '|' + l.variant + '|' + l.mods.join(',') + '|' + l.lineType) === key;
    })[0];
    if (same && it.uom === 'plate') {
      same.qtyMilli += (opts && opts.qtyMilli) || 1000;
      C.save();
      M('order', o.id);
      return same;
    }
    var line = makeLine(it, opts);
    o.lines.push(line);
    C.save();
    M('order', o.id);
    return line;
  }
  function removeLine(orderId, lineId) {
    var o = orderById(orderId);
    if (!o) return false;
    var l = o.lines.filter(function (x) { return x.id === lineId; })[0];
    if (!l) return false;
    if (l.fired) return false;                 // fired to the kitchen = can only be voided, never erased
    o.lines = o.lines.filter(function (x) { return x.id !== lineId; });
    C.save();
    M('order', orderId);
    return true;
  }
  function setLineQty(orderId, lineId, qtyMilli) {
    var o = orderById(orderId);
    if (!o) return;
    var l = o.lines.filter(function (x) { return x.id === lineId; })[0];
    if (!l || l.fired) return;
    l.qtyMilli = Math.max(0, qtyMilli);
    if (l.qtyMilli === 0) removeLine(orderId, lineId);
    C.save();
    M('order', orderId);
  }
  function voidLine(orderId, lineId, reasonId) {
    var o = orderById(orderId);
    if (!o) return;
    var l = o.lines.filter(function (x) { return x.id === lineId; })[0];
    if (!l) return;
    l.voided = true;
    l.voidReason = reasonId;
    l.voidedAt = C.now();
    C.logEvent('LINE_VOID', {
      orderId: orderId, lineId: lineId, name: l.name,
      valuePaise: lineValuePaise(l), reason: reasonId
    });
    C.save();
    M('order', orderId);
  }
  function liveLines(o) {
    return o.lines.filter(function (l) { return !l.voided; });
  }

  /* FIRE — the one action the whole product is built around.
     Everything not yet sent goes to the kitchen as one ticket. */
  function fire(orderId) {
    var d = C.db(), o = orderById(orderId);
    if (!o) return null;
    var fresh = o.lines.filter(function (l) { return !l.fired && !l.voided; });
    if (!fresh.length) return null;

    d.counters.kot += 1;
    var kot = {
      id: C.uid('K'),
      no: d.counters.kot,
      orderId: o.id,
      tableId: o.tableId,
      token: o.token,
      type: o.type,
      lines: fresh.map(function (l) {
        return {
          lineId: l.id, name: l.name, icon: l.icon, variant: l.variant,
          qtyMilli: l.qtyMilli, uom: l.uom, mods: l.mods.slice(),
          note: l.note, lineType: l.lineType
        };
      }),
      status: 'new',                 // new | ready | served
      staffId: d.session.staffId,
      createdAt: C.now(),
      day: businessDay()
    };
    fresh.forEach(function (l) { l.fired = true; l.kotId = kot.id; });
    d.kots.push(kot);
    C.logEvent('KOT_FIRE', { kotId: kot.id, no: kot.no, orderId: o.id, lines: kot.lines.length });
    C.save();
    M('order', o.id);
    M('kot', kot.id);
    return kot;
  }

  function kotsLive() {
    var day = businessDay();
    return C.db().kots.filter(function (k) { return k.day === day && k.status !== 'served'; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
  }
  function setKotStatus(kotId, status) {
    var k = C.db().kots.filter(function (x) { return x.id === kotId; })[0];
    if (!k) return;
    k.status = status;
    if (status === 'ready') k.readyAt = C.now();
    if (status === 'served') k.servedAt = C.now();
    C.logEvent('KOT_' + status.toUpperCase(), { kotId: kotId, no: k.no });
    C.save();
    M('kot', kotId);
  }

  /* --------------------------------------------------------
     BILL MATH — the single source of truth
     -------------------------------------------------------- */
  function taxProfile() {
    var d = C.db();
    return C.GST_PROFILES[d.setup.gstStatus] || C.GST_PROFILES.unregistered;
  }

  /* Takes lines + adjustments, returns every number a bill can show. */
  function computeTotals(lines, opts) {
    opts = opts || {};
    var d = C.db();
    var prof = taxProfile();
    var inclusive = d.setup.priceIncludesTax !== false;

    var foodGross = 0, liquorGross = 0, compValue = 0, exemptGross = 0;
    lines.forEach(function (l) {
      if (l.voided) return;
      var amt = linePaise(l);
      if (l.lineType !== 'SALE') { compValue += lineValuePaise(l); return; }
      if (l.isLiquor || l.taxTreatment === 'ALCOHOL_OUTSIDE_GST') liquorGross += amt;
      else if (l.taxTreatment === 'EXEMPT') exemptGross += amt;
      else foodGross += amt;
    });

    /* A discount can never be negative (that would be a surcharge printed
       under the word "Discount"), and it may spill onto liquor — otherwise a
       discount on a liquor-only bill silently evaporates and the button looks
       broken. */
    var discountBase = foodGross + exemptGross + liquorGross;
    var discount = Math.min(Math.max(0, opts.discountPaise || 0), discountBase);
    var discTaxable = Math.min(discount, foodGross + exemptGross);
    var discLiquor = discount - discTaxable;

    var scPct = Number(d.setup.serviceChargePct) || 0;
    var serviceCharge = opts.serviceChargeOn && scPct > 0
      ? Math.round((foodGross - discTaxable) * scPct / 100) : 0;

    var taxableIn = foodGross - discTaxable + serviceCharge;
    var liquorNet = liquorGross - discLiquor;
    var base, tax, cgst, sgst;

    if (!prof.rate) {
      base = taxableIn; tax = 0; cgst = 0; sgst = 0;
    } else if (inclusive) {
      var sp = C.splitInclusive(taxableIn, prof.rate);
      base = sp.base; tax = sp.tax;
      cgst = Math.round(tax / 2); sgst = tax - cgst;
    } else {
      base = taxableIn;
      tax = Math.round(base * prof.rate / 100);
      cgst = Math.round(tax / 2); sgst = tax - cgst;
    }

    var beforeRound = (inclusive || !prof.rate ? taxableIn : base + tax) + exemptGross + liquorNet;
    var target = Math.round(beforeRound / 100) * 100;          // round to the nearest rupee
    var roundOff = target - beforeRound;
    var grand = target;

    return {
      foodGross: foodGross,
      exemptGross: exemptGross,
      liquorGross: liquorGross,
      liquorNet: liquorNet,
      compValue: compValue,
      discount: discount,
      serviceCharge: serviceCharge,
      serviceChargePct: scPct,
      taxableBase: base,
      taxRate: prof.rate,
      tax: tax, cgst: cgst, sgst: sgst,
      inclusive: inclusive,
      roundOff: roundOff,
      grand: grand,
      docType: prof.doc
    };
  }

  /* --------------------------------------------------------
     Bills
     -------------------------------------------------------- */
  function billById(id) { return C.db().bills.filter(function (b) { return b.id === id; })[0]; }

  function makeBill(lines, meta, opts) {
    var d = C.db();
    /* An invoice number is a legal, consumed resource. Never burn one on an
       empty bill — the series would show a gap nobody can explain. */
    var live = (lines || []).filter(function (l) { return !l.voided; });
    if (!live.length) throw new Error('Bill mein koi item nahi hai');
    var totals = computeTotals(lines, opts || {});
    var no = C.nextBillNo();
    if (!C.seriesValid(no)) {
      /* A bill number that breaks Rule 46(b) must never be issued. */
      throw new Error('Invalid invoice series: ' + no);
    }
    var bill = {
      id: C.uid('B'),
      no: no,
      docType: totals.docType,
      orderId: meta.orderId || null,
      tableLabel: meta.tableLabel || '',
      token: meta.token || null,
      type: meta.type || 'dine',
      platform: meta.platform || null,
      platformOrderId: meta.platformOrderId || '',
      guestName: meta.guestName || '',
      guestPhone: meta.guestPhone || '',
      lines: lines.map(function (l) {
        return {
          id: l.id, itemId: l.itemId, name: l.name, icon: l.icon, variant: l.variant,
          unitPaise: l.unitPaise, qtyMilli: l.qtyMilli, uom: l.uom,
          mods: (l.mods || []).slice(), lineType: l.lineType,
          taxTreatment: l.taxTreatment, isLiquor: !!l.isLiquor,
          amountPaise: linePaise(l), valuePaise: lineValuePaise(l),
          voided: !!l.voided
        };
      }),
      totals: totals,
      discountReason: (opts && opts.discountReason) || null,
      payments: [],
      status: 'unpaid',                       // unpaid | paid | cancelled
      staffId: d.session.staffId,
      deviceCode: d.device.code,
      createdAt: C.now(),
      day: businessDay(),
      correctionOf: meta.correctionOf || null
    };
    d.bills.push(bill);

    /* Sales counters drive the item grid ordering. */
    bill.lines.forEach(function (l) {
      if (l.voided || l.lineType !== 'SALE') return;
      var it = itemById(l.itemId);
      if (it) { it.sold += Math.max(1, Math.round(l.qtyMilli / 1000)); M('item', it.id); }
    });

    C.logEvent('BILL_ISSUE', {
      billId: bill.id, no: bill.no, doc: bill.docType,
      grand: totals.grand, lines: bill.lines.length,
      discount: totals.discount, comp: totals.compValue,
      correctionOf: bill.correctionOf || null
    });
    C.save(true);
    M('bill', bill.id);
    return bill;
  }

  function billFromOrder(orderId, opts) {
    var o = orderById(orderId);
    if (!o) return null;
    var d = C.db();
    var tbl = d.tables.filter(function (t) { return t.id === o.tableId; })[0];
    var bill = makeBill(o.lines, {
      orderId: o.id,
      tableLabel: tbl ? tbl.label : '',
      token: o.token,
      type: o.type,
      platform: o.platform,
      platformOrderId: o.platformOrderId,
      guestName: o.guestName,
      guestPhone: o.guestPhone
    }, opts);
    o.status = 'billed';
    o.billId = bill.id;
    C.save();
    M('order', o.id);
    return bill;
  }

  /* SEEDHA BILL — a bill with no order behind it.
     The counter must be able to bill a walk-in, a phone order, or four
     tables somebody wrote on paper during a power cut. Without this there
     is no way back from a paper relapse, and a POS that cannot bill is
     worse than the pad it replaced. */
  function directBill(lines, opts) {
    return makeBill(lines, { type: (opts && opts.type) || 'parcel', token: nextToken() }, opts);
  }

  function settle(billId, payments) {
    var b = billById(billId);
    if (!b) return null;
    var paid = payments.reduce(function (n, p) { return n + p.amountPaise; }, 0);
    b.payments = payments.map(function (p) {
      return {
        mode: p.mode, amountPaise: p.amountPaise,
        ref: p.ref || '', at: C.now()
      };
    });
    b.paidPaise = paid;
    b.status = 'paid';
    b.settledAt = C.now();
    C.logEvent('BILL_SETTLE', {
      billId: b.id, no: b.no, grand: b.totals.grand, paid: paid,
      modes: b.payments.map(function (p) { return p.mode + ':' + p.amountPaise + (p.ref ? '#' + p.ref : ''); })
    });
    C.save(true);
    M('bill', b.id);
    return b;
  }

  /* A bill is NEVER edited or deleted. It is cancelled with a reason —
     which consumes the number — and a corrected bill is issued fresh.
     That is what CGST Rule 56(8) requires and it is exactly the feature
     at the centre of the tax investigation everyone is reading about. */
  function cancelBill(billId, reasonId, keepOrderClosed) {
    var b = billById(billId);
    if (!b || b.status === 'cancelled') return null;
    var wasPaid = b.status === 'paid';
    b.status = 'cancelled';
    b.cancelReason = reasonId;
    b.cancelledAt = C.now();
    b.refundDuePaise = wasPaid ? (b.paidPaise || 0) : 0;

    /* Put the table back on the floor. Without this the order stays 'billed'
       forever: the table reads "khali", the ticket is in neither counter list,
       and the food that is already cooking can never be billed again. */
    if (!keepOrderClosed && b.orderId) {
      var o = orderById(b.orderId);
      if (o && o.status === 'billed') {
        o.status = 'open';
        o.billId = null;
      }
    }
    C.logEvent('BILL_CANCEL', {
      billId: b.id, no: b.no, grand: b.totals.grand, reason: reasonId,
      wasPaid: wasPaid, refundDue: b.refundDuePaise
    });
    C.save(true);
    M('bill', b.id);
    if (!keepOrderClosed && b.orderId) M('order', b.orderId);
    return b;
  }

  /* Moving a table must move the tickets already in the kitchen too, or the
     kitchen screen and the bill name two different tables. */
  function moveOrder(orderId, tableId) {
    var d = C.db(), o = orderById(orderId);
    if (!o) return null;
    var from = o.tableId;
    o.tableId = tableId;
    d.kots.forEach(function (k) {
      if (k.orderId === orderId && k.status !== 'served') k.tableId = tableId;
    });
    C.logEvent('ORDER_MOVE', { orderId: orderId, from: from, to: tableId });
    C.save(true);
    M('order', orderId);
    d.kots.forEach(function (k) {
      if (k.orderId === orderId && k.status !== 'served') M('kot', k.id);
    });
    return o;
  }

  /* Correcting a bill = cancel + re-issue with the disputed lines removed.
     Both documents survive. The customer at the counter gets a new bill in
     seconds and the owner can see exactly what happened at 10:15pm. */
  function correctBill(billId, keepLineIds, reasonId) {
    var old = billById(billId);
    if (!old) return null;
    var keep = old.lines.filter(function (l) {
      return keepLineIds.indexOf(l.id) !== -1 && !l.voided;
    });
    var wasPaid = old.status === 'paid';
    var paidBefore = old.paidPaise || 0;
    var oldGrand = old.totals.grand;

    cancelBill(billId, reasonId || 'wrong_item', true);
    if (!keep.length) {
      return { cancelled: old, fresh: null, wasPaid: wasPaid, paidBefore: paidBefore, refund: paidBefore };
    }
    /* Carry the original bill's adjustments. Dropping them re-bills the guest
       at full price — striking a line off a discounted bill could make the
       total go UP, in front of the customer. */
    var fresh = makeBill(keep, {
      orderId: old.orderId, tableLabel: old.tableLabel, token: old.token,
      type: old.type, platform: old.platform, platformOrderId: old.platformOrderId,
      guestName: old.guestName, guestPhone: old.guestPhone,
      correctionOf: old.no
    }, {
      discountPaise: old.totals.discount,
      discountReason: old.discountReason,
      serviceChargeOn: old.totals.serviceCharge > 0
    });

    /* Money already collected carries across, so the counter is told exactly
       what to hand back rather than quietly losing the sale from the day. */
    if (wasPaid && paidBefore) {
      var diff = paidBefore - fresh.totals.grand;
      fresh.carriedPaise = paidBefore;
      if (diff >= 0) {
        fresh.payments = (old.payments || []).map(function (p) { return { mode: p.mode, amountPaise: p.amountPaise, ref: p.ref, at: p.at }; });
        fresh.paidPaise = paidBefore;
        fresh.status = 'paid';
        fresh.settledAt = C.now();
        fresh.refundDuePaise = diff;
        C.logEvent('BILL_CORRECT_REFUND', { from: old.no, to: fresh.no, collected: paidBefore, newTotal: fresh.totals.grand, refund: diff });
      }
      C.save(true);
      M('bill', fresh.id);
      return { cancelled: old, fresh: fresh, wasPaid: true, paidBefore: paidBefore, refund: Math.max(0, diff), extraDue: Math.max(0, -diff), oldGrand: oldGrand };
    }
    return { cancelled: old, fresh: fresh, wasPaid: false, paidBefore: 0, refund: 0, extraDue: 0, oldGrand: oldGrand };
  }

  /* Split by items — a family of 14 wants three bills. */
  function splitBill(billId, lineIds) {
    var src = billById(billId);
    if (!src || src.status !== 'unpaid') return null;
    var take = src.lines.filter(function (l) { return lineIds.indexOf(l.id) !== -1; });
    var rest = src.lines.filter(function (l) { return lineIds.indexOf(l.id) === -1; });
    if (!take.length || !rest.length) return null;

    var second = makeBill(take, {
      orderId: src.orderId, tableLabel: src.tableLabel, token: src.token, type: src.type
    }, {});
    src.lines = rest;
    src.totals = computeTotals(rest, {});
    C.logEvent('BILL_SPLIT', { from: src.no, to: second.no, lines: take.length });
    C.save(true);
    M('bill', src.id);
    return second;
  }

  /* --------------------------------------------------------
     Aggregator quick entry — 4 taps, no re-punching the item list.
     Reconciliation needs platform + order id + amount. It does not need
     to know he sold two paneer butter masalas.
     -------------------------------------------------------- */
  function quickAggOrder(platform, platformOrderId, grossPaise) {
    var d = C.db();
    var cfg = d.agg[platform] || d.agg.other;
    var s = C.aggSettlement(grossPaise, cfg);
    var o = createOrder({ type: 'online', platform: platform, platformOrderId: platformOrderId });
    o.aggGrossPaise = grossPaise;
    o.aggSettle = s;
    o.status = 'billed';
    o.section95 = true;              // platform pays the GST under CGST s.9(5)
    C.logEvent('AGG_ORDER', {
      orderId: o.id, platform: platform, ref: platformOrderId,
      gross: grossPaise, net: s.net
    });
    C.save();
    M('order', o.id);
    return { order: o, settle: s };
  }

  /* --------------------------------------------------------
     Cash drawer — without this, day-close variance is a lie
     -------------------------------------------------------- */
  function addCash(reasonId, amountPaise, note) {
    var d = C.db();
    var reason = C.CASH_REASONS.filter(function (r) { return r.id === reasonId; })[0];
    var dir = reason ? reason.dir : 'out';
    var mv = {
      id: C.uid('M'), reason: reasonId, dir: dir,
      amountPaise: Math.abs(amountPaise), note: note || '',
      at: C.now(), day: businessDay(), staffId: d.session.staffId
    };
    d.cash.push(mv);
    C.logEvent('CASH_' + dir.toUpperCase(), { reason: reasonId, amount: mv.amountPaise, note: note || '' });
    C.save();
    M('cash', mv.id);
    return mv;
  }

  /* --------------------------------------------------------
     Reports — all derived, never stored twice
     -------------------------------------------------------- */
  function billsOn(day) {
    day = day || businessDay();
    return C.db().bills.filter(function (b) { return b.day === day; });
  }

  function dayStats(day) {
    day = day || businessDay();
    var d = C.db();
    var all = billsOn(day);
    var paid = all.filter(function (b) { return b.status === 'paid'; });
    var cancelled = all.filter(function (b) { return b.status === 'cancelled'; });

    var sales = 0, tax = 0, liquor = 0, disc = 0, comp = 0, covers = 0;
    var byMode = { cash: 0, upi: 0, card: 0, online: 0, due: 0 };
    var byHour = {};
    var itemCount = {};

    paid.forEach(function (b) {
      sales += b.totals.grand;
      tax += b.totals.tax;
      liquor += b.totals.liquorGross;
      disc += b.totals.discount;
      comp += b.totals.compValue;
      covers += 1;
      var hr = new Date(b.settledAt || b.createdAt).getHours();
      byHour[hr] = (byHour[hr] || 0) + b.totals.grand;
      (b.payments || []).forEach(function (p) {
        if (byMode[p.mode] === undefined) byMode[p.mode] = 0;
        byMode[p.mode] += p.amountPaise;
      });
      b.lines.forEach(function (l) {
        if (l.voided || l.lineType !== 'SALE') return;
        if (!itemCount[l.name]) itemCount[l.name] = { name: l.name, icon: l.icon, qty: 0, amount: 0 };
        itemCount[l.name].qty += l.qtyMilli / 1000;
        itemCount[l.name].amount += l.amountPaise;
      });
    });

    /* Online orders entered the quick way carry their own money. */
    var aggOrders = d.orders.filter(function (o) {
      return o.day === day && o.type === 'online' && o.aggGrossPaise;
    });
    var aggGross = 0, aggNet = 0;
    aggOrders.forEach(function (o) { aggGross += o.aggGrossPaise; aggNet += o.aggSettle.net; });

    var cancelValue = cancelled.reduce(function (n, b) { return n + b.totals.grand; }, 0);

    /* KOTs that never became a bill. The single cheapest theft signal there
       is, and it falls out of the loop for free.
       A table still running is NOT an orphan — food is in the kitchen and the
       bill has not been asked for yet. Counting those would cry wolf every
       night at 9pm and the number would stop meaning anything. */
    var billedOrderIds = {};
    all.forEach(function (b) { if (b.orderId) billedOrderIds[b.orderId] = 1; });
    var orphanKots = d.kots.filter(function (k) {
      if (k.day !== day || billedOrderIds[k.orderId]) return false;
      var ord = d.orders.filter(function (o) { return o.id === k.orderId; })[0];
      if (ord && ord.status === 'open') return false;              /* still on the floor */
      /* An all-complimentary ticket is not a missing bill either. */
      return !(k.lines || []).every(function (l) { return l.lineType !== 'SALE'; });
    });

    var cashIn = 0, cashOut = 0;
    d.cash.filter(function (m) { return m.day === day; }).forEach(function (m) {
      if (m.dir === 'in') cashIn += m.amountPaise; else cashOut += m.amountPaise;
    });

    var top = Object.keys(itemCount).map(function (k) { return itemCount[k]; })
      .sort(function (a, b) { return b.amount - a.amount; });

    return {
      day: day,
      bills: paid.length,
      sales: sales,
      tax: tax,
      liquor: liquor,
      discount: disc,
      comp: comp,
      covers: covers,
      byMode: byMode,
      byHour: byHour,
      top: top,
      cancelled: cancelled.length,
      cancelValue: cancelValue,
      orphanKots: orphanKots.length,
      aggOrders: aggOrders.length,
      aggGross: aggGross,
      aggNet: aggNet,
      aggLost: aggGross - aggNet,
      cashIn: cashIn,
      cashOut: cashOut,
      expectedCash: byMode.cash + cashIn - cashOut,
      avgBill: paid.length ? Math.round(sales / paid.length) : 0
    };
  }

  /* Fixed costs -> what he must do every day just to stand still.
     Gas alone moved Rs 993 in one month this year. */
  function breakEven() {
    var f = C.db().fixed;
    var monthly = (f.rent || 0) + (f.gas || 0) + (f.salary || 0) + (f.other || 0);
    var days = Math.max(1, f.openDays || 30);
    return { monthlyPaise: monthly, perDayPaise: Math.round(monthly / days), days: days };
  }

  function voidLog(day) {
    day = day || businessDay();
    var d = C.db();
    /* Includes the history pulled back from the cloud, so reinstalling the
       app does not quietly clear the day's cancellations. */
    var seen = {};
    return (d.eventsPast || []).concat(d.events).filter(function (e) {
      if (businessDay(e.ts) !== day) return false;
      if (e.type !== 'LINE_VOID' && e.type !== 'BILL_CANCEL') return false;
      if (seen[e.hash]) return false;
      seen[e.hash] = 1;
      return true;
    });
  }

  function closeDay(countedCashPaise) {
    var d = C.db(), day = businessDay();
    var st = dayStats(day);
    var rec = {
      day: day,
      at: C.now(),
      sales: st.sales,
      bills: st.bills,
      expectedCash: st.expectedCash,
      countedCash: countedCashPaise,
      variance: countedCashPaise - st.expectedCash,
      byMode: st.byMode
    };
    d.session.closed[day] = rec;
    C.logEvent('DAY_CLOSE', rec);
    C.save(true);
    return rec;
  }

  /* --------------------------------------------------------
     Reconciliation — match the platform's settlement file against
     what we recorded, and hand him a document he can forward.
     -------------------------------------------------------- */
  function parseSettlement(text) {
    var lines = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var out = [];
    var start = /order/i.test(lines[0]) ? 1 : 0;      // skip a header row if present
    for (var i = start; i < lines.length; i++) {
      var parts = lines[i].split(/[,\t;]/).map(function (s) { return s.trim().replace(/^"|"$/g, ''); });
      if (parts.length < 2) continue;
      var ref = parts[0];
      var amt = parseFloat(String(parts[parts.length - 1]).replace(/[^0-9.\-]/g, ''));
      if (!ref || isNaN(amt)) continue;
      out.push({ ref: ref, receivedPaise: C.P(amt) });
    }
    return out;
  }

  function reconcile(platform, rows) {
    var d = C.db();
    /* Accept raw pasted text as well as parsed rows — the paste path and the
       file path should not be able to diverge. */
    if (typeof rows === 'string') rows = parseSettlement(rows);
    if (!rows || !rows.length) {
      return { id: C.uid('R'), platform: platform, at: C.now(), matched: [], missing: [], extra: [],
               shortfallPaise: 0, countMatched: 0, countMissing: 0, countExtra: 0, empty: true };
    }
    var ours = d.orders.filter(function (o) {
      return o.type === 'online' && o.platform === platform && o.platformOrderId;
    });
    /* Re-running a reconciliation must give the same answer, so clear last
       run's marks first. */
    ours.forEach(function (o) { o.reconciled = false; });
    var byRef = {};
    ours.forEach(function (o) { byRef[String(o.platformOrderId).trim()] = o; });

    var matched = [], missing = [], extra = [], shortfall = 0;
    rows.forEach(function (r) {
      var o = byRef[String(r.ref).trim()];
      if (!o) { extra.push(r); return; }
      var expected = o.aggSettle ? o.aggSettle.net : 0;
      var gap = expected - r.receivedPaise;
      matched.push({ ref: r.ref, expected: expected, received: r.receivedPaise, gap: gap, gross: o.aggGrossPaise });
      if (gap > 100) shortfall += gap;                 // ignore sub-rupee noise
      o.reconciled = true;
    });
    ours.forEach(function (o) {
      if (!o.reconciled) missing.push({ ref: o.platformOrderId, expected: o.aggSettle ? o.aggSettle.net : 0, gross: o.aggGrossPaise });
    });

    var result = {
      id: C.uid('R'), platform: platform, at: C.now(),
      matched: matched, missing: missing, extra: extra,
      shortfallPaise: shortfall,
      countMatched: matched.length, countMissing: missing.length, countExtra: extra.length
    };
    d.recon.push(result);
    C.logEvent('RECON_RUN', {
      platform: platform, matched: matched.length,
      missing: missing.length, shortfall: shortfall
    });
    C.save();
    return result;
  }

  global.DROps = {
    businessDay: businessDay, moveOrder: moveOrder,
    ensureSeedStaff: ensureSeedStaff, setStaff: setStaff, currentStaff: currentStaff, renameStaff: renameStaff,
    items: items, itemById: itemById, categories: categories, itemsForGrid: itemsForGrid, setAvailable: setAvailable,
    nextToken: nextToken,
    openOrders: openOrders, orderForTable: orderForTable, orderById: orderById, createOrder: createOrder,
    addLine: addLine, removeLine: removeLine, setLineQty: setLineQty, voidLine: voidLine, liveLines: liveLines,
    linePaise: linePaise, lineValuePaise: lineValuePaise,
    fire: fire, kotsLive: kotsLive, setKotStatus: setKotStatus,
    taxProfile: taxProfile, computeTotals: computeTotals,
    billById: billById, billFromOrder: billFromOrder, directBill: directBill, makeBill: makeBill,
    settle: settle, cancelBill: cancelBill, correctBill: correctBill, splitBill: splitBill,
    quickAggOrder: quickAggOrder,
    addCash: addCash,
    billsOn: billsOn, dayStats: dayStats, breakEven: breakEven, voidLog: voidLog, closeDay: closeDay,
    parseSettlement: parseSettlement, reconcile: reconcile
  };
})(window);
