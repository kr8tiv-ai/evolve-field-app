const fs=require('fs'),vm=require('vm'),path=require('path');
const dir=process.argv[2];
const files=['Hardening.gs','OcrFill.gs','AutoServer.gs','Filing.gs','Code.gs','ReceiptOps.gs','Backups.gs'];
let ok=true;
for(const f of files){
  try{ new vm.Script(fs.readFileSync(path.join(dir,f),'utf8'),{filename:f}); console.log('OK    '+f); }
  catch(e){ ok=false; console.log('FAIL  '+f+' -> '+e.message); }
}
console.log('RESULT: '+(ok?'all .gs parse clean':'SYNTAX ERRORS'));
process.exit(ok?0:1);
