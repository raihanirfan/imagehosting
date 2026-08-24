#!/usr/bin/env node
// recreate token helper on demand — run: node scripts/get-drive-token.mjs <cid> <csec>
import http from 'node:http';
import readline from 'node:readline';
const PORT=53682,REDIRECT=`http://localhost:${PORT}/callback`,SCOPE='https://www.googleapis.com/auth/drive';
function ask(q){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(r=>rl.question(q,a=>{rl.close();r(a.trim());}));}
let cid=process.argv[2],csec=process.argv[3];
if(!cid) cid=await ask('GOOGLE_CLIENT_ID: '); else cid=cid.trim();
if(!csec) csec=await ask('GOOGLE_CLIENT_SECRET: '); else csec=csec.trim();
if(!cid||!csec){console.error('need CLIENT_ID + CLIENT_SECRET');process.exit(1);}
const authUrl=`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cid)}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;
console.log('\n1) Buka URL ini:\n',authUrl,'\n2) Allow -> redirect ke',REDIRECT,'\nMenunggu...\n');
const code=await new Promise((resolve,reject)=>{const s=http.createServer((req,res)=>{const u=new URL(req.url,`http://localhost:${PORT}`);if(u.pathname==='/callback'){const c=u.searchParams.get('code'),e=u.searchParams.get('error');if(e){res.writeHead(400,{'Content-Type':'text/html'});res.end('<h1>OAuth error</h1>');s.close();reject(new Error(e));return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<h1>OK — balik ke terminal</h1>');s.close();resolve(c);}else{res.writeHead(404);res.end();}});s.listen(PORT,'127.0.0.1');s.on('error',reject);});
console.log('Code',code.slice(0,20)+'...');
const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cid,client_secret:csec,code,grant_type:'authorization_code',redirect_uri:REDIRECT})});
const j=await r.json();if(!j.refresh_token){console.error('Gagal',JSON.stringify(j,null,2));console.error('Hapus di myaccount.google.com/permissions lalu ulangi');process.exit(1);}
console.log('\n=== SUKSES ===\nrefresh_token:',j.refresh_token,'\naccess_token:',j.access_token.slice(0,20)+'...\nwrangler secret put GOOGLE_REFRESH_TOKEN');
