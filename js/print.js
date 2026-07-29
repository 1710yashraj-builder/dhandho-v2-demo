/* ============================================================
   DHANDHO RESTAURANT — printing
   58mm thermal layout for the bill and the kitchen slip.

   Honesty note (build-standards D3): a web page cannot talk to a
   Bluetooth Classic ESC/POS printer directly. On a real install the
   rep pairs the printer through RawBT and this same markup goes to it.
   In the browser it prints through the normal print dialog and can be
   shared as text on WhatsApp. Nothing here pretends otherwise.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps;

  var STYLE =
    '@page{size:58mm auto;margin:2mm}' +
    'body{margin:0;font-family:"Courier New",monospace;font-size:11px;line-height:1.35;color:#000;background:#fff}' +
    '.r{width:100%;max-width:280px;margin:0 auto;padding:4px}' +
    '.c{text-align:center}.b{font-weight:700}.rt{text-align:right}' +
    '.hr{border-top:1px dashed #000;margin:4px 0}' +
    '.big{font-size:15px;font-weight:700}' +
    '.xl{font-size:19px;font-weight:700}' +
    'table{width:100%;border-collapse:collapse}' +
    'td{padding:1px 0;vertical-align:top;font-size:11px}' +
    '.q{width:30px}.a{width:58px;text-align:right}' +
    '.sm{font-size:9.5px}' +
    '.box{border:1px solid #000;padding:3px;margin:3px 0}';

  function line(ch) { return '<div class="hr"></div>'; }

  function modText(mods) {
    var D = global.DRData;
    return (mods || []).map(function (id) {
      var m = D.MODS.filter(function (x) { return x.id === id; })[0];
      return m ? m.en : id;
    }).join(', ');
  }

  /* ---------------- BILL ---------------- */
  function billHTML(bill) {
    var d = C.db();
    var s = d.setup;
    var t = bill.totals;
    var doc = C.DOC_TITLE[bill.docType].en;
    var staff = d.staff.filter(function (x) { return x.id === bill.staffId; })[0];

    var foodLines = bill.lines.filter(function (l) { return !l.voided && !l.isLiquor; });
    var liqLines = bill.lines.filter(function (l) { return !l.voided && l.isLiquor; });

    function rows(list) {
      return list.map(function (l) {
        var nm = C.esc(l.name) + (l.variant === 'half' ? ' (H)' : '');
        var mt = modText(l.mods);
        var comp = l.lineType !== 'SALE';
        return '<tr><td class="q">' + C.qtyText(l.qtyMilli) + (l.uom !== 'plate' ? l.uom : '') + '</td>' +
          '<td>' + nm + (comp ? ' <b>MUFT</b>' : '') +
          (mt ? '<div class="sm">' + C.esc(mt) + '</div>' : '') + '</td>' +
          '<td class="a">' + (comp ? '0.00' : C.R(l.amountPaise).toFixed(2)) + '</td></tr>';
      }).join('');
    }

    function tot(label, paise, bold) {
      return '<tr><td colspan="2"' + (bold ? ' class="b"' : '') + '>' + label + '</td>' +
        '<td class="a' + (bold ? ' b' : '') + '">' + C.R(paise).toFixed(2) + '</td></tr>';
    }

    var h = '<div class="r">';
    h += '<div class="c big">' + C.esc(s.outletName || 'Restaurant') + '</div>';
    if (s.address) h += '<div class="c sm">' + C.esc(s.address) + '</div>';
    if (s.phone) h += '<div class="c sm">Ph: ' + C.esc(s.phone) + '</div>';
    /* Never print a GSTIN on an unregistered dealer's cash memo — it states a
       registration the document is declaring the shop does not have. */
    if (s.gstin && s.gstStatus !== 'unregistered') h += '<div class="c sm">GSTIN: ' + C.esc(s.gstin) + '</div>';
    /* FSSAI on every bill has been mandatory since 1 Jan 2022. */
    if (s.fssai) h += '<div class="c sm">FSSAI: ' + C.esc(s.fssai) + '</div>';
    h += line();
    h += '<div class="c b">' + doc + '</div>';
    if (bill.correctionOf) h += '<div class="c sm">(Replaces bill ' + C.esc(bill.correctionOf) + ')</div>';
    if (bill.status === 'cancelled') h += '<div class="c b box">*** CANCELLED ***</div>';
    h += line();

    h += '<table>';
    h += '<tr><td colspan="2">Bill: <b>' + C.esc(bill.no) + '</b></td><td class="a sm">' + C.hhmm(bill.createdAt) + '</td></tr>';
    h += '<tr><td colspan="3" class="sm">' + C.dmy(bill.createdAt) +
         (bill.tableLabel ? ' &middot; Table ' + C.esc(bill.tableLabel) : '') +
         (bill.token ? ' &middot; ' + C.esc(bill.token) : '') +
         (staff ? ' &middot; ' + C.esc(staff.name) : '') + '</td></tr>';
    if (bill.platform) h += '<tr><td colspan="3" class="sm">' + C.esc(bill.platform.toUpperCase()) + ' ' + C.esc(bill.platformOrderId) + '</td></tr>';
    h += '</table>';
    h += line();

    h += '<table>' + rows(foodLines) + '</table>';

    if (liqLines.length) {
      h += line();
      h += '<div class="sm b">LIQUOR (outside GST)</div>';
      h += '<table>' + rows(liqLines) + '</table>';
      h += '<table>' + tot('Liquor subtotal', t.liquorGross) + '</table>';
    }

    h += line();
    h += '<table>';
    /* On the inclusive path the gross already contains the tax. Printing it as
       "Subtotal" above the CGST/SGST lines makes the bill fail to add up on its
       face — the first thing a suspicious owner or a CA checks. Print the
       taxable value so taxable + CGST + SGST equals what is charged. */
    if (t.inclusive && t.taxRate && t.tax) {
      h += tot('Taxable value', t.taxableBase);
      h += tot('CGST @ ' + (t.taxRate / 2) + '%', t.cgst);
      h += tot('SGST @ ' + (t.taxRate / 2) + '%', t.sgst);
      if (t.discount) h += tot('Discount', -t.discount);
      if (t.serviceCharge) h += tot('Service charge (voluntary)', t.serviceCharge);
      h += '<tr><td colspan="3" class="sm">(Menu prices include GST)</td></tr>';
    } else {
      h += tot('Subtotal', t.foodGross + t.exemptGross);
      if (t.discount) h += tot('Discount', -t.discount);
      if (t.serviceCharge) h += tot('Service charge (voluntary)', t.serviceCharge);
      if (t.taxRate && t.tax) {
        h += tot('CGST @ ' + (t.taxRate / 2) + '%', t.cgst);
        h += tot('SGST @ ' + (t.taxRate / 2) + '%', t.sgst);
      }
    }
    if (t.liquorNet) h += tot('Liquor', t.liquorNet);
    if (t.roundOff) h += tot('Round off', t.roundOff);
    h += '</table>';
    h += line();
    h += '<table><tr><td colspan="2" class="xl">TOTAL</td><td class="a xl">' + C.R(t.grand).toFixed(2) + '</td></tr></table>';

    if (bill.payments && bill.payments.length) {
      h += line();
      h += '<table>' + bill.payments.map(function (p) {
        return '<tr><td colspan="2">' + p.mode.toUpperCase() + (p.ref ? ' #' + C.esc(p.ref) : '') + '</td>' +
          '<td class="a">' + C.R(p.amountPaise).toFixed(2) + '</td></tr>';
      }).join('') + '</table>';
    }

    /* Composition dealers must carry this exact declaration. */
    if (bill.docType === 'BILL_OF_SUPPLY') {
      h += '<div class="box sm c">' + C.COMPOSITION_NOTE + '</div>';
    }
    if (bill.docType === 'CASH_MEMO') {
      h += '<div class="sm c">Not a tax invoice. No GST charged.</div>';
    }
    if (t.compValue) {
      h += '<div class="sm c">Complimentary value: ' + C.R(t.compValue).toFixed(2) + '</div>';
    }

    h += line();
    h += '<div class="c sm">Dhanyawaad &middot; phir aaiye</div>';
    h += '<div class="c sm">' + C.esc(s.outletName || '') + '</div>';
    h += '</div>';
    return h;
  }

  /* ---------------- KITCHEN SLIP ---------------- */
  function kotHTML(kot) {
    var d = C.db();
    var staff = d.staff.filter(function (x) { return x.id === kot.staffId; })[0];
    var h = '<div class="r">';
    h += '<div class="c xl">' + (kot.tableId ? 'MEZ ' + C.esc(tableLabel(kot.tableId)) : C.esc(kot.token || 'PARCEL')) + '</div>';
    h += '<div class="c sm">Parcha #' + kot.no + ' &middot; ' + C.hhmm(kot.createdAt) + (staff ? ' &middot; ' + C.esc(staff.name) : '') + '</div>';
    /* The FSSAI rule applies where two documents are issued, so it goes on
       the kitchen slip too. */
    if (d.setup.fssai) h += '<div class="c sm">FSSAI: ' + C.esc(d.setup.fssai) + '</div>';
    h += line();
    h += '<table>' + kot.lines.map(function (l) {
      var mt = modText(l.mods);
      return '<tr><td class="q big">' + C.qtyText(l.qtyMilli) + '</td>' +
        '<td class="big">' + C.esc(l.name) + (l.variant === 'half' ? ' (HALF)' : '') +
        (l.lineType !== 'SALE' ? ' [MUFT]' : '') +
        (mt ? '<div class="sm">** ' + C.esc(mt) + '</div>' : '') +
        (l.note ? '<div class="sm">** ' + C.esc(l.note) + '</div>' : '') +
        '</td></tr>';
    }).join('') + '</table>';
    h += line();
    h += '<div class="c sm">' + C.esc(d.setup.outletName || '') + '</div>';
    h += '</div>';
    return h;
  }

  function tableLabel(id) {
    var t = C.db().tables.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : '';
  }

  /* ---------------- Output ---------------- */
  function printHTML(html, title) {
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
    document.body.appendChild(f);
    var doc = f.contentWindow.document;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' +
      C.esc(title || 'Print') + '</title><style>' + STYLE + '</style></head><body>' + html + '</body></html>');
    doc.close();
    setTimeout(function () {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
        global.DR.setPrinterOk(true);
      } catch (e) {
        global.DR.setPrinterOk(false, e.message);
      }
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1500);
    }, 120);
  }

  /* A slip preview that looks like the paper. On a demo this IS the proof —
     the owner sees his own bill, correctly formatted, generated offline.

     It renders inside an iframe on purpose: the receipt stylesheet sets
     `body{...}` for the thermal printer, and injecting that into the page
     would restyle the whole app. The iframe is also exactly what prints,
     so what he sees is what comes out. */
  function preview(html, title, bill) {
    var srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' + STYLE +
      'body{background:#fff}</style></head><body>' + html + '</body></html>';
    var body =
      '<iframe id="pvFrame" title="' + C.esc(title || 'Receipt') + '" ' +
        'style="width:100%;height:48vh;border:0;background:#fff;border-radius:10px" ' +
        'sandbox="allow-same-origin" srcdoc="' + C.esc(srcdoc) + '"></iframe>' +
      '<div class="row gap8 wrap mt14">' +
        '<button class="btn btn-primary grow" id="pvPrint">\u{1F5A8} ' + C.esc(global.T('Print')) + '</button>' +
        (bill ? '<button class="btn grow" id="pvWa">\u{1F4AC} WhatsApp</button>' : '') +
        '<button class="btn btn-ghost" id="pvClose">' + C.esc(global.T('Band karo')) + '</button>' +
      '</div>' +
      (bill ? '<p class="t-xs dimmer mt8">' + C.esc(global.T('Asli install par ye parcha seedhe thermal printer par jaata hai (RawBT).')) + '</p>' : '');

    global.DR.sheet(title, body, function (b) {
      b.querySelector('#pvPrint').onclick = function () { printHTML(html, title); };
      b.querySelector('#pvClose').onclick = global.DR.closeSheet;
      var wa = b.querySelector('#pvWa');
      if (wa) wa.onclick = function () { whatsapp(bill); };
    });
  }

  /* wa.me can pre-address a number OR pre-fill text, never both plus a file.
     So we send a clean text bill — free, works offline-composed, always arrives. */
  function whatsapp(bill) {
    var d = C.db();
    var t = bill.totals;
    /* A cancelled bill must never leave the building looking like a live one. */
    var txt = '*' + (d.setup.outletName || 'Bill') + '*\n' +
      C.DOC_TITLE[bill.docType].en + ' ' + bill.no + '\n' +
      (bill.status === 'cancelled' ? '*** CANCELLED - yeh bill radd ho chuka hai ***\n' : '') +
      C.dmy(bill.createdAt) + ' ' + C.hhmm(bill.createdAt) + '\n' +
      (bill.tableLabel ? 'Table ' + bill.tableLabel + '\n' : '') +
      '-------------------\n' +
      bill.lines.filter(function (l) { return !l.voided; }).map(function (l) {
        return C.qtyText(l.qtyMilli) + ' x ' + l.name + '  ' +
          (l.lineType !== 'SALE' ? 'MUFT' : C.R(l.amountPaise).toFixed(2));
      }).join('\n') +
      '\n-------------------\n' +
      (t.discount ? 'Discount: -' + C.R(t.discount).toFixed(2) + '\n' : '') +
      (t.tax ? 'GST: ' + C.R(t.tax).toFixed(2) + '\n' : '') +
      '*TOTAL: ' + C.R(t.grand).toFixed(2) + '*\n' +
      (d.setup.fssai ? '\nFSSAI: ' + d.setup.fssai : '');

    var phone = (bill.guestPhone || '').replace(/\D/g, '');
    var url = phone
      ? 'https://wa.me/91' + phone + '?text=' + encodeURIComponent(txt)
      : 'https://wa.me/?text=' + encodeURIComponent(txt);
    global.open(url, '_blank');
  }

  /* Firing a KOT must never block the waiter. If a printer is configured we
     send it; if not, the kitchen screen is the truth and we say so. */
  function kot(k) {
    var d = C.db();
    if (d.setup.printerMode === 'thermal') {
      printHTML(kotHTML(k), 'KOT ' + k.no);
    }
    /* Kitchen screen always has it, printer or not. */
  }

  function showKot(k) { preview(kotHTML(k), global.T('Parcha #') + k.no, null); }
  function showBill(b) { preview(billHTML(b), 'Bill ' + b.no, b); }

  global.DRPrint = {
    billHTML: billHTML, kotHTML: kotHTML,
    printHTML: printHTML, preview: preview,
    kot: kot, showKot: showKot, showBill: showBill,
    whatsapp: whatsapp, STYLE: STYLE
  };
})(window);
