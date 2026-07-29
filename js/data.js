/* ============================================================
   DHANDHO RESTAURANT — starter data
   Ready-made menus so a shop is billing within minutes instead of
   typing 150 items. Prices are Kanpur-realistic starting points the
   owner edits; every one of them is meant to be changed.
   ============================================================ */
(function (global) {
  'use strict';

  /* Icon by keyword. A picture on the tile is not decoration — the waiter
     this is built for reads slowly and works fast. Costs nothing, needs no
     photoshoot, works offline. Owner can still add real photos later. */
  var ICON_RULES = [
    [/(chai|tea|cutting)/i, '☕'],
    [/(coffee|cappu|latte|espresso|americano|mocha)/i, '☕'],
    [/(lassi|shake|smoothie|thandai)/i, '🥛'],
    [/(juice|nimbu|lemon|mojito|soda|cold ?drink|pepsi|coke|sprite|thums)/i, '🧃'],
    [/(water|pani|bisleri)/i, '💧'],
    [/(roti|chapati|phulka|tandoori roti)/i, '🫓'],
    [/(naan|kulcha|paratha|lachha)/i, '🧇'],
    [/(rice|chawal|biryani|pulao|fried rice)/i, '🍚'],
    [/(dal|daal|sambar|rasam|kadhi)/i, '🍛'],
    [/(paneer|malai|kofta|matar|mushroom|veg |sabzi|aloo|gobi|bhindi|baingan|chana|rajma|palak)/i, '🍛'],
    [/(chicken|murg|tandoori|tikka|kebab|seekh)/i, '🍗'],
    [/(mutton|gosht|keema|rogan)/i, '🥩'],
    [/(fish|machhli|prawn)/i, '🐟'],
    [/(egg|anda|omelette|bhurji)/i, '🥚'],
    [/(dosa|uttapam|appam)/i, '🥞'],
    [/(idli|vada|medu)/i, '🍙'],
    [/(samosa|kachori|pakoda|pakora|bhajiya|vada pav)/i, '🥟'],
    [/(chowmein|noodle|hakka|manchur|schezwan|momo|spring roll)/i, '🍜'],
    [/(burger|sandwich|toast|club)/i, '🍔'],
    [/(pizza|garlic bread)/i, '🍕'],
    [/(fries|finger chips|wedges)/i, '🍟'],
    [/(pav ?bhaji|bhaji|misal)/i, '🍲'],
    [/(chaat|golgappa|pani ?puri|tikki|papdi|dahi|bhalla)/i, '🥗'],
    [/(barfi|burfi|peda|laddu|ladoo|gulab|jamun|rasgulla|rasmalai|halwa|kaju|soan|mithai|sweet)/i, '🍬'],
    [/(namkeen|mixture|sev|bhujia|dalmoth|papad)/i, '🥜'],
    [/(cake|pastry|muffin|brownie|donut|cookie|biscuit|patty|puff|bread|bun)/i, '🍰'],
    [/(ice ?cream|kulfi|falooda|sundae)/i, '🍨'],
    [/(beer|kingfisher|budweiser|tuborg)/i, '🍺'],
    [/(whisky|whiskey|rum|vodka|gin|old monk|blender|royal stag|peg)/i, '🥃'],
    [/(salad|raita|onion|papad|achar)/i, '🥗'],
    [/(soup|shorba)/i, '🍜'],
    [/(thali|combo|meal)/i, '🍱']
  ];

  function iconFor(name) {
    for (var i = 0; i < ICON_RULES.length; i++) {
      if (ICON_RULES[i][0].test(name)) return ICON_RULES[i][1];
    }
    return '🍽';   // generic plate
  }

  /* Menu packs.
     [name, price, halfPrice(0 = no half), veg(1/0), tax, uom]
     tax: '' = normal (GST_5 / whatever the outlet is), 'L' = liquor (outside GST)
     uom: 'plate' | 'kg' | 'pc' | 'g'
  */
  var PACKS = {
    north: {
      label: 'North Indian / Dhaba',
      labelHi: 'उत्तर भारतीय / ढाबा',
      cats: {
        'Roti / Rice': [
          ['Tandoori Roti', 12, 0, 1], ['Butter Roti', 15, 0, 1], ['Plain Naan', 40, 0, 1],
          ['Butter Naan', 50, 0, 1], ['Garlic Naan', 65, 0, 1], ['Lachha Paratha', 55, 0, 1],
          ['Jeera Rice', 130, 80, 1], ['Steam Rice', 100, 60, 1], ['Veg Pulao', 160, 95, 1]
        ],
        'Dal / Veg': [
          ['Dal Fry', 140, 85, 1], ['Dal Tadka', 160, 95, 1], ['Dal Makhani', 200, 120, 1],
          ['Paneer Butter Masala', 260, 150, 1], ['Shahi Paneer', 250, 145, 1],
          ['Kadhai Paneer', 260, 150, 1], ['Palak Paneer', 240, 140, 1],
          ['Matar Paneer', 220, 130, 1], ['Malai Kofta', 250, 145, 1],
          ['Mix Veg', 190, 110, 1], ['Aloo Jeera', 150, 90, 1], ['Bhindi Masala', 180, 105, 1],
          ['Chana Masala', 170, 100, 1], ['Rajma', 170, 100, 1], ['Aloo Gobi', 170, 100, 1]
        ],
        'Non-Veg': [
          ['Butter Chicken', 340, 200, 0], ['Chicken Curry', 300, 175, 0],
          ['Kadhai Chicken', 320, 185, 0], ['Chicken Tikka (8pc)', 300, 170, 0],
          ['Tandoori Chicken (Half)', 280, 0, 0], ['Chicken Biryani', 260, 155, 0],
          ['Mutton Curry', 420, 250, 0], ['Mutton Rogan Josh', 450, 265, 0],
          ['Egg Curry', 180, 0, 0], ['Seekh Kebab (4pc)', 260, 0, 0]
        ],
        'Starters': [
          ['Paneer Tikka', 280, 165, 1], ['Veg Manchurian', 190, 0, 1],
          ['Hara Bhara Kebab', 210, 0, 1], ['Chilli Paneer', 240, 140, 1],
          ['Papad Masala', 50, 0, 1], ['Roasted Papad', 30, 0, 1],
          ['Green Salad', 90, 0, 1], ['Boondi Raita', 90, 0, 1],
          ['Mix Raita', 100, 0, 1], ['Veg Soup', 110, 0, 1], ['Tomato Soup', 110, 0, 1],
          ['Aloo Tikki (2pc)', 80, 0, 1], ['Veg Spring Roll', 140, 0, 1]
        ],
        'Combo / Thali': [
          ['Veg Thali', 220, 0, 1], ['Special Veg Thali', 300, 0, 1],
          ['Non-Veg Thali', 340, 0, 0], ['Dal Chawal', 130, 0, 1],
          ['Rajma Chawal', 150, 0, 1], ['Chole Chawal', 150, 0, 1]
        ],
        'Meetha': [
          ['Gulab Jamun (2pc)', 70, 0, 1], ['Gajar Halwa', 110, 0, 1],
          ['Rasmalai (2pc)', 100, 0, 1], ['Ice Cream', 80, 0, 1]
        ],
        'Drinks': [
          ['Masala Chai', 20, 0, 1], ['Special Chai', 30, 0, 1],
          ['Sweet Lassi', 70, 0, 1], ['Salted Lassi', 70, 0, 1], ['Mango Lassi', 90, 0, 1],
          ['Fresh Lime Soda', 60, 0, 1], ['Jaljeera', 50, 0, 1],
          ['Cold Drink', 40, 0, 1], ['Mineral Water', 20, 0, 1], ['Buttermilk', 40, 0, 1]
        ]
      }
    },

    cafe: {
      label: 'Cafe',
      labelHi: 'कैफ़े',
      cats: {
        'Coffee': [
          ['Espresso', 90, 0, 1], ['Americano', 120, 0, 1], ['Cappuccino', 150, 0, 1],
          ['Cafe Latte', 160, 0, 1], ['Mocha', 180, 0, 1], ['Cold Coffee', 170, 0, 1],
          ['Iced Americano', 150, 0, 1], ['Hot Chocolate', 170, 0, 1]
        ],
        'Tea': [
          ['Masala Chai', 60, 0, 1], ['Green Tea', 70, 0, 1], ['Lemon Iced Tea', 120, 0, 1],
          ['Peach Iced Tea', 130, 0, 1]
        ],
        'Shakes': [
          ['Oreo Shake', 190, 0, 1], ['Chocolate Shake', 180, 0, 1],
          ['Strawberry Shake', 180, 0, 1], ['Mango Shake', 170, 0, 1], ['Banana Shake', 160, 0, 1]
        ],
        'Food': [
          ['Veg Sandwich', 140, 0, 1], ['Grilled Cheese Sandwich', 170, 0, 1],
          ['Club Sandwich', 200, 0, 1], ['Veg Burger', 150, 0, 1], ['Cheese Burger', 180, 0, 1],
          ['Margherita Pizza', 250, 0, 1], ['Farmhouse Pizza', 320, 0, 1],
          ['French Fries', 130, 0, 1], ['Peri Peri Fries', 160, 0, 1],
          ['Garlic Bread', 150, 0, 1], ['Pasta Alfredo', 260, 0, 1], ['Pasta Arrabbiata', 250, 0, 1],
          ['Maggi Masala', 90, 0, 1], ['Cheese Maggi', 120, 0, 1]
        ],
        'Bakery': [
          ['Chocolate Brownie', 130, 0, 1], ['Choco Lava Cake', 160, 0, 1],
          ['Blueberry Muffin', 110, 0, 1], ['Croissant', 120, 0, 1], ['Red Velvet Pastry', 140, 0, 1]
        ]
      }
    },

    south: {
      label: 'South Indian',
      labelHi: 'दक्षिण भारतीय',
      cats: {
        'Dosa': [
          ['Plain Dosa', 90, 0, 1], ['Masala Dosa', 120, 0, 1], ['Onion Dosa', 130, 0, 1],
          ['Paneer Dosa', 170, 0, 1], ['Cheese Dosa', 160, 0, 1], ['Rava Dosa', 140, 0, 1],
          ['Mysore Masala Dosa', 150, 0, 1]
        ],
        'Idli / Vada': [
          ['Idli (2pc)', 70, 0, 1], ['Medu Vada (2pc)', 80, 0, 1], ['Sambar Vada', 90, 0, 1],
          ['Idli Vada Combo', 110, 0, 1], ['Rava Uttapam', 130, 0, 1], ['Onion Uttapam', 140, 0, 1]
        ],
        'Rice': [
          ['Curd Rice', 110, 0, 1], ['Lemon Rice', 110, 0, 1], ['Sambar Rice', 120, 0, 1],
          ['South Thali', 190, 0, 1]
        ],
        'Drinks': [
          ['Filter Coffee', 50, 0, 1], ['Masala Chai', 20, 0, 1], ['Buttermilk', 40, 0, 1]
        ]
      }
    },

    chinese: {
      label: 'Chinese / Fast Food',
      labelHi: 'चाइनीज़ / फ़ास्ट फ़ूड',
      cats: {
        'Noodles / Rice': [
          ['Veg Chowmein', 110, 70, 1], ['Egg Chowmein', 130, 80, 0], ['Chicken Chowmein', 160, 95, 0],
          ['Hakka Noodles', 130, 80, 1], ['Schezwan Noodles', 150, 90, 1],
          ['Veg Fried Rice', 120, 75, 1], ['Egg Fried Rice', 140, 85, 0], ['Chicken Fried Rice', 170, 100, 0]
        ],
        'Starters': [
          ['Veg Manchurian Dry', 150, 90, 1], ['Veg Manchurian Gravy', 160, 95, 1],
          ['Chilli Paneer Dry', 200, 120, 1], ['Chilli Chicken', 220, 130, 0],
          ['Honey Chilli Potato', 160, 95, 1], ['Spring Roll (4pc)', 130, 0, 1],
          ['Veg Momos (6pc)', 90, 0, 1], ['Steamed Chicken Momos (6pc)', 120, 0, 0],
          ['Fried Momos (6pc)', 120, 0, 1]
        ],
        'Fast Food': [
          ['Veg Burger', 70, 0, 1], ['Cheese Burger', 100, 0, 1], ['French Fries', 90, 0, 1],
          ['Pav Bhaji', 110, 0, 1], ['Vada Pav', 40, 0, 1], ['Samosa (2pc)', 30, 0, 1],
          ['Veg Sandwich', 80, 0, 1], ['Maggi', 60, 0, 1]
        ],
        'Soup / Drinks': [
          ['Veg Manchow Soup', 100, 0, 1], ['Hot & Sour Soup', 100, 0, 1],
          ['Sweet Corn Soup', 100, 0, 1], ['Cold Drink', 40, 0, 1], ['Mineral Water', 20, 0, 1]
        ]
      }
    },

    /* Weight counter — the segment no restaurant POS at our price serves.
       Everything here sells by the kilogram with decimal quantity. */
    mithai: {
      label: 'Mithai / Namkeen (per kg)',
      labelHi: 'मिठाई / नमकीन',
      counter: true,
      cats: {
        'Mithai': [
          ['Kaju Katli', 1200, 0, 1, '', 'kg'], ['Milk Cake', 560, 0, 1, '', 'kg'],
          ['Motichoor Laddu', 520, 0, 1, '', 'kg'], ['Besan Laddu', 480, 0, 1, '', 'kg'],
          ['Gulab Jamun', 460, 0, 1, '', 'kg'], ['Rasgulla', 440, 0, 1, '', 'kg'],
          ['Barfi (Plain)', 500, 0, 1, '', 'kg'], ['Chocolate Barfi', 620, 0, 1, '', 'kg'],
          ['Soan Papdi', 400, 0, 1, '', 'kg'], ['Peda', 520, 0, 1, '', 'kg'],
          ['Gajar Halwa', 480, 0, 1, '', 'kg'], ['Rasmalai (pc)', 40, 0, 1, '', 'pc']
        ],
        'Namkeen': [
          ['Bhujia', 320, 0, 1, '', 'kg'], ['Dalmoth', 340, 0, 1, '', 'kg'],
          ['Khatta Meetha Mixture', 300, 0, 1, '', 'kg'], ['Aloo Bhujia', 320, 0, 1, '', 'kg'],
          ['Moong Dal', 380, 0, 1, '', 'kg'], ['Sev Papdi', 300, 0, 1, '', 'kg'],
          ['Peanut Masala', 360, 0, 1, '', 'kg']
        ],
        'Counter': [
          ['Samosa', 15, 0, 1, '', 'pc'], ['Kachori', 15, 0, 1, '', 'pc'],
          ['Bread Pakoda', 25, 0, 1, '', 'pc'], ['Aloo Tikki', 30, 0, 1, '', 'pc'],
          ['Dahi Bhalla (plate)', 60, 0, 1], ['Chole Bhature (plate)', 90, 0, 1]
        ]
      }
    },

    bakery: {
      label: 'Bakery',
      labelHi: 'बेकरी',
      counter: true,
      cats: {
        'Cakes': [
          ['Chocolate Truffle (per kg)', 900, 0, 1, '', 'kg'],
          ['Black Forest (per kg)', 800, 0, 1, '', 'kg'],
          ['Pineapple (per kg)', 700, 0, 1, '', 'kg'],
          ['Red Velvet (per kg)', 1000, 0, 1, '', 'kg'],
          ['Butterscotch (per kg)', 780, 0, 1, '', 'kg']
        ],
        'Pastry / Snacks': [
          ['Chocolate Pastry', 70, 0, 1, '', 'pc'], ['Pineapple Pastry', 60, 0, 1, '', 'pc'],
          ['Brownie', 80, 0, 1, '', 'pc'], ['Muffin', 50, 0, 1, '', 'pc'],
          ['Veg Puff', 30, 0, 1, '', 'pc'], ['Paneer Puff', 40, 0, 1, '', 'pc'],
          ['Cream Roll', 35, 0, 1, '', 'pc'], ['Donut', 60, 0, 1, '', 'pc']
        ],
        'Bread / Biscuits': [
          ['Bread (400g)', 45, 0, 1, '', 'pc'], ['Brown Bread', 55, 0, 1, '', 'pc'],
          ['Bun (4pc)', 30, 0, 1, '', 'pc'], ['Cookies (per kg)', 480, 0, 1, '', 'kg'],
          ['Rusk (per kg)', 260, 0, 1, '', 'kg']
        ]
      }
    },

    /* Liquor sits OUTSIDE GST (CGST s.9(1)). It gets its own block on the bill
       with its own subtotal — mixing it in can expose the whole bill to GST. */
    bar: {
      label: 'Bar add-on (liquor)',
      labelHi: 'बार',
      addon: true,
      cats: {
        'Beer': [
          ['Kingfisher Premium (650ml)', 220, 0, 0, 'L'], ['Kingfisher Strong (650ml)', 240, 0, 0, 'L'],
          ['Tuborg (650ml)', 230, 0, 0, 'L'], ['Budweiser (650ml)', 260, 0, 0, 'L']
        ],
        'Spirits (60ml)': [
          ['Old Monk 60ml', 140, 0, 0, 'L'], ['Royal Stag 60ml', 160, 0, 0, 'L'],
          ['Blenders Pride 60ml', 220, 0, 0, 'L'], ['Vodka 60ml', 180, 0, 0, 'L'],
          ['Gin 60ml', 190, 0, 0, 'L']
        ],
        'Mixers': [
          ['Soda', 40, 0, 1], ['Tonic Water', 90, 0, 1], ['Fresh Lime', 50, 0, 1]
        ]
      }
    }
  };

  /* Modifiers a waiter actually shouts. Kept to six so the sheet never scrolls. */
  var MODS = [
    { id: 'half',    en: 'Half',        hi: 'हाफ',                      hing: 'Half' },
    { id: 'noonion', en: 'No onion',    hi: 'बिना प्याज़', hing: 'Bina pyaz' },
    { id: 'spicy',   en: 'Extra spicy', hi: 'तेज़ मिर्च',        hing: 'Tez mirch' },
    { id: 'mild',    en: 'Less spicy',  hi: 'कम मिर्च',                   hing: 'Kam mirch' },
    { id: 'jain',    en: 'Jain',        hi: 'जैन',                                            hing: 'Jain' },
    { id: 'parcel',  en: 'Parcel',      hi: 'पैक करो',                        hing: 'Pack karo' }
  ];

  /* Build category + item records from a pack. */
  function buildPack(packKey, opts) {
    var C = global.DRCore;
    var pack = PACKS[packKey];
    if (!pack) return { cats: [], items: [] };
    var cats = [], items = [], sort = (opts && opts.catStart) || 0;

    Object.keys(pack.cats).forEach(function (catName) {
      var cat = { id: C.uid('C'), name: catName, sort: sort++, pack: packKey };
      cats.push(cat);
      pack.cats[catName].forEach(function (row) {
        var name = row[0], price = row[1], half = row[2], veg = row[3];
        var taxFlag = row[4] || '';
        var uom = row[5] || 'plate';
        items.push({
          id: C.uid('I'),
          catId: cat.id,
          name: name,
          icon: iconFor(name),
          pricePaise: C.P(price),
          halfPaise: half ? C.P(half) : 0,
          uom: uom,                                   // plate | kg | pc | g
          veg: !!veg,
          taxTreatment: taxFlag === 'L' ? 'ALCOHOL_OUTSIDE_GST' : 'GST_5',
          isLiquor: taxFlag === 'L',
          available: true,
          sold: 0,                                    // drives the "what actually sells" ordering
          active: true
        });
      });
    });
    return { cats: cats, items: items };
  }

  function packList() {
    return Object.keys(PACKS).map(function (k) {
      return {
        key: k, label: PACKS[k].label, labelHi: PACKS[k].labelHi,
        addon: !!PACKS[k].addon, counter: !!PACKS[k].counter,
        count: Object.keys(PACKS[k].cats).reduce(function (n, c) { return n + PACKS[k].cats[c].length; }, 0)
      };
    });
  }

  /* Tables. Sections keep the grid to one screen even at 40 tables —
     the waiter home must never scroll during a rush. */
  function buildTables(n, sections) {
    var C = global.DRCore, out = [], i;
    sections = sections || ['Hall'];
    for (i = 1; i <= n; i++) {
      out.push({
        id: C.uid('T'),
        label: String(i),
        section: sections[Math.floor((i - 1) / Math.ceil(n / sections.length))] || sections[0],
        seats: 4
      });
    }
    return out;
  }

  global.DRData = {
    PACKS: PACKS,
    MODS: MODS,
    iconFor: iconFor,
    buildPack: buildPack,
    packList: packList,
    buildTables: buildTables
  };
})(window);
