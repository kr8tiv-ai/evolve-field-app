/**
 * EV_Handoff.gs  —  WIN -> JOB handoff + trigger maintenance (added via Cowork 2026-06-19).
 * Idempotent, keyed by Quote No. Quotes: header row 6, data 7+, STATUS col M(13), SUBTOTAL col H(8), TOTAL col J(10).
 * Dispatch: header row 6, QUOTE NO. col H(8); new rows appended at bottom.
 * Job P&L: header row 7, data rows 8-15 (scorecard sums P8:P15), JOB ID col A(1), REVENUE COLLECTED col P(16).
 */
var EVH_QUOTES_DATA_START = 7;
var EVH_PNL_DATA_START = 8;
var EVH_PNL_DATA_END = 15;
function EVH_ss_(){ return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }
function EVH_sheet_(ss, re){ return ss.getSheets().filter(function(s){return re.test(s.getName());})[0]; }
function EVH_isWonStatus_(status){
  var s = String(status == null ? '' : status).toLowerCase();
  var WON = ['won','accepted','paid','deposit received','deposit paid','deposit secured','booked','going ahead','green light','confirmed','signed'];
  var hit = false;
  for (var i=0;i<WON.length;i++){ if (s.indexOf(WON[i]) >= 0){ hit = true; break; } }
  if (!hit) return false;
  var NEG = ['not going ahead','not yet','likely to proceed','to be confirmed','awaiting confirmation','hold for'];
  for (var j=0;j<NEG.length;j++){ if (s.indexOf(NEG[j]) >= 0) return false; }
  return true;
}
function EVH_colHasKey_(sheet, col1, key){
  var lr = sheet.getLastRow();
  if (lr < 1) return false;
  var vals = sheet.getRange(1, col1, lr, 1).getValues();
  for (var i=0;i<vals.length;i++){ if (String(vals[i][0]||'').indexOf(key) >= 0) return true; }
  return false;
}
function EVH_nextPnlRow_(P){
  for (var r=EVH_PNL_DATA_START; r<=EVH_PNL_DATA_END; r++){
    if (!String(P.getRange(r,1).getValue()||'').trim()) return r;
  }
  return -1;
}
function EV_syncWonJobs(){
  var ss = EVH_ss_();
  var Q = EVH_sheet_(ss, /^quotes$/i);
  var D = EVH_sheet_(ss, /^dispatch$/i);
  var P = EVH_sheet_(ss, /job.*p.*l/i);
  if (!Q || !D || !P) throw new Error('Missing sheet: Q='+!!Q+' D='+!!D+' P='+!!P);
  var qlr = Q.getLastRow();
  var qVals = Q.getRange(1,1,qlr,16).getValues();
  var qDisp = Q.getRange(1,1,qlr,16).getDisplayValues();
  var createdD = [], createdP = [], skipped = [];
  for (var i = EVH_QUOTES_DATA_START-1; i < qlr; i++){
    var no = String(qVals[i][0]||'').trim();
    if (!no) continue;
    if (!EVH_isWonStatus_(qVals[i][12])) continue;
    var client = qVals[i][2], addr = qVals[i][5], scope = qVals[i][6];
    var subtotal = qVals[i][7], total = qVals[i][9];
    var dateTxt = qDisp[i][1];
    var statusTxt = String(qVals[i][12]||'').slice(0,70);
    if (!EVH_colHasKey_(D, 8, no)){
      var dr = D.getLastRow()+1;
      D.getRange(dr,1,1,10).setValues([[ 'This week', dateTxt, 'TBD', no, client, addr, 'TBD', no, 'Booked', 'Auto-created from won quote ('+statusTxt+')' ]]);
      createdD.push(no);
    }
    if (!EVH_colHasKey_(P, 1, no)){
      var pr = EVH_nextPnlRow_(P);
      if (pr > 0){
        P.getRange(pr,1,1,8).setValues([[ no, dateTxt, client, addr, '', scope, (subtotal||total||''), '' ]]);
        createdP.push(no);
      } else { skipped.push(no+' (Job P&L rows 8-15 full)'); }
    }
  }
  Logger.log('EV_syncWonJobs: dispatch+=' + JSON.stringify(createdD) + ' pnl+=' + JSON.stringify(createdP) + (skipped.length?' SKIPPED='+JSON.stringify(skipped):''));
  return { dispatch: createdD, pnl: createdP, skipped: skipped };
}
function EV_backfillRFM(){
  var ss = EVH_ss_();
  var D = EVH_sheet_(ss, /^dispatch$/i);
  var P = EVH_sheet_(ss, /job.*p.*l/i);
  var KEY = 'RFM-CONCRETE';
  var did = [];
  if (!EVH_colHasKey_(D, 8, KEY)){
    var dr = D.getLastRow()+1;
    D.getRange(dr,1,1,13).setValues([[ 'This week','2026-06-17','TBD', KEY, 'RFM Concrete', 'TBD', 'TBD', KEY, 'Paid', 'Manual backfill — RFM Concrete paid $2,625 on June 17 (no quote on file). Job: tri-axle flat deck blast & paint.', 'Y','Y','Y' ]]);
    did.push('dispatch');
  }
  if (!EVH_colHasKey_(P, 1, KEY)){
    var pr = EVH_nextPnlRow_(P);
    if (pr > 0){
      P.getRange(pr,1,1,7).setValues([[ KEY, '2026-06-17', 'RFM Concrete', 'TBD', '', 'Blast & paint (tri-axle flat deck gooseneck)', 2625 ]]);
      P.getRange(pr,16).setValue(2625);
      did.push('pnl row '+pr);
    }
  }
  Logger.log('EV_backfillRFM: '+JSON.stringify(did));
  return did;
}
function EV_installSyncTrigger(){
  var exists = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'EV_syncWonJobs'; });
  if (exists){ Logger.log('EV_syncWonJobs trigger already installed'); return 'exists'; }
  ScriptApp.newTrigger('EV_syncWonJobs').timeBased().everyMinutes(30).create();
  Logger.log('Installed EV_syncWonJobs trigger (every 30 min)');
  return 'installed';
}
function EV_deletePersonalDigestTrigger(){
  var removed = [];
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'EV_personalDigest'){ ScriptApp.deleteTrigger(t); removed.push(t.getUniqueId()); }
  });
  Logger.log('Deleted EV_personalDigest trigger ids: ' + JSON.stringify(removed));
  Logger.log('Remaining triggers: ' + JSON.stringify(ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();})));
  return { removed: removed };
}
// Renamed 2026-07-08 from EV_listTriggers → EVH_listTriggers to end a silent name collision:
// AutoServer.js also defines EV_listTriggers, and this file (loading later alphabetically) was
// overriding it. AutoServer's EV_listTriggers is now the single canonical one. This EVH_ copy
// stays as a diagnostic in the EV_Handoff namespace.
function EVH_listTriggers(){
  var t = ScriptApp.getProjectTriggers().map(function(x){ return x.getHandlerFunction() + ' | ' + x.getEventType(); });
  Logger.log('TRIGGERS('+t.length+'): ' + JSON.stringify(t));
  return t;
}
function EV_verify(){
  var ss = EVH_ss_();
  var D = EVH_sheet_(ss, /^dispatch$/i);
  var P = EVH_sheet_(ss, /job.*p.*l/i);
  var dlr = D.getLastRow();
  var dv = D.getRange(1,1,dlr,13).getValues();
  Logger.log('--- DISPATCH ('+dlr+' rows) ---');
  for (var i=0;i<dlr;i++){ Logger.log('D'+(i+1)+' | cust='+dv[i][4]+' | QNO(H)='+dv[i][7]+' | STATUS='+dv[i][8]); }
  var plr = P.getLastRow();
  var pv = P.getRange(1,1,plr,18).getValues();
  Logger.log('--- JOB P&L ('+plr+' rows) ---');
  for (var k=0;k<plr;k++){ Logger.log('P'+(k+1)+' | JOBID(A)='+pv[k][0]+' | cust(C)='+pv[k][2]+' | qSub(G)='+pv[k][6]+' | REVENUE(P)='+pv[k][15]); }
}