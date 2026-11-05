import { chromium, devices } from 'playwright';
const BASE='https://ace9x.github.io/truckers-gps/';
const br = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await br.newContext({ ...devices['iPhone 13'], permissions:['geolocation'], geolocation:{latitude:40.7506,longitude:-73.9935} });
await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen','1'); localStorage.setItem('rr_ping_test','1'); });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e => errs.push('pageerror '+e.message)); p.on('console', m => { if (m.type()==='error') errs.push('console '+m.text()); });
let failed=0; const ok=(c,m)=>{ if(!c) failed++; console.log((c?'ok   ':'FAIL ')+m); };
await p.goto(BASE); await p.waitForTimeout(3000);
if (await p.$('#langFirst [data-l="en"]')) await p.tap('#langFirst [data-l="en"]'); await p.waitForTimeout(800);
if (await p.$('#tSkip')) await p.tap('#tSkip').catch(()=>{}); await p.waitForTimeout(6000);
const vis = async re => p.evaluate(src => { const re=new RegExp(src,'i'); return [...document.querySelectorAll('button,a,summary,p,h2,h3,label')].filter(e=>e.offsetParent && re.test(e.textContent)).map(e=>e.textContent.trim().slice(0,60)); }, re);
ok((await vis('sign in|sign up|create account|continue with google|log ?in')).length===0, 'no sign-in on main screen');
ok(await p.evaluate(()=>{ const b=document.querySelector('#acctBtn'); return !b || !b.offsetParent; }), 'account chip hidden');
await p.evaluate(()=>document.querySelector('#meBtn')?.click()); await p.waitForTimeout(1500);
const me = await vis('sign in|sign up|create account|google|log ?in'); ok(me.length===0, 'Me panel has no sign-in: '+JSON.stringify(me));
ok(/No account needed/.test(await p.textContent('#acctBox').catch(()=>'')), 'Me shows guest text');
// Report a bug as guest
await p.evaluate(()=>{ document.querySelector('#bugBox').open=true; }); await p.fill('#bugDesc','[automated guest test] ignore — no-accounts release check'); await p.click('#bugSend'); await p.waitForTimeout(4000);
const bm = await p.textContent('#bugMsg'); ok(/Thanks/.test(bm), 'bug report as guest: '+bm);
// What's New + Ask RigRoute
const wn = await p.evaluate(async()=>{ const m=await import('./js/guide.js'); const l=await m.changelog(); return l[0]?.version; }); ok(wn==='3.29.7', 'changelog top '+wn);
const ask = await p.evaluate(async()=>{ const m=await import('./js/guide.js'); return m.askAI('how do I report a bug', window.TruckNav); }); ok(!!ask.text && !/sign in/i.test(ask.text), 'Ask RigRoute answered (ai='+ask.ai+'): '+ask.text.slice(0,90));
const mv = await p.evaluate(async()=>{ const S=window.TruckNav; const old=S.pos; S.pos={...(old||{lat:40.75,lon:-73.99}),speed:15}; let spoke=0; const o=speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak=u=>{spoke++;}; const m=await import('./js/guide.js'); const r=await m.askAI('how do I add a stop', S); speechSynthesis.speak=o; S.pos=old; return {v:r.voiceOnly, spoke, ai:r.ai}; }); ok(mv.v===true && mv.spoke>0, 'moving: answer voice-only '+JSON.stringify(mv));
// Active ping
await p.evaluate(async()=>{ localStorage.removeItem('rr_ping_day'); const m=await import('./js/active.js'); await m.ping(); }); ok(!!await p.evaluate(()=>localStorage.getItem('rr_ping_day')), 'anonymous active ping stored');
// Hazard as guest
const hz = await p.evaluate(async()=>{ const S=window.TruckNav; for(let i=0;i<20&&!S.backend;i++) await new Promise(r=>setTimeout(r,500)); const r=await S.backend.addReport({id:crypto.randomUUID(),type:'police',lat:40.75,lon:-73.99,t:Date.now(),up:0,down:0,note:'[automated guest test]'}); const list=await S.backend.listReports(); return [r?.server===true, list.some(x=>x.id===r.id && x.server), r.id]; }); ok(hz[0] && hz[1], 'guest hazard shared to server and visible to all: '+hz);
const bad = await p.evaluate(async()=>{ const c=await (await import('./js/cloud.js')).sb(); const a=await c.from('hazards').insert({type:'police',lat:40.7,lng:-73.9}); const b=await c.rpc('guest_report_hazard',{p_device:'x',p_type:'police',p_lat:40.7,p_lng:-73.9}); const d=await c.rpc('guest_report_hazard',{p_device:localStorage.rr_dev,p_type:'evil',p_lat:40.7,p_lng:-73.9}); return [!!a.error, !!b.error, !!d.error]; }); ok(bad.every(Boolean), 'direct anon insert / bad device / bad type rejected '+bad);
// Routing
const rt = await p.evaluate(async()=>{ const S=window.TruckNav; S.setDest({lon:-73.9442,lat:40.6782,name:'Test dest'}); for(let i=0;i<60&&!S.route;i++) await new Promise(r=>setTimeout(r,500)); return S.route ? (S.route.distance ?? S.route.summary?.length ?? 'yes') : null; }); ok(!!rt, 'truck route planned as guest: '+rt);
// HOS / loads / friends panels
for (const id of ['#loadsBtn','#friendsBtn']) { await p.evaluate(s=>document.querySelector(s)?.click(), id); await p.waitForTimeout(1500); const v=await vis('sign in|sign up|create account|google'); ok(v.length===0, id+' no sign-in prompt '+JSON.stringify(v)); }
const hos = await p.evaluate(()=>!!(window.TruckNav.hos || document.querySelector('[id*=hos i]'))); ok(hos,'HOS present');
// Switch / Keep: TEST-ONLY mock (stubbed valhalla + traffic delta inside this page); production code unchanged
const sw = async (btn) => p.evaluate(async (btn)=>{ const S=window.TruckNav, T=S.traffic; const ov=S.valhalla, ort=T.routeTraffic, orem=S.remT; const before=S.route;
  const alt={...S.route, time:S.route.time-600, length:S.route.length-1500, _mock:true}; S.valhalla=async()=>[alt]; T.routeTraffic=()=>({delay:0}); S.remT=S.route.time+1200; S.trafficDelay=0;
  await T.suggest({delay:1200, slowdowns:[]}); const b=document.querySelector('#tfBanner'); const has=!!b && /Faster/.test(b.textContent);
  [...(b?.querySelectorAll('button')||[])].find(x=>x.textContent===btn)?.click(); await new Promise(r=>setTimeout(r,800));
  S.valhalla=ov; T.routeTraffic=ort; S.remT=orem; return { offered:has, switched: S.routes?.[0]?._mock===true, gone:!document.querySelector('#tfBanner') }; }, btn);
const k = await sw('Keep'); ok(k.offered && !k.switched && k.gone, 'Keep: offer shown, route unchanged '+JSON.stringify(k));
const w = await sw('Switch'); ok(w.offered && w.switched && w.gone, 'Switch: offer shown, faster route taken '+JSON.stringify(w));
await p.screenshot({path:'/tmp/live-guest.png'});
// Admin page
const a = await ctx.newPage(); a.on('pageerror', e => errs.push('admin '+e.message)); a.on('console', m => { if (m.type()==='error') errs.push('admin console '+m.text()); });
await a.goto(BASE+'admin-stats.html'); await a.waitForTimeout(4000); ok(!!await a.$('#adEmail') && !/google|code/i.test(await a.textContent('#who')), 'admin-stats shows email-link only');
await a.goto(BASE+'bug-reports.html'); await a.waitForTimeout(4000); ok(!!await a.$('#adEmail'), 'bug-reports shows admin email-link');
console.log('ERRORS', JSON.stringify(errs,null,1)); ok(errs.length===0,'no console errors');
await br.close(); process.exit(failed?1:0);
