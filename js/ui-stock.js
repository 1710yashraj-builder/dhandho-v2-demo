/* ============================================================
   SAAMAAN — ingredient stock, recipes and dish margin.

   This is the one screen that is genuinely NEW in v2, and it is new for a
   reason: it is the thing the old app could not do. v1 knew what was sold.
   It did not know what was CONSUMED, so it could never answer the two
   questions that actually decide whether a dhaba makes money:

     "Aaj raat paneer khatam to nahi ho jaayega?"
     "Ek plate par bachta kitna hai?"

   Both are answered by the v2 engine, not by this file. Every number here
   comes from window.DhandhoLocal.api — the same NestJS services the server
   runs. This screen only draws them.

   Stock is a LEDGER, never a counter: on-hand is the sum of every movement
   in and out. That is why two phones billing offline at the same time can
   both deplete the same paneer and the total still comes out right.
   ============================================================ */
(function (global) {
  'use strict';
  var C = global.DRCore, Ops = global.DROps, DR = global.DR;
  var T = global.T;

  /* Milli units in the engine (1 kg = 1000). Shown to a cook as plain
     numbers — nobody at a counter thinks in thousandths. */
  function qty(milli, unit) {
    var n = (milli || 0) / 1000;
    var s = Math.abs(n) >= 100 ? String(Math.round(n))
          : String(Math.round(n * 100) / 100);
    return s + (unit ? ' ' + unit : '');
  }
  function toMilli(v) {
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 1000) : NaN;
  }

  /* v1 speaks tax treatments; the spine speaks rates. */
  function rateOf(item) {
    if (!item) return 0;
    if (item.taxTreatment === 'GST_18') return 18;
    if (item.taxTreatment === 'GST_5') return 5;
    return 0;
  }

  function engine() {
    return (global.DRSpine && global.DRSpine.boot() || Promise.resolve(false))
      .then(function (ok) {
        return ok && global.DhandhoLocal ? global.DhandhoLocal.api : null;
      });
  }

  /* One place where every engine call reports its failure the same way —
     an owner should never be left staring at a screen that just didn't fill. */
  function fail(e) {
    DR.toast((e && e.message) ? e.message : T('Saamaan ka hisaab abhi nahi khula'), 'bad', 3600);
  }

  /* --------------------------------------------------------
     The screen
     -------------------------------------------------------- */
  function stockView(root) {
    root.innerHTML =
      '<div class="glass card center" style="margin-bottom:12px">' +
        '<p class="dim t-sm">' + C.esc(T('Saamaan ka hisaab khul raha hai…')) + '</p>' +
      '</div>';

    engine().then(function (api) {
      if (!api) {
        root.innerHTML =
          '<div class="glass card tint-amber">' +
            '<b>' + C.esc(T('Saamaan ka hisaab abhi nahi khula')) + '</b>' +
            '<p class="t-xs dim mt8">' + C.esc(T('Billing bilkul chal rahi hai — sirf ye naya hissa nahi khula. App band karke dobara kholiye.')) + '</p>' +
          '</div>';
        return;
      }
      return api.ingredients().then(function (list) { draw(root, api, list); });
    }).catch(function (e) {
      fail(e);
      root.innerHTML = '<div class="glass card tint-red"><b>' + C.esc(T('Kuch gadbad hui')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc((e && e.message) || '') + '</p></div>';
    });
  }

  function draw(root, api, list) {
    var low = list.filter(function (p) {
      return p.lowMarkMilli > 0 && p.stockQtyMilli <= p.lowMarkMilli;
    });

    root.innerHTML =
      /* --- the warning, only when there IS one --- */
      (low.length
        ? '<div class="glass tint-amber card" style="margin-bottom:12px">' +
            '<b class="t-sm">' + C.esc(T('Ye khatam hone wala hai')) + '</b>' +
            '<div class="col gap8 mt8">' +
              low.map(function (p) {
                return '<div class="row-b">' +
                  '<span>' + C.esc(p.name) + ' <span class="t-xs dim">' + C.esc(qty(p.stockQtyMilli, p.unit)) + '</span></span>' +
                  '<button class="btn btn-sm btn-primary" data-fill="' + C.esc(p.id) + '">' + C.esc(T('Stock aaya')) + '</button>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>'
        : '') +

      /* --- the list --- */
      '<div class="glass card" style="margin-bottom:12px">' +
        '<div class="row-b"><b class="t-sm">' + C.esc(T('Saamaan')) + '</b>' +
          '<button class="btn btn-sm" id="skNew">' + C.esc(T('+ Naya saamaan')) + '</button></div>' +
        (list.length
          ? '<div class="col gap8 mt8">' + list.map(function (p) {
              var isLow = p.lowMarkMilli > 0 && p.stockQtyMilli <= p.lowMarkMilli;
              return '<button class="btn" data-item="' + C.esc(p.id) + '" style="justify-content:space-between">' +
                '<span class="col" style="align-items:flex-start">' +
                  '<span>' + C.esc(p.name) + '</span>' +
                  '<span class="t-xs dim">' + C.esc(C.money(p.costPaise) + ' / ' + p.unit) + '</span>' +
                '</span>' +
                '<span class="pill ' + (isLow ? 'pill-amber' : '') + ' mono">' + C.esc(qty(p.stockQtyMilli, p.unit)) + '</span>' +
              '</button>';
            }).join('') + '</div>'
          : '<p class="t-xs dim mt8">' + C.esc(T('Abhi koi saamaan nahi hai. Aata, paneer, tel — jo roz lagta hai wo daal dijiye.')) + '</p>') +
      '</div>' +

      /* --- recipes: the bridge between a dish and the saamaan it eats --- */
      '<div class="glass card" style="margin-bottom:12px">' +
        '<b class="t-sm">' + C.esc(T('Kis dish mein kya lagta hai')) + '</b>' +
        '<p class="t-xs dim mt8">' + C.esc(T('Ek baar bata dijiye — phir har bill par saamaan apne aap kat jaayega, aur ek plate par kitna bachta hai wo bhi dikhega.')) + '</p>' +
        '<button class="btn btn-sm mt8" id="skRecipe">' + C.esc(T('Dish chuniye')) + '</button>' +
      '</div>' +

      '<p class="t-xs dimmer center" style="margin-bottom:20px">' +
        C.esc(T('Har ghatna likhi jaati hai — jo bhi aaya aur gaya, uska poora record rehta hai.')) + '</p>';

    C.els('[data-fill]', root).forEach(function (b) {
      b.onclick = function () { restockSheet(api, findBy(list, b.dataset.fill), root); };
    });
    C.els('[data-item]', root).forEach(function (b) {
      b.onclick = function () { itemSheet(api, findBy(list, b.dataset.item), root); };
    });
    C.el('#skNew').onclick = function () { newIngredientSheet(api, root); };
    C.el('#skRecipe').onclick = function () { pickDishSheet(api, list, root); };
  }

  function findBy(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function reload(root) { if (DR.view === 'stock') stockView(root); }

  /* --------------------------------------------------------
     One saamaan: stock in, reorder line, and why the number is what it is
     -------------------------------------------------------- */
  function itemSheet(api, p, root) {
    if (!p) return;
    DR.sheet(p.name,
      '<div class="row-b">' +
        '<span class="t-xs dim">' + C.esc(T('Abhi hai')) + '</span>' +
        '<b class="mono">' + C.esc(qty(p.stockQtyMilli, p.unit)) + '</b>' +
      '</div>' +
      '<div class="row-b mt8">' +
        '<span class="t-xs dim">' + C.esc(T('Daam')) + '</span>' +
        '<span class="mono">' + C.esc(C.money(p.costPaise) + ' / ' + p.unit) + '</span>' +
      '</div>' +
      '<div class="mt14"><label class="lbl">' + C.esc(T('Itna reh jaaye to batao')) + ' (' + C.esc(p.unit) + ')</label>' +
        '<div class="row gap8">' +
          '<input class="field grow" id="skLow" type="number" inputmode="decimal" step="0.01" value="' + (p.lowMarkMilli / 1000 || 0) + '">' +
          '<button class="btn btn-sm" id="skLowSet">' + C.esc(T('Set')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="row gap8 mt20">' +
        '<button class="btn btn-ghost grow" id="skHist">' + C.esc(T('Aaya-gaya')) + '</button>' +
        '<button class="btn btn-primary grow" id="skIn">' + C.esc(T('Stock aaya')) + '</button>' +
      '</div>',
      function (b) {
        b.querySelector('#skIn').onclick = function () { DR.closeSheet(); setTimeout(function () { restockSheet(api, p, root); }, 120); };
        b.querySelector('#skHist').onclick = function () { DR.closeSheet(); setTimeout(function () { historySheet(api, p); }, 120); };
        b.querySelector('#skLowSet').onclick = function () {
          var m = toMilli(b.querySelector('#skLow').value);
          if (!Number.isFinite(m) || m < 0) { DR.toast(T('Number galat hai'), 'warn'); return; }
          api.setLowMark(p.id, m).then(function () {
            DR.closeSheet();
            DR.toast(T('Set ho gaya'), 'good');
            reload(root);
          }).catch(fail);
        };
      });
  }

  function restockSheet(api, p, root) {
    if (!p) return;
    /* Default the box to twice the reorder line — the amount a shop that
       just ran low almost always buys. He can overwrite it in one tap. */
    var suggest = p.lowMarkMilli > 0 ? (p.lowMarkMilli * 2) / 1000 : '';
    DR.sheet(T('Stock aaya') + ' — ' + p.name,
      '<label class="lbl">' + C.esc(T('Kitna aaya')) + ' (' + C.esc(p.unit) + ')</label>' +
      '<input class="field" id="skQty" type="number" inputmode="decimal" step="0.01" value="' + suggest + '" autofocus>' +
      '<p class="t-xs dim mt8">' + C.esc(T('Abhi hai')) + ' ' + C.esc(qty(p.stockQtyMilli, p.unit)) + '</p>' +
      '<button class="btn btn-primary mt20" id="skAdd" style="width:100%">' + C.esc(T('Jodein')) + '</button>',
      function (b) {
        b.querySelector('#skAdd').onclick = function () {
          var m = toMilli(b.querySelector('#skQty').value);
          if (!Number.isFinite(m) || m <= 0) { DR.toast(T('Kitna aaya, wo likhiye'), 'warn'); return; }
          api.restock(p.id, m).then(function () {
            DR.closeSheet();
            DR.toast(p.name + ' — ' + qty(p.stockQtyMilli + m, p.unit), 'good');
            reload(root);
          }).catch(fail);
        };
      });
  }

  function historySheet(api, p) {
    DR.sheet(T('Aaya-gaya') + ' — ' + p.name, '<p class="dim t-sm">…</p>', function (b) {
      api.stockMoves(p.id, 40).then(function (rows) {
        b.innerHTML = rows.length
          ? '<div class="col gap8">' + rows.map(function (r) {
              var inward = r.deltaMilli > 0;
              return '<div class="row-b">' +
                '<span class="col" style="align-items:flex-start">' +
                  '<span class="' + (inward ? '' : 'dim') + '">' + C.esc(reasonLabel(r.reason)) + '</span>' +
                  '<span class="t-xs dimmer">' + C.esc(C.dmy(r.createdAt) + ' ' + C.hhmm(r.createdAt)) + '</span>' +
                '</span>' +
                '<span class="pill ' + (inward ? 'pill-green' : '') + ' mono">' + (inward ? '+' : '') + C.esc(qty(r.deltaMilli, p.unit)) + '</span>' +
              '</div>';
            }).join('') + '</div>'
          : '<p class="dim t-sm">' + C.esc(T('Abhi kuch aaya-gaya nahi.')) + '</p>';
      }).catch(function (e) { b.innerHTML = '<p class="dim t-sm">' + C.esc((e && e.message) || '') + '</p>'; });
    });
  }

  function reasonLabel(r) {
    if (r === 'sale') return T('Bikri mein laga');
    if (r === 'purchase') return T('Kharida');
    if (r === 'wastage') return T('Kharab hua');
    if (r === 'correction') return T('Sudhaar');
    if (r === 'opening') return T('Shuru mein tha');
    return r || '';
  }

  function newIngredientSheet(api, root) {
    DR.sheet(T('Naya saamaan'),
      '<label class="lbl">' + C.esc(T('Naam')) + '</label>' +
      '<input class="field" id="siName" placeholder="' + C.esc(T('jaise Paneer')) + '">' +
      '<div class="grid g2 mt14">' +
        '<div><label class="lbl">' + C.esc(T('Kaise naapte hain')) + '</label><select class="field" id="siUnit">' +
          [['kg', 'kg'], ['g', 'gram'], ['ltr', 'litre'], ['ml', 'ml'], ['pc', T('piece')]].map(function (u) {
            return '<option value="' + u[0] + '">' + C.esc(u[1]) + '</option>';
          }).join('') +
        '</select></div>' +
        '<div><label class="lbl">' + C.esc(T('Daam per unit')) + '</label>' +
          '<input class="field" id="siCost" type="number" inputmode="decimal" step="0.01" placeholder="0"></div>' +
      '</div>' +
      '<div class="mt14"><label class="lbl">' + C.esc(T('Itna reh jaaye to batao (0 = mat batao)')) + '</label>' +
        '<input class="field" id="siLow" type="number" inputmode="decimal" step="0.01" value="0"></div>' +
      '<button class="btn btn-primary mt20" id="siSave" style="width:100%">' + C.esc(T('Save')) + '</button>',
      function (b) {
        b.querySelector('#siSave').onclick = function () {
          var name = b.querySelector('#siName').value.trim();
          if (!name) { DR.toast(T('Naam likhiye pehle'), 'warn'); return; }
          var lowRaw = toMilli(b.querySelector('#siLow').value);
          api.ingredientCreate({
            name: name,
            unit: b.querySelector('#siUnit').value,
            costPaise: C.P(b.querySelector('#siCost').value),
            lowMarkMilli: Number.isFinite(lowRaw) && lowRaw > 0 ? lowRaw : 0
          }).then(function () {
            DR.closeSheet();
            DR.toast(T('Save ho gaya'), 'good');
            reload(root);
          }).catch(fail);
        };
      });
  }

  /* --------------------------------------------------------
     Recipe: pick one of HIS dishes, say what goes into one plate
     -------------------------------------------------------- */
  function pickDishSheet(api, ingredients, root) {
    if (!ingredients.length) {
      DR.toast(T('Pehle saamaan daaliye — phir dish se joda jaayega'), 'warn', 3600);
      return;
    }
    var items = C.db().items.filter(function (i) { return i.active; });
    if (!items.length) { DR.toast(T('Menu mein abhi koi item nahi hai'), 'warn'); return; }

    DR.sheet(T('Dish chuniye'),
      '<input class="field" id="rdQ" placeholder="' + C.esc(T('Dhoondhiye…')) + '">' +
      '<div class="col gap8 mt14" id="rdList"></div>',
      function (b) {
        function paint() {
          var q = (b.querySelector('#rdQ').value || '').toLowerCase();
          var show = items.filter(function (i) { return !q || i.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 40);
          b.querySelector('#rdList').innerHTML = show.map(function (i) {
            return '<button class="btn" data-dish="' + C.esc(i.id) + '" style="justify-content:space-between">' +
              '<span>' + C.esc(i.name) + '</span><span class="t-xs dim mono">' + C.money(i.pricePaise) + '</span></button>';
          }).join('') || '<p class="t-xs dim">' + C.esc(T('Kuch nahi mila')) + '</p>';
          C.els('[data-dish]', b).forEach(function (btn) {
            btn.onclick = function () {
              var it = Ops.itemById(btn.dataset.dish);
              DR.closeSheet();
              setTimeout(function () { recipeSheet(api, it, ingredients, root); }, 120);
            };
          });
        }
        b.querySelector('#rdQ').oninput = paint;
        paint();
      });
  }

  function recipeSheet(api, item, ingredients, root) {
    if (!item) return;
    if (item.pricePaise <= 0) {
      DR.toast(T('Is dish ka daam pehle daaliye'), 'warn', 3600);
      return;
    }
    /* The dish is matched to the spine BY NAME — the same rule a bill uses
       when it lands there. So this works on a dish that has never been sold. */
    api.dishFor({
      name: item.name,
      pricePaise: item.pricePaise,
      halfPaise: item.halfPaise || 0,
      gstRate: rateOf(item)
    }).then(function (dish) {
      return api.recipeGet(dish.id).then(function (lines) {
        return { dish: dish, lines: lines };
      });
    }).then(function (r) {
      openRecipeEditor(api, item, r.dish, r.lines, ingredients, root);
    }).catch(fail);
  }

  function openRecipeEditor(api, item, dish, lines, ingredients, root) {
    /* Work on a copy — nothing is written until Save is tapped. */
    var draft = lines.map(function (l) { return { productId: l.productId, qtyMilli: l.qtyMilli }; });

    function rowsHtml() {
      if (!draft.length) {
        return '<p class="t-xs dim">' + C.esc(T('Abhi kuch nahi joda.')) + '</p>';
      }
      return draft.map(function (l, idx) {
        var p = findBy(ingredients, l.productId);
        return '<div class="row gap8" style="align-items:center">' +
          '<span class="grow">' + C.esc(p ? p.name : T('hata hua saamaan')) + '</span>' +
          '<input class="field" data-q="' + idx + '" type="number" inputmode="decimal" step="0.001" ' +
            'style="width:96px" value="' + (l.qtyMilli / 1000) + '">' +
          '<span class="t-xs dim" style="width:34px">' + C.esc(p ? p.unit : '') + '</span>' +
          '<button class="btn btn-sm btn-ghost" data-rm="' + idx + '">×</button>' +
        '</div>';
      }).join('');
    }

    DR.sheet(item.name + ' — ' + T('ek plate mein'),
      '<div class="col gap8" id="rcRows">' + rowsHtml() + '</div>' +
      '<div class="row gap8 mt14">' +
        '<select class="field grow" id="rcPick">' +
          ingredients.map(function (p) {
            return '<option value="' + C.esc(p.id) + '">' + C.esc(p.name + ' (' + p.unit + ')') + '</option>';
          }).join('') +
        '</select>' +
        '<button class="btn btn-sm" id="rcAdd">' + C.esc(T('Jodein')) + '</button>' +
      '</div>' +
      '<div class="glass card mt14" id="rcMargin"><p class="t-xs dim">' + C.esc(T('Hisaab lag raha hai…')) + '</p></div>' +
      '<button class="btn btn-primary mt14" id="rcSave" style="width:100%">' + C.esc(T('Save')) + '</button>',
      function (b) {
        function bindRows() {
          b.querySelector('#rcRows').innerHTML = rowsHtml();
          C.els('[data-rm]', b).forEach(function (x) {
            x.onclick = function () { draft.splice(parseInt(x.dataset.rm, 10), 1); bindRows(); };
          });
          C.els('[data-q]', b).forEach(function (x) {
            x.onchange = function () {
              var m = toMilli(x.value);
              draft[parseInt(x.dataset.q, 10)].qtyMilli = Number.isFinite(m) ? m : 0;
            };
          });
        }
        bindRows();

        b.querySelector('#rcAdd').onclick = function () {
          var id = b.querySelector('#rcPick').value;
          if (!id) return;
          for (var i = 0; i < draft.length; i++) {
            if (draft[i].productId === id) { DR.toast(T('Ye pehle se juda hai'), 'warn'); return; }
          }
          draft.push({ productId: id, qtyMilli: 0 });
          bindRows();
        };

        b.querySelector('#rcSave').onclick = function () {
          for (var i = 0; i < draft.length; i++) {
            if (!(draft[i].qtyMilli > 0)) { DR.toast(T('Har saamaan ki maatra 0 se zyada honi chahiye'), 'warn', 3600); return; }
          }
          api.recipeSet(dish.id, draft).then(function () {
            DR.toast(T('Save ho gaya'), 'good');
            showMargin(api, dish, b.querySelector('#rcMargin'));
            reload(root);
          }).catch(fail);
        };

        showMargin(api, dish, b.querySelector('#rcMargin'));
      });
  }

  /* The payoff line: what one plate actually leaves behind. Margin is on
     the NET price — GST is the government's, never the owner's. */
  function showMargin(api, dish, box) {
    if (!box) return;
    api.margin(dish.id).then(function (m) {
      if (!m || !m.costPaise) {
        box.innerHTML = '<p class="t-xs dim">' + C.esc(T('Saamaan aur maatra daaliye — phir dikhega ek plate par kitna bachta hai.')) + '</p>';
        return;
      }
      var pct = m.marginPct;
      box.className = 'glass card mt14 ' + (pct >= 55 ? 'tint-green' : pct >= 35 ? 'tint-amber' : 'tint-red');
      box.innerHTML =
        '<div class="row-b"><span class="t-xs dim">' + C.esc(T('Ek plate par')) + '</span>' +
          '<b class="mono">' + C.money(m.marginPaise) + '</b></div>' +
        '<div class="row gap8 wrap mt8">' +
          '<span class="pill">' + C.esc(T('lagat')) + ' ' + C.money(m.costPaise) + '</span>' +
          '<span class="pill">' + C.esc(T('bina GST')) + ' ' + C.money(m.netPaise) + '</span>' +
          '<span class="pill ' + (pct >= 55 ? 'pill-green' : pct >= 35 ? 'pill-amber' : 'pill-red') + '">' + pct + '%</span>' +
        '</div>' +
        (pct < 35 ? '<p class="t-xs dim mt8">' + C.esc(T('Ye dish bahut kam bacha rahi hai — daam ya maatra dekhiye.')) + '</p>' : '');
    }).catch(function () {
      box.innerHTML = '<p class="t-xs dim">' + C.esc(T('Hisaab abhi nahi lag paaya.')) + '</p>';
    });
  }

  DR.register('stock', stockView);

  /* The owner's home screen asks the engine once for anything running low,
     so he sees it without opening this screen at all. */
  DR.stockLowPeek = function () {
    return engine().then(function (api) { return api ? api.stockLow() : []; })
      .catch(function () { return []; });
  };
})(window);
