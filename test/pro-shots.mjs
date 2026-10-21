import { chromium, devices } from 'playwright';
const [base, pre] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], geolocation:{latitude:40.81,longitude:-73.88}, permissions:['geolocation'] });
const p = await ctx.newPage(); if (pre==='after-fresh') {} else await p.addInitScript(()=>{localStorage.setItem('tn_greeted','true');localStorage.setItem('tn_tourDone','true')});
await p.goto(base); await p.waitForFunction(()=>window.TruckNav?.ready,null,{timeout:30000}); await p.waitForTimeout(4000);
const D='/workspace/truckers-gps-shots/pro/'+pre;
await p.screenshot({path:D+'-1-map.png'});
if (pre==='after-fresh') { await p.waitForTimeout(1500); await p.screenshot({path:D+'-tour.png'}); await b.close(); process.exit(); }
await p.click('[data-panel=truckPanel]'); await p.waitForTimeout(600); await p.screenshot({path:D+'-2-truck.png'}); await p.click('#truckPanel .close');
await p.click('#reportBtn'); await p.waitForTimeout(600); await p.screenshot({path:D+'-3-report.png'}); await p.keyboard.press('Escape'); await p.reload(); await p.waitForFunction(()=>window.TruckNav?.ready); await p.waitForTimeout(2000);
// fake nav banner
await p.evaluate(()=>{document.body.classList.add('nav');for(const id of ['banner','tripBar','thenBox'])document.getElementById(id).classList.remove('hidden');bArrow.textContent='↱';bDist.textContent='0.4 mi';bInstr.textContent='I-95 S / New Jersey Turnpike';thenBox.textContent='Then ↗ Exit 14';tEta.textContent='6:42 PM';tLeft.textContent='1 h 12';tDist.textContent='48';const L=document.getElementById('lanes');if(L){L.innerHTML='<span class="lane">↰</span><span class="lane">↑</span><span class="lane ok">↑</span><span class="lane ok">↱</span>';L.classList.remove('hidden')}const s=document.getElementById('limitSign');if(s){s.classList.remove('hidden');limitVal.textContent='55'};speed.textContent='52'});
await p.waitForTimeout(800); await p.screenshot({path:D+'-4-nav.png'}); await b.close();
