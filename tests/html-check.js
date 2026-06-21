const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.argv[2],'utf8');
const blocks=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
console.log('script blocks found: '+blocks.length);
let ok=true;
blocks.forEach((b,i)=>{ try{ new vm.Script(b,{filename:'Index.html#script'+i}); console.log('OK    script['+i+'] '+b.length+' chars'); }catch(e){ ok=false; console.log('FAIL  script['+i+'] -> '+e.message); } });
console.log('RESULT: '+(ok?'Index.html client JS parses clean':'JS SYNTAX ERROR'));
process.exit(ok?0:1);
