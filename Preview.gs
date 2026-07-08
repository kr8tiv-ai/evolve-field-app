/** Render the morning digest HTML WITHOUT sending it (for preview / saving a copy).
 *  Returns exactly what EV_morningDigest() emails at 6 AM (weather + joke refresh at send time).
 *  Reachable via maint fn 'previewDigest'. */
function EV_previewDigest(){ return EV_buildMorningDigestHtml_(); }   // same canonical builder the 6AM trigger uses

/** Render the digest from the LIVE sheet right now and email it as a clearly-labelled TEST to a
 *  given address (default Todd@evolveecoblasting.com). Same builder the 6 AM trigger uses, so the
 *  test is a true preview of tomorrow. Reachable via maint fn 'testDigestSend' {to}. */
function EV_sendTestDigest_(to){
  var addr = (to && String(to).indexOf('@') > 0) ? String(to) : 'Todd@evolveecoblasting.com';
  var html = EV_buildMorningDigestHtml_();   // IDENTICAL to the 6AM send (same canonical builder)
  var subj = 'TEST (identical to 6AM) - Evolve Morning Digest - ' + EV_fmt_(EV_now_(), 'EEEE MMM d HH:mm');
  EV_send_(addr, subj, html);
  try { appLog_('Autopilot', 'TEST digest sent to ' + addr); } catch(e){}
  return 'TEST digest sent to ' + addr;
}

/** Create the "Employee Hours" tab (Matt: "add a place to log employee hours - total + per job").
 *  Idempotent: if the tab already exists it is left as-is. Reachable via maint fn 'writeHours'. */
function EV_writeHours(){
  var S = ss_();
  if (S.getSheetByName('Employee Hours')) return 'Employee Hours tab already exists - left as-is.';
  var sh = S.insertSheet('Employee Hours');
  var title = 'EMPLOYEE HOURS - log time per employee, per job. Filter/sum by Employee for total hours, by Job for hours-per-job.';
  var header = ['Date','Employee','Job / Quote no.','Customer','Hours','Pay rate ($/hr)','Cost ($)','Notes'];
  sh.getRange(1,1,1,1).setValues([[title]]);
  sh.getRange(3,1,1,header.length).setValues([header]);
  // a few ready-to-fill blank rows with a live Cost formula (Hours x Rate)
  for (var r=4; r<=23; r++){ sh.getRange(r,7).setFormula('=IF(AND(ISNUMBER($E'+r+'),ISNUMBER($F'+r+')),$E'+r+'*$F'+r+',"")'); }
  try {
    sh.getRange(1,1).setFontWeight('bold').setFontSize(12);
    sh.getRange(3,1,1,header.length).setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#4ade80');
    sh.setFrozenRows(3);
    sh.getRange(4,1,20,6).setNumberFormat('@'); // keep typed entries plain except the Cost formula col
    var widths=[90,120,150,170,70,110,90,320];
    for (var c=0;c<widths.length;c++){ sh.setColumnWidth(c+1, widths[c]); }
  } catch(e){}
  try { appLog_('Autopilot','Employee Hours tab created.'); } catch(e){}
  return 'Employee Hours tab created (Date | Employee | Job/Quote | Customer | Hours | Rate | Cost | Notes).';
}
