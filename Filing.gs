/**
 * ============================================================================
 *  EVOLVE SERVER-SIDE FILING ENGINE  (added 2026-06-16)
 * ----------------------------------------------------------------------------
 *  Makes EVERY field capture reach the database, cross-referenced, deterministically,
 *  24/7 on Apps Script — with NO dependency on the PC-based Claude router. Before this,
 *  only "Receipt / Expense" auto-filed; leads, customers, dispatch, to-dos, suppliers,
 *  price logs, quotes, job photos and Quick-Capture receipts all dead-ended at
 *  NEEDS REVIEW, and the Vendors + 📒 Receipt Log tabs were never populated.
 *
 *  Wired into EV_fileInbox_ (AutoServer) via EV_routeDest_ + the per-tab EV_file*_ funcs.
 *  Reuses helpers from AutoServer/OcrFill (same project): EV_sheetEndingWith_, EV_colIndex_,
 *  EV_safeCell_, EV_toDate_, EV_findAmount_, EV_fmt_, EV_now_, EV_fmtNow_, EV_brainExpenses_,
 *  EV_FILER_SS_ID, appLog_.
 *
 *  One-shot maintenance (run from the editor): EV_backfillNow()
 * ============================================================================
 */

function EV_norm_(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\b(inc|ltd|llc|co|corp|the)\b/g,' ').replace(/\s+/g,' ').trim(); }
function EV_title_(s){ return String(s||'').replace(/\s+/g,' ').trim().replace(/\b\w/g,function(c){return c.toUpperCase();}); }

/** Known vendor typos/aliases -> canonical display name (normalized key -> canonical). */
var EV_VENDOR_ALIAS = {
  'seal industrial minerals':'Sil Industrial Minerals',
  'seel industrial minerals':'Sil Industrial Minerals'
};
/** Collapse a vendor string to a stable grouping key (strips trailing location, applies aliases). */
function EV_vendorKey_(raw){
  var k=EV_norm_(raw);
  k=k.replace(/\s+in\s+.+$/,'').replace(/\b(sherwood park|st albert|edmonton|leduc|calgary|nisku|alberta|ab)\b.*$/,'').replace(/\s+/g,' ').trim();
  return k || EV_norm_(raw);
}
/** Canonical display name for a vendor (alias-corrected, location-stripped, title-cased). */
function EV_vendorCanon_(raw){
  if(EV_VENDOR_ALIAS[EV_norm_(raw)]) return EV_VENDOR_ALIAS[EV_norm_(raw)];
  var k=EV_vendorKey_(raw);
  if(EV_VENDOR_ALIAS[k]) return EV_VENDOR_ALIAS[k];
  return EV_title_(k);
}
function EV_today_(){ return EV_fmt_(EV_now_(),'yyyy-MM-dd'); }
function EV_tomorrow_(){ return EV_fmt_(new Date(EV_now_().getTime()+86400000),'yyyy-MM-dd'); }

/** Generic safe append to a banner+header business tab. headerKeys = column-name substrings that
 *  identify the header row; rowObj keys are header-name substrings -> values. Returns 'Tab!rowN' or null. */
function EV_appendToTab_(book, suffix, headerKeys, rowObj){
  var sh = EV_sheetEndingWith_(book, suffix); if(!sh) return null;
  var lastCol = sh.getLastColumn(), maxR = sh.getMaxRows();
  var scan = sh.getRange(1,1,Math.min(14,maxR),lastCol).getValues();
  var hr=-1, header=null, best=0;
  for(var r=0;r<scan.length;r++){
    var joined = scan[r].map(function(x){return String(x).toLowerCase();}).join('|');
    var hits=0; for(var k=0;k<headerKeys.length;k++){ if(joined.indexOf(headerKeys[k].toLowerCase())>=0) hits++; }
    if(hits>best){ best=hits; hr=r+1; header=scan[r]; }
  }
  if(hr<0 || best<2) return null;
  var lastRow = sh.getLastRow();
  var target = lastRow+1;
  if(lastRow > hr){
    var region = sh.getRange(hr+1,1,lastRow-hr,lastCol).getValues();
    var forms  = sh.getRange(hr+1,1,lastRow-hr,lastCol).getFormulas();
    for(var i=0;i<region.length;i++){
      var blank=true;
      for(var c=0;c<lastCol;c++){ if(String(region[i][c]).trim()!=='' || String(forms[i][c]).trim()!==''){ blank=false; break; } }
      if(blank){ target = hr+1+i; break; }
    }
  }
  var rowArr = new Array(lastCol).fill('');
  for(var key in rowObj){ if(rowObj.hasOwnProperty(key)){ var ci=EV_colIndex_(header,key); if(ci>=0) rowArr[ci]=EV_safeCell_(rowObj[key]); } }
  sh.getRange(target,1,1,lastCol).setValues([rowArr]);
  return sh.getName()+'!row'+target;
}

/** Does any data row of a tab already hold `value` in the column matching headerKey? (dedupe) */
function EV_existsInTab_(book, suffix, headerKey, value){
  if(!value) return false;
  var sh = EV_sheetEndingWith_(book, suffix); if(!sh) return false;
  var lastRow=sh.getLastRow(), lastCol=sh.getLastColumn();
  if(lastRow<2) return false;
  var scan=sh.getRange(1,1,Math.min(14,lastRow),lastCol).getValues();
  var hr=-1, header=null;
  for(var r=0;r<scan.length;r++){ if(EV_colIndex_(scan[r],headerKey)>=0){ hr=r+1; header=scan[r]; break; } }
  if(hr<0) return false;
  var ci=EV_colIndex_(header,headerKey); if(ci<0) return false;
  var col=sh.getRange(hr+1,ci+1,Math.max(0,lastRow-hr),1).getValues();
  var want=EV_norm_(value);
  for(var i=0;i<col.length;i++){ if(EV_norm_(col[i][0])===want) return true; }
  return false;
}

// ---------------------------------------------------------------------------
//  PER-CATEGORY FILERS  (deterministic, safe simple-table tabs)
// ---------------------------------------------------------------------------
function EV_fileLead_(book, det, summary, sub){
  var name=det.lead||det.company||det.name||summary||'';
  // Dedup on phone; if no phone, fall back to the lead name (D-2) so a phone-less repeat isn't duplicated.
  var dup = (det.phone && EV_existsInTab_(book,'Leads','Phone',det.phone)) ||
            (!det.phone && name && EV_existsInTab_(book,'Leads','Lead',name));
  if(dup) return 'Leads (already present)';
  return EV_appendToTab_(book,'Leads',['lead','status','next action'],{
    'Date in': EV_today_(), 'Lead': name,
    'Contact': det.contact||'', 'Phone': det.phone||det.email||'', 'Source': det.source||'Field app',
    'Service wanted': det.service||'', 'Address': det.address||'', 'Status': 'New',
    'Next action': 'Contact within 24h', 'Next action date': EV_tomorrow_(), 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_fileCustomer_(book, det, summary, sub){
  var name=det.customer||det.client||det.name||summary||'';
  if(EV_existsInTab_(book,'Customers','Customer',name)) return 'Customers (already present)';
  return EV_appendToTab_(book,'Customers',['customer','contact','status'],{
    'Customer': name, 'Contact': det.contact||'', 'Phone': det.phone||'', 'Email': det.email||'',
    'Address': det.address||'', 'Type': det.type||'', 'Quote no': det.quote||det.qno||'',  // B-1: carry the quote key
    'Status': det.status||'Active', 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_fileDispatch_(book, det, summary, sub){
  return EV_appendToTab_(book,'Dispatch',['customer','crew','status'],{
    'Date': det.date||'', 'Time': det.time||'', 'Customer': det.customer||summary||'',
    'Quote no': det.quote||det.qno||'', 'Address': det.address||'', 'Crew': det.crew||'',
    'Status': det.status||'Booked', 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_fileTodo_(book, det, summary, sub){
  var sh=EV_sheetEndingWith_(book,'To-Do'); if(!sh) return null;
  var lastRow=sh.getLastRow(), nextNum=1;
  if(lastRow>=1){ var colA=sh.getRange(1,1,lastRow,1).getValues(); for(var i=0;i<colA.length;i++){ var n=parseInt(colA[i][0],10); if(!isNaN(n)&&n>=nextNum) nextNum=n+1; } }
  return EV_appendToTab_(book,'To-Do',['task','priority','status'],{
    '#': nextNum, 'Task': det.task||det.description||summary||'',
    'Category': det.category||(det.request_type?('Request: '+det.request_type):'Field app'),
    'Priority': det.priority||'Medium', 'Status': 'Open', 'Date added': EV_today_(),
    'Due date': det.due||'', 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_fileSupplier_(book, det, summary, sub){
  if(EV_existsInTab_(book,'Suppliers','Supplier',det.supplier)) return 'Suppliers (already present)';
  return EV_appendToTab_(book,'Suppliers',['supplier','location'],{
    'Supplier': det.supplier||summary||'', 'Location': det.location||'', 'Local': det.localonline||'',
    'Phone': det.phone||'', 'Website': det.website||'', 'Products': det.products||'',
    'Last known pricing': det.pricing||'', 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_filePriceLog_(book, det, summary, sub){
  return EV_appendToTab_(book,'Price Log',['supplier','product','unit price'],{
    'Date': EV_today_(), 'Supplier': det.supplier||'', 'Product name': det.product||'', 'Brand': det.brand||'',
    'Category': det.category||'', 'Package size': det.size||'', 'Qty': det.qty||'',
    'Unit price': det.unitprice||'', 'Total paid': det.total||'', 'Invoice': det.invoice||'', 'Notes': EV_withSub_(det.notes||'', sub)
  });
}
function EV_fileJobIndex_(book, det, summary, photo, sub){
  // Keep EVERY photo link (B-6), de-tagged safely (never eats a bare https:// URL).
  var links=String(photo||'').split('\n').map(function(s){return EV_cleanLink_(s);}).filter(String).join(' | ');
  return EV_appendToTab_(book,'File Index',['type','drive','related'],{
    'Date': EV_today_(), 'Type': 'Job photo',
    'Description': summary||det.customer||det.surface||'',
    'Drive link': links,
    'Related to': det.customer||'', 'Notes': EV_withSub_(det.notes||det.stage||'', sub)
  });
}

/** Field quote -> price it deterministically + write Quotes row + mirror Customers. PDF/email = next step. */
function EV_fileQuote_(book, det, summary, sub){
  var rates={'very light brush':2.50,'very light':2.50,'light':3.75,'medium':6.90,'heavy':14.50,'exposed-aggregate':6.90,'exposed aggregate':6.90};
  var sqft=parseFloat(String(det.sqft||'').replace(/[^0-9.]/g,''))||0, subtotal=0;
  if(/set the price/i.test(String(det.pricing_method||''))){ subtotal=parseFloat(String(det.custom_price||'').replace(/[^0-9.]/g,''))||0; }
  else { var rate=rates[String(det.depth||'').toLowerCase()]||6.90; subtotal=(sqft*rate)+250; }
  var gst=Math.round(subtotal*5)/100, total=Math.round((subtotal+subtotal*0.05)*100)/100;
  var deposit=Math.round(total*25)/100, balance=Math.round((total-deposit)*100)/100;
  var qsh=EV_sheetEndingWith_(book,'Quotes'), n=1, mmddyy=EV_fmt_(EV_now_(),'MMddyy');
  if(qsh){ var qv=qsh.getDataRange().getValues(); for(var i=0;i<qv.length;i++){ if(String(qv[i][0]).indexOf('ECO-Q-'+mmddyy)>=0) n++; } }
  var qno='ECO-Q-'+mmddyy+'-'+(n<10?('0'+n):n);
  var ref=EV_appendToTab_(book,'Quotes',['quote','client','total'],{
    'Quote no': qno, 'Date': EV_today_(), 'Client': det.customer||det.client||summary||'', 'Contact': det.contact||'',
    'Phone': det.phone||'', 'Job address': det.address||'', 'Scope': det.scope||'',
    'Subtotal': subtotal.toFixed(2), 'GST': gst.toFixed(2), 'Total': total.toFixed(2),
    'Deposit': deposit.toFixed(2), 'Balance': balance.toFixed(2),
    'Status': 'Priced by app — PDF/email pending', 'Valid until': EV_fmt_(new Date(EV_now_().getTime()+30*86400000),'yyyy-MM-dd'),
    'Prepared by': 'Field app', 'Sq ft': sqft||'', 'Blast depth': det.depth||'', 'Notes': EV_withSub_(det.notes||'', sub)
  });
  // B-1: propagate the Quote No. forward as a key onto the mirrored Customer (and Lead, if present).
  try{ EV_fileCustomer_(book,{customer:det.customer||det.client,phone:det.phone,address:det.address,quote:qno,status:'Quoted',notes:'From quote '+qno},summary,sub); }catch(e){}
  return ref ? (qno) : null;
}

// ---------------------------------------------------------------------------
//  VENDORS canonical map + RECEIPT verification + dedupe
// ---------------------------------------------------------------------------
/** Upsert a canonical vendor row + roll up spend. Vendors tab: row1 header, data row 2+. */
function EV_upsertVendor_(book, rawVendor, category, amount, dateStr){
  if(!rawVendor) return;
  var sh=EV_sheetEndingWith_(book,'Vendors'); if(!sh) return;
  var canon=EV_vendorCanon_(rawVendor), key=EV_norm_(canon); if(!key) return;
  var amt=parseFloat(String(amount).replace(/[^0-9.\-]/g,''))||0;
  var lastRow=sh.getLastRow();
  if(lastRow>=2){
    var data=sh.getRange(2,1,lastRow-1,5).getValues();
    for(var i=0;i<data.length;i++){
      if(EV_norm_(EV_vendorCanon_(data[i][0]))===key || EV_norm_(data[i][1])===key){
        var cur=parseFloat(String(data[i][4]).replace(/[^0-9.\-]/g,''))||0;
        sh.getRange(i+2,5).setValue((cur+amt).toFixed(2));
        return;
      }
    }
  }
  sh.appendRow([EV_safeCell_(rawVendor), canon, category||'', dateStr||EV_today_(), amt.toFixed(2)]);
}

/** Deterministic receipt verification (no AI key, no OCR quota). Returns an Issue string ('' if clean). */
function EV_verifyReceipt_(det){
  var issues=[];
  var d=EV_toDate_(det.date);
  if(d instanceof Date){
    if(d.getTime() > EV_now_().getTime()+86400000) issues.push('date '+det.date+' is in the FUTURE — verify against receipt');
    else if(d.getTime() < EV_now_().getTime()-400*86400000) issues.push('date '+det.date+' is >1yr old — verify');
  } else if(det.date){ issues.push('date "'+det.date+'" unparseable'); }
  var sub=parseFloat(String(det.subtotal||'').replace(/[^0-9.]/g,''));
  var gst=parseFloat(String(det.gst||det.tax||'').replace(/[^0-9.]/g,''));
  var tot=parseFloat(String(det.total||'').replace(/[^0-9.]/g,''));
  if(!isNaN(sub)&&!isNaN(gst)&&!isNaN(tot)&&Math.abs((sub+gst)-tot)>0.05) issues.push('subtotal+GST ('+(sub+gst).toFixed(2)+') != total ('+tot.toFixed(2)+')');
  if(!isNaN(tot)&&(tot<=0||tot>100000)) issues.push('total $'+tot+' looks wrong');
  return issues.join('; ');
}

/** Hard-duplicate guard: same vendor(canon)+total+date(±2d) already in Receipt Log.
 *  Skips the submission's OWN row (Source col 12 === sub) so a held-then-corrected receipt
 *  is never mistaken for a duplicate of the HELD row it just wrote. */
function EV_isDupReceipt_(book, det, sub){
  try{
    var rl=EV_sheetEndingWith_(book,'Receipt Log'); if(!rl) return false;
    var lastRow=rl.getLastRow(); if(lastRow<2) return false;
    var v=rl.getRange(2,1,lastRow-1,12).getValues(); // Date,Vendor,Category,Subtotal,GST,Total,...,Source(12)
    var key=EV_norm_(det.vendor||det.where||det.store||'');
    // FIX (2026-07-08): dedupe now reads the total from the SAME source the booker uses
    // (EV_findAmount_ → total/amount/amountDue/…), so a receipt whose amount lives in a
    // non-"total" field is still matched and not double-filed.
    var tot=(typeof EV_findAmount_==='function')?EV_findAmount_(det):EV_amount_(det.total);
    if(tot==='') tot=NaN;
    var d=EV_toDate_(det.date);
    for(var i=0;i<v.length;i++){
      if(sub && String(v[i][11])===String(sub)) continue;   // never dup against this submission's own row
      if(EV_norm_(v[i][1])!==key) continue;
      var t2=EV_amount_(v[i][5]);
      if(isNaN(tot)||isNaN(t2)||Math.abs(tot-t2)>0.5) continue;
      var d2=EV_toDate_(v[i][0]);
      if(d instanceof Date && d2 instanceof Date && Math.abs(d.getTime()-d2.getTime())<=2*86400000) return true;
    }
  }catch(e){}
  return false;
}

// ---------------------------------------------------------------------------
//  ROUTER — decide where an inbox row goes (deterministic)
// ---------------------------------------------------------------------------
function EV_routeDest_(cat, det, summary){
  var c=String(cat||'').toLowerCase();
  if(/receipt|expense/.test(c)) return 'Expenses';
  if(/lead/.test(c)) return 'Leads';
  if(/customer/.test(c)) return 'Customers';
  if(/dispatch|schedule/.test(c)) return 'Dispatch';
  if(/request/.test(c)) return 'To-Do';
  if(/to-?do|task/.test(c)) return 'To-Do';
  if(/supplier/.test(c)) return 'Suppliers';
  if(/price|purchase/.test(c)) return 'Price Log';
  if(/quote/.test(c)) return 'Quote';
  if(/before|after|job photo/.test(c)) return 'File Index';
  if(/quick|capture/.test(c)){
    var blob=(JSON.stringify(det||{})+' '+(summary||'')).toLowerCase();
    var about=String((det&&det.about)||'').toLowerCase();
    if(/receipt|expense/.test(about) || EV_findAmount_(det) || /\$\s*\d|receipt|fuel|diesel|invoice|\bpaid\b|vendor/.test(blob)) return 'Expenses';
    if(/lead|customer|interested|wants|deck|quote/.test(about+' '+blob)) return 'Leads';
    if(/task|reminder|to-?do/.test(about+' '+blob)) return 'To-Do';
    return 'REVIEW';
  }
  return 'REVIEW';
}

/** Dispatch a single inbox row to the right filer. Returns 'Tab!rowN'/note or null (=>REVIEW). */
function EV_fileByDest_(book, dest, irow, ih, det, photo, sub, summary){
  switch(dest){
    case 'Expenses':  return EV_fileExpense_(book, irow, ih, det, photo, sub);
    case 'Leads':     return EV_fileLead_(book, det, summary, sub);
    case 'Customers': return EV_fileCustomer_(book, det, summary, sub);
    case 'Dispatch':  return EV_fileDispatch_(book, det, summary, sub);
    case 'To-Do':     return EV_fileTodo_(book, det, summary, sub);
    case 'Suppliers': return EV_fileSupplier_(book, det, summary, sub);
    case 'Price Log': return EV_filePriceLog_(book, det, summary, sub);
    case 'File Index':return EV_fileJobIndex_(book, det, summary, photo, sub);
    case 'Quote':     return EV_fileQuote_(book, det, summary, sub);
  }
  return null;
}

// ---------------------------------------------------------------------------
//  ONE-SHOT BACKFILL / SELF-HEAL  (run EV_backfillNow() from the editor)
// ---------------------------------------------------------------------------
function EV_rebuildVendors_(book){
  book=book||SpreadsheetApp.openById(EV_FILER_SS_ID);
  var sh=EV_sheetEndingWith_(book,'Vendors'); if(!sh) return 0;
  var rows=EV_brainExpenses_(book), map={};
  rows.forEach(function(e){
    if(!e.vendor) return;
    var canon=EV_vendorCanon_(e.vendor), k=EV_norm_(canon); if(!k) return;
    if(!map[k]) map[k]={raw:e.vendor, canon:canon, cat:e.category||'', first:e.date, total:0};
    map[k].total+=(e.amount||0);
    if(e.date instanceof Date && (!(map[k].first instanceof Date) || e.date.getTime()<map[k].first.getTime())) map[k].first=e.date;
  });
  var out=Object.keys(map).map(function(k){ var v=map[k]; return [v.raw, v.canon, v.cat, (v.first instanceof Date?EV_fmt_(v.first,'yyyy-MM-dd'):''), v.total.toFixed(2)]; });
  out.sort(function(a,b){ return parseFloat(b[4])-parseFloat(a[4]); });
  var lr=sh.getLastRow(); if(lr>1) sh.getRange(2,1,lr-1,5).clearContent();
  if(out.length) sh.getRange(2,1,out.length,5).setValues(out);
  return out.length;
}
function EV_backfillReceiptLog_(book){
  book=book||SpreadsheetApp.openById(EV_FILER_SS_ID);
  var rl=EV_sheetEndingWith_(book,'Receipt Log'), exp=EV_sheetEndingWith_(book,'Expenses');
  if(!rl||!exp) return 0;
  var rlData=rl.getDataRange().getValues(), seen={};
  for(var i=1;i<rlData.length;i++){ var s=String(rlData[i][11]||''); if(s) seen[s]=true; }
  var ev=exp.getDataRange().getValues(), hr=-1, header=null;
  for(var r=0;r<Math.min(15,ev.length);r++){ var low=ev[r].map(function(x){return String(x).toLowerCase();}).join('|'); if(low.indexOf('vendor')>=0&&low.indexOf('total')>=0){ hr=r; header=ev[r]; break; } }
  if(hr<0) return 0;
  function gi(n){ return EV_colIndex_(header,n); }
  var ciDate=gi('Date'),ciVendor=gi('Vendor'),ciCat=gi('Category'),ciTotal=gi('Total'),ciBy=gi('Purchased'),ciDesc=gi('Description'),ciWhat=gi('What'),added=0;
  for(var rr=hr+1;rr<ev.length;rr++){
    var desc=String((ciDesc>=0?ev[rr][ciDesc]:'')||''), m=desc.match(/SubID:\s*(\S+)/), sub=m?m[1]:'';
    var vendor=String((ciVendor>=0?ev[rr][ciVendor]:'')||''), total=ciTotal>=0?ev[rr][ciTotal]:'';
    if(!sub || seen[sub]) continue;
    var pm=desc.match(/Photo:\s*([^|]+)/), photo=pm?pm[1].trim():'';
    rl.appendRow([ (ciDate>=0?ev[rr][ciDate]:'')||'', vendor, (ciCat>=0?ev[rr][ciCat]:'')||'', '', '', total||'', '', (ciWhat>=0?ev[rr][ciWhat]:'')||'', '', '', '', sub, photo, (ciBy>=0?ev[rr][ciBy]:'')||'', 'Backfilled from Expenses — GST/subtotal unverified', EV_fmtNow_() ]);
    seen[sub]=true; added++;
  }
  return added;
}
function EV_backfillNow(){
  var book=SpreadsheetApp.openById(EV_FILER_SS_ID);
  var rl=EV_backfillReceiptLog_(book);
  var filer=EV_fileInbox_();               // re-routes NEW + NEEDS REVIEW rows through the new filers
  var v=EV_rebuildVendors_(book);          // rebuild AFTER filing so newly-filed receipts count
  var msg='Backfill done — ReceiptLog +'+rl+' rows, Vendors='+v+' canonical, filer='+filer;
  try{ appLog_('Backfill', msg); }catch(e){}
  Logger.log(msg);
  return msg;
}
