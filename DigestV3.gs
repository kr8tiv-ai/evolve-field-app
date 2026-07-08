/** ===== EVOLVE MORNING DIGEST V3 (dark theme, weather + joke + focus notes) =====
 *  STATUS (corrected 2026-07-08): this is an ALTERNATE/experimental builder. EV_morningDigest()
 *  is NOT wired to it — the 6 AM send uses the canonical v2 EV_buildMorningDigestHtml_() (see
 *  AutoServer.js:330, "the one Matt prefers"). V3 is only reachable via the maint 'renderV3direct'
 *  probe. Kept (nothing deleted) in case the owner wants to switch themes later; if so, repoint
 *  EV_morningDigest to EV_buildDigestV3_() and update the test/preview helpers to match. */

var EV_DIGEST_DEFAULT_NOTES_ = [
  "Matt + Todd: meeting on the drive out to Warburg - go over the 3 new Warburg jobs and plan the day.",
  "Todd is on the car today - Ali's classic: strip the chrome and bare-metal blast.",
  "Jaxon has the day off; if he comes in Friday he'll be late. Decide during/after today whether to bring him in for a half day (chrome strip + shop list). Todd's call.",
  "Push Ali's car into the shop and send him progress photos.",
  "Finish the back of Don's trailer - he picks up today.",
  "Finish the fence beside the shop.",
  "Matt: POST the flatbed truck for sale - the ad is READY, just clean up the images first."
].join("\n");

function EV_DIGEST_JOKES_(){
  return [
  "My wife asked me why I keep a bag of crushed glass in the truck and called it romantic. I said abrasive blasting media isn't romantic, it's profiling. She said that explained a lot about how I read a room, and honestly she profiled me right back down to the substrate.",
  "A guy called wanting his driveway 'just lightly cleaned, nothing aggressive.' I told him we offer a 'very light' setting and he asked if it was gentle enough for delicate concrete. Buddy, the concrete survived three Edmonton winters and a teenager learning to parallel park. It is not delicate. It has seen things.",
  "I tried to explain my job to my six-year-old. I said, 'I shoot tiny rocks at big rocks until the big rocks look nice again.' She thought about it for a long second and said, 'So you're a bully to floors.' I have not recovered, and frankly neither has the floor.",
  "People ask if abrasive blasting is loud. No, the blasting is fine. What's loud is the customer who swore the surface was 'basically already clean' watching forty years of paint come off in eight seconds and quietly whispering, 'oh.' That 'oh' is the loudest sound on any job site.",
  "An Edmonton winter has two settings: 'too cold to work' and 'lying to yourself about whether it's too cold to work.' I went out yesterday to check a site, the wind hit me sideways, and my truck and I made a mutual decision to support each other emotionally from inside the cab. We bonded. The site is still unchecked.",
  "Somebody asked me the difference between sandblasting and abrasive blasting. I said it's mostly the difference between what your buddy with a borrowed compressor does and what a professional with insurance does. One ends with a clean surface. The other ends with a clean surface, a cracked window, and a conversation with the neighbour.",
  "My doctor told me I needed to reduce stress and find a healthy outlet for my frustration. I told him I get paid to fire abrasive media at high pressure until things that annoy me cease to exist. He paused, wrote something down, and said, 'No, that's actually ideal, never change.' Best appointment of my life.",
  "I love a customer who says 'money is no object' and then flinches at the GST line. Sir, the GST is five percent and it's the government's idea, not mine. If money were truly no object you wouldn't have just done that math out loud with your whole face.",
  "Concrete is the only material that takes 28 days to be ready and then acts surprised when you show up. I poured a slab, told it to call me when it's cured, and it ghosted me for a month like a guy from a dating app. Then it had the nerve to crack on day 29 just to keep me interested.",
  "A friend asked why tradespeople drink coffee like it's a job requirement. It IS a job requirement. The first cup is to wake up, the second is to forgive the alarm clock, and the third is so I can look a 6 a.m. customer in the eye and pretend I'm a morning person who chose this freely.",
  "Customer said my quote was 'a bit much for just spraying some rocks at a wall.' I said the same energy as telling a surgeon his bill is steep for 'just poking around in there.' The skill isn't the rocks, sir. The skill is the rocks hitting exactly what they're supposed to and nothing your wife loves.",
  "I told my crew we run a tight ship and everyone has to pull their weight. Then I watched three grown men strategize for fifteen minutes about the most efficient way to avoid carrying one hose. The plan was genuinely brilliant. Honestly if they put that engineering into the actual job we'd be done by lunch.",
  "Somebody on a job site asked if I worried about robots taking trade jobs. I told him to send a robot up a frozen Alberta ladder in March with numb fingers and a customer changing the scope for the fourth time. The robot would file a complaint, request a sweater, and unionize before lunch. My job is safe.",
  "A homeowner proudly told me he 'already pressure-washed it himself' to save me time. I looked at the surface, looked at him, and gently explained that pressure washing his old paint just gave it a spa day. It's relaxed now. Refreshed. Still extremely there. We're going to have a much firmer conversation with it.",
  "My buddy in an office job asked what my favourite part of blasting is. I said it's the moment the customer who didn't believe me sees the 'before' and 'after' side by side and goes completely silent. That silence is worth more than the invoice. The invoice is also worth the invoice, to be very clear, but the silence is the dessert."
];
}

