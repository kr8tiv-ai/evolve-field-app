/** EVOLVE OPS — Q&A / OPEN ITEMS  (added 2026-06-29)
 *  EV_writeQandA() (re)writes the "Q&A - Open Items" tab: one consolidated place for the ambiguous
 *  items that need a human answer (surfaced by the receipt-vs-inventory sort + the data audit), so they
 *  do not sit unresolved across the other tabs. Reachable via maint fn 'writeQandA'. Idempotent. */
function EV_writeQandA(){
  var S = ss_();
  var sh = S.getSheetByName('Q&A - Open Items') || S.insertSheet('Q&A - Open Items');
  sh.clearContents();
  var rows = EV_QANDA_ROWS_();
  var rng = sh.getRange(1, 1, rows.length, rows[0].length);
  rng.setNumberFormat('@');   // plain text so nothing is parsed as a formula/number
  rng.setValues(rows);
  try {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#4ade80');
    sh.setColumnWidth(1, 36);
    sh.setColumnWidth(2, 200);
    sh.setColumnWidth(3, 440);
    sh.setColumnWidth(4, 320);
    sh.setColumnWidth(5, 260);
    sh.getRange(1, 1, rows.length, rows[0].length).setWrap(true).setVerticalAlignment('top');
  } catch (e) {}
  try { appLog_('Autopilot', 'Q&A Open Items tab rebuilt (' + (rows.length - 1) + ' questions).'); } catch (e) {}
  return 'Q&A written: ' + (rows.length - 1) + ' open items';
}

function EV_QANDA_ROWS_(){
  var hdr = ['#', 'Area', 'Question for Matt', 'Why it matters', 'Matt’s answer (type here)'];
  var q = [
    ['Silica sand / Sil Minerals media',
     'Photos from the 2026-06-21 shop audit show silica sand and Sil (Industrial Minerals) bags. Eco / dustless blasting usually avoids silica. Do you actually stock and use this, is it legacy stock to dispose of, or a customer’s material?',
     'Decides whether it belongs in the media inventory and whether we ever quote it. Silica carries health / WCB implications.', ''],
    ['Nova 2000 (IMG_0335)',
     'What is the “Nova 2000” in the photo — a blast helmet / supplied-air respirator, a blast media, or a machine?',
     'So it is catalogued in the right Inventory section (PPE vs Equipment vs Media).', ''],
    ['RADEX meter (IMG_0334)',
     'Is the RADEX device a coating-thickness gauge, a moisture / surface-profile meter, or a radiation dosimeter?',
     'Needed to label it correctly under Equipment & General.', ''],
    ['Excel Fire BWLY Ltd. (IMG_0382)',
     'Is “Excel Fire” your fire-extinguisher inspection vendor (a service you pay for), or just the tag on the extinguisher?',
     'If a vendor, I add them to Vendors and watch for the annual invoice; if just a tag, no action.', ''],
    ['Lot / expiry label, exp 2028-03-17 (IMG_0344)',
     'What product is the “LOT 5122” expiry label on — a respirator cartridge, AED / first-aid pads, or another consumable?',
     'So I can track the expiry and flag a reorder before it lapses.', ''],
    ['Warburg vs Sande Brothers',
     'Are “Warburg – 3 new jobs (repeat client)” and “Sande Brothers Concrete – Warburg driveways” the SAME work, or two separate jobs? They arrived via two different intake paths.',
     'Prevents quoting or billing the same work twice. Currently shows as two opportunities.', ''],
    ['GST policy',
     'Every quote / invoice adds 5% GST, but there is no GST number on file and the standing note is “ignore for now.” Do you want GST removed from documents, or are you registering?',
     'It appears on every customer-facing document and is wrong either way until decided.', ''],
    ['Customer emails at intake',
     'Most active customers have no email on file, which blocks emailed quotes / invoices / receipts. Should the field app REQUIRE an email when a quote is started?',
     'Email is the bottleneck for sending quotes, invoices, and receipts automatically.', ''],
    ['Flatbed truck for sale',
     'The morning digest reminds you to post the flatbed truck for sale. Is it still for sale, already posted, or sold?',
     'If sold or posted, I drop the reminder so the digest stays current.', '']
  ];
  var out = [hdr];
  for (var i = 0; i < q.length; i++) { out.push([String(i + 1)].concat(q[i])); }
  return out.map(function(r){ while (r.length < 5) r.push(''); return r; });
}