function EV_wxDesc_(c){
  var m={0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Rain showers',82:'Heavy rain showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ hail'};
  return m[c]||'Mixed conditions';
}
/** LIVE forecast for the three towns we work in (Edmonton, Sherwood Park, Beaumont).
 *  Fetched fresh from Open-Meteo every run (never cached) - temp range, conditions,
 *  precip chance and wind/gusts, plus a blast-window verdict so the crew can call the day.
 *  Returns { cities:[{city,desc,hi,lo,pop,wind,gust}], verdict } or null on failure. */
function EV_weatherV3_(){
  var cities=[
    {name:'Edmonton',      lat:53.5461, lon:-113.4938},
    {name:'Sherwood Park', lat:53.5419, lon:-113.2958},
    {name:'Beaumont',      lat:53.3556, lon:-113.4147}
  ];
  try{
    var lats=cities.map(function(c){return c.lat;}).join(',');
    var lons=cities.map(function(c){return c.lon;}).join(',');
    var url='https://api.open-meteo.com/v1/forecast?latitude='+lats+'&longitude='+lons+
            '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max,wind_gusts_10m_max'+
            '&timezone=America%2FEdmonton&forecast_days=1';
    var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
    if(r.getResponseCode()!=200) return null;
    var j=JSON.parse(r.getContentText());
    var arr=(j && j.length!==undefined)?j:[j];   // multi-location returns an array
    var out=[], maxPop=0, maxWind=0;
    for(var i=0;i<cities.length && i<arr.length;i++){
      var d=arr[i].daily; if(!d) continue;
      var hi=Math.round(d.temperature_2m_max[0]), lo=Math.round(d.temperature_2m_min[0]);
      var pop=Math.round(d.precipitation_probability_max[0]);
      var wind=Math.round(d.wind_speed_10m_max[0]), gust=Math.round(d.wind_gusts_10m_max[0]);
      if(pop>maxPop) maxPop=pop; if(wind>maxWind) maxWind=wind;
      out.push({city:cities[i].name, desc:EV_wxDesc_(d.weather_code[0]), hi:hi, lo:lo, pop:pop, wind:wind, gust:gust});
    }
    if(!out.length) return null;
    var verdict;
    if(maxPop>=60 || maxWind>=35) verdict='High rain/wind risk - outdoor blasting likely a no-go today; plan shop/indoor work or a rain-day filler job.';
    else if(maxPop>=30 || maxWind>=25) verdict='Marginal - watch the radar and wind; keep a backup indoor task ready.';
    else verdict='Good window for outdoor blasting.';
    return {cities:out, verdict:verdict};
  }catch(e){ return null; }
}

function EV_buildDigestV3_(){
  try {
    var S = ss_();
    var esc = function(x){ return EV_esc_(x==null?'':String(x)); };
    var H = [];
    H.push('<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;background:#0a0a0a;color:#e5e7eb">');
    H.push('<div style="padding:20px 22px;border-bottom:2px solid #39ff14"><div style="font-size:12px;letter-spacing:3px;color:#39ff14">EVOLVE ECO BLASTING</div><div style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:1px">MORNING DIGEST</div><div style="font-size:13px;color:#9ca3af">'+esc(EV_fmt_(EV_now_(),'EEEE, MMMM d, yyyy'))+'</div></div>');
    var sec=function(t){ H.push('<div style="padding:16px 22px;border-top:1px solid #1f2937"><div style="font-size:11px;letter-spacing:2px;color:#4ade80;margin-bottom:10px;text-transform:uppercase">'+t+'</div>'); };
    var end=function(){ H.push('</div>'); };
    var ul=function(arr){ H.push('<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#d1d5db">'); arr.forEach(function(x){H.push('<li style="margin:5px 0">'+x+'</li>');}); H.push('</ul>'); };

    // WEATHER FIRST - it drives whether outdoor blasting goes ahead, so the crew can call the day.
    sec('Weather - call the day');
    var wx=EV_weatherV3_();
    if(wx && wx.cities && wx.cities.length){
      H.push('<div style="font-size:14px;color:#d1d5db">');
      wx.cities.forEach(function(c){
        H.push('<div style="margin:3px 0"><b style="color:#ffffff">'+esc(c.city)+'</b>: '+esc(c.desc)+', '+c.lo+'–'+c.hi+'°C &middot; precip '+c.pop+'% &middot; wind '+c.wind+' km/h (gusts '+c.gust+')</div>');
      });
      H.push('<div style="margin-top:8px;color:#4ade80;font-size:13px"><b>'+esc(wx.verdict)+'</b></div>');
      H.push('</div>');
    } else {
      H.push('<div style="font-size:14px;color:#d1d5db">Weather unavailable this morning - check before heading out.</div>');
    }
    end();

    var jokes=EV_DIGEST_JOKES_();
    var dayN=(new Date(EV_now_())).getDate();
    sec('To start the day');
    H.push('<div style="font-size:14px;line-height:1.55;color:#cbd5e1;font-style:italic">'+esc(jokes[dayN % jokes.length])+'</div>');
    end();

    var manualNotes=(PropertiesService.getScriptProperties().getProperty('EV_DIGEST_NOTES')||'').trim();
    var noteArr = manualNotes
      ? manualNotes.split('\n').map(function(s){return esc(s.trim());}).filter(function(s){return s;})
      : EV_v3Focus_(S).slice(0,22);   // data-driven from open Action Items; respects Matt's done/closed edits
    if(noteArr.length){ sec("Today's focus"); ul(noteArr); end(); }

    var jobs=EV_v3Dispatch_(S);
    if(jobs.length){
      sec('Jobs on the board');
      H.push('<div style="font-size:14px;color:#d1d5db">');
      jobs.forEach(function(j){
        H.push('<div style="margin:0 0 12px;padding:10px 12px;background:#111317;border-left:3px solid #39ff14;border-radius:4px">');
        H.push('<div style="font-weight:bold;color:#ffffff">'+esc(j.customer)+(j.quote?' <span style="color:#6b7280;font-weight:normal">- '+esc(j.quote)+'</span>':'')+'</div>');
        if(j.status) H.push('<div style="color:#4ade80;font-size:13px;margin-top:2px">'+esc(j.status)+'</div>');
        var meta=[]; if(j.deposit) meta.push('Deposit: '+esc(j.deposit)); if(j.paid) meta.push('Paid: '+esc(j.paid)); if(j.crew) meta.push('Crew: '+esc(j.crew)); if(j.date) meta.push(esc(j.date));
        if(meta.length) H.push('<div style="color:#9ca3af;font-size:12px;margin-top:3px">'+meta.join(' - ')+'</div>');
        if(j.notes) H.push('<div style="color:#9ca3af;font-size:12px;margin-top:3px">'+esc((''+j.notes).substring(0,200))+'</div>');
        H.push('</div>');
      });
      H.push('</div>');
      end();
    }

    var todos=EV_v3Todos_(S);
    if(todos.length){
      sec('Top to-dos');
      ul(todos.slice(0,12).map(function(t){ return '<b style="color:#e5e7eb">#'+esc(t.num)+'</b> '+esc(t.title)+(t.priority?' <span style="color:#6b7280">['+esc(t.priority)+']</span>':''); }));
      end();
    }

    var remManual=(PropertiesService.getScriptProperties().getProperty('EV_DIGEST_REMINDERS')||'').trim();
    var remArr = remManual
      ? remManual.split('\n').map(function(s){return esc(s.trim());}).filter(function(s){return s;})
      : ['Collect small payments <b>UPFRONT</b>. We do <b>NOT</b> take any job under <b>$350</b> (our minimum).',
         'We now offer a <b>3% referral fee</b>, added to the cost of referred jobs - mention it to happy customers.',
         'When quoting <b>any</b> customer, always collect their <b>email address</b> - we need it to send quotes, invoices, and receipts.'];
    sec('Reminders');
    ul(remArr);
    end();

    H.push('<div style="padding:18px 22px;border-top:2px solid #39ff14;font-size:12px;color:#6b7280">Evolve Eco Blasting &middot; 780-915-5641 &middot; WWW.EVOLVEECOBLASTING.COM &middot; todd@evolveecoblasting.com</div>');
    H.push('</div>');
    return H.join('');
  } catch(e){
    try { return EV_buildMorningDigestHtml_(); } catch(e2){ return '<p>Evolve Morning Digest - builder error: '+EV_esc_(String(e))+'</p>'; }
  }
}

function EV_v3Dispatch_(S){
  var out=[];
  try{
    var sh=S.getSheetByName('Dispatch'); if(!sh) return out;
    var v=sh.getDataRange().getValues();
    var hr=-1; for(var i=0;i<Math.min(12,v.length);i++){ var j=v[i].join('|').toLowerCase(); if(j.indexOf('customer')>=0 && j.indexOf('status')>=0){hr=i;break;} }
    if(hr<0) return out;
    var Hd=v[hr]; function col(kw){ for(var k=0;k<Hd.length;k++){ if(String(Hd[k]).toLowerCase().indexOf(kw)>=0) return k; } return -1; }
    var ci=col('customer'), si=col('status'), qi=col('quote'), di=col('date'), cr=col('crew'), dep=col('deposit'), pd=col('paid'), no=col('notes');
    var seen={};
    for(var r=hr+1;r<v.length;r++){
      var cust=String(v[r][ci]||'').trim(); if(!cust || cust.toLowerCase()==='tbd') continue;
      var st=String(si>=0?v[r][si]:'').trim();
      if(/cold|stalled|complete|^done|cancel|^paid|invoiced|dead|no.?go|lost|removed|archived|scrap|junk|duplicate|quoted|awaiting|on hold/i.test(st)) continue;
      var key=cust.toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9]+/g,'').trim();
      if(seen[key]) continue; seen[key]=1;
      out.push({customer:cust,status:st,quote:qi>=0?String(v[r][qi]||'').trim():'',date:di>=0?String(v[r][di]||'').trim():'',crew:cr>=0?String(v[r][cr]||'').trim():'',deposit:dep>=0?String(v[r][dep]||'').trim():'',paid:pd>=0?String(v[r][pd]||'').trim():'',notes:no>=0?String(v[r][no]||'').trim():''});
    }
  }catch(e){}
  return out;
}

function EV_v3Todos_(S){
  var out=[];
  try{
    var sh=S.getSheetByName('To-Do'); if(!sh) return out;
    var v=sh.getDataRange().getValues();
    for(var r=0;r<v.length;r++){
      var num=String(v[r][0]||'').trim(); if(!/^\d+$/.test(num)) continue;
      var title=String(v[r][1]||'').trim(); var pri=String(v[r][3]||'').trim(); var st=String(v[r][4]||'').trim();
      if(/^done|^cancel/i.test(st)) continue;
      out.push({num:num,title:title,priority:pri,_hi:/high|urgent/i.test(pri)?0:(/med/i.test(pri)?1:2)});
    }
    out.sort(function(a,b){return a._hi-b._hi;});
  }catch(e){}
  return out;
}


/** Data-driven "Today's focus": open Action Items from the Ops sheet (the single
 *  source of truth). Respects Matt's status edits — anything not starting with
 *  open / in progress / blocked (i.e. Done, Closed, Superseded, Removed) is excluded,
 *  so corrections stick. Deduped by KEY (or Relates-To) so nothing repeats. HIGH first. */
function EV_v3Focus_(S){
  var out=[], seen={};
  try{
    var sh=S.getSheetByName('Action Items'); if(!sh) return [];
    var v=sh.getDataRange().getDisplayValues();
    for(var r=6;r<v.length;r++){
      var alert=String(v[r][1]||'').trim();
      var relates=String(v[r][3]||'').trim();
      var status=String(v[r][6]||'').trim();
      var notes=String(v[r][7]||'');
      if(!alert) continue;
      if(/^(AUTO-RAISE RULES|STATUS)\b/i.test(alert)) continue;      // legend rows
      if(/has a past-due next action|duplicate auto-raised/i.test(alert)) continue; // auto-raise tracking noise - not a focus priority
      if(!/^(open|in[\s-]?progress|blocked)/i.test(status)) continue; // respect done/closed/removed
      var km=notes.match(/KEY:\s*([^\n\]]+)/i);
      var key=String(km?km[1]:(relates||alert)).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,60);
      if(seen[key]) continue; seen[key]=1;
      var hi=/(—|-)\s*high|high priority|urgent|\bHIGH\b/i.test(status+' '+alert);
      var s=EV_esc_(alert);
      if(relates && relates.toLowerCase()!==alert.toLowerCase()) s+=' <span style="color:#6b7280">('+EV_esc_(relates)+')</span>';
      out.push({s:s, hi:hi});
    }
    out.sort(function(a,b){return (a.hi?0:1)-(b.hi?0:1);});
  }catch(e){}
  return out.map(function(o){return o.s;});
}
