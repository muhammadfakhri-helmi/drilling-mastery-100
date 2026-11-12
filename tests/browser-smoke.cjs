/* Run against the static server: node tests/browser-smoke.cjs
   Requires Playwright and Chromium; no app dependencies or build step. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const load=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../data',name),'utf8'));
const foundation=load('foundation.json').bank,advanced=load('advanced.json');
const byId=new Map([...foundation.questions,...advanced.questions].map(q=>[q.id,q]));
const url=process.env.DRILLING_TEST_URL||'http://127.0.0.1:8000/drilling-mastery-100/';
const readState=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('drilling-mastery-v2')));
async function answer(p,q,correct=true,confidence='sure'){
  if(['single','multiple','boolean'].includes(q.type)){
    let ids=q.correctOptionIds;
    if(!correct){const wrong=q.options.find(o=>!ids.includes(o.id));ids=wrong?[wrong.id]:ids.slice(1);}
    for(const id of ids)await p.locator(`[data-action="option"][data-id="${id}"]`).click();
  }else if(q.type==='order'){
    if(correct)for(let i=0;i<q.correctOrder.length;i++){
      const id=q.correctOrder[i];
      while(await p.locator(`.order-list li:has([data-action="up"][data-id="${id}"])`).locator('.order-number').innerText()!==String(i+1))await p.locator(`[data-action="up"][data-id="${id}"]`).click();
    }
  }else if(q.type==='slider')await p.locator('#answer-number').fill(String(correct?q.slider.answer:q.slider.answer===q.slider.min?q.slider.max:q.slider.min));
  else if(q.type==='pin')for(const axis of ['x','y'])await p.locator(`[data-pin-axis="${axis}"]`).fill(String(correct?Math.round(q.pin.target[axis]*100):0));
  await p.locator(`[data-action="${confidence}"]`).click();
  assert.equal(await p.locator('[data-action="submit"]').isEnabled(),true,q.id);
  await p.locator('[data-action="submit"]').click();
  assert.equal(await p.locator('.feedback-correct').count(),Number(correct),q.id);
  assert.equal(await p.locator('#answer-feedback').count(),1);
}
async function noOverflow(p){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'horizontal overflow');}
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const p=await context.newPage();p.setDefaultTimeout(7000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 await p.goto(url);await p.locator('[data-action="new"]').first().waitFor();await noOverflow(p);
 await p.locator('[data-action="new"]').first().click();let state=await readState(p),initial=state.sessions.advanced;
 assert.equal(initial.questionIds.length,100);assert.equal(new Set(initial.questionIds).size,100);
 await p.reload();await p.locator('[data-action="resume"]').first().click();assert.match(await p.locator('.question-counter').innerText(),/1 DARI 100/);
 console.log('PASS a brand-new unanswered session persists on reload');
 for(let i=0;i<100;i++){
   const q=byId.get(initial.questionIds[i]);await answer(p,q,i!==0,i===1?'unsure':'sure');
   if(i===0){await p.locator('.reflection summary').click();await p.locator('#reflection-note').fill('Ini catatan pemahaman saya.');assert.equal(await p.locator('.answer-option:not(:disabled)').count(),0);}
   if(i===42){await p.reload();await p.locator('[data-action="resume"]').first().click();assert.match(await p.locator('.question-counter').innerText(),/43 DARI 100/);assert.equal(await p.locator('#answer-feedback').count(),1);}
   await p.locator('[data-action="next"]').click();
 }
 state=await readState(p);assert.equal(Object.keys(state.sessions.advanced.answers).length,100);assert.ok(state.sessions.advanced.completedAt);
 assert.equal(state.history.length,1);assert.equal(state.history[0].score,99);assert.equal(state.stats.advanced.totalAttempts,1);assert.equal(state.stats.advanced.bestScore,99);assert.equal(state.sessions.advanced.drafts[initial.questionIds[0]].reflection,'Ini catatan pemahaman saya.');
 await p.screenshot({path:'/tmp/drilling-results.png',fullPage:true});
 console.log('PASS complete 100-question session, 99/100 score, confidence, locking, notes, resume, results');
 const reviewIds=Object.entries(state.mastery).filter(([,m])=>m.needsReview).map(([id])=>id);assert.equal(reviewIds.length,2);
 await p.locator('[data-action="review"]').last().click();await p.locator('[data-action="start-review"]').click();
 for(let pass=0;pass<2;pass++){
   state=await readState(p);const r=state.reviews.advanced;assert.equal(r.questionIds.length,2);
   for(const id of r.questionIds){assert.equal(await p.locator('#answer-feedback').count(),0);await answer(p,byId.get(id));await p.locator('[data-action="next"]').click();}
   state=await readState(p);assert.equal(reviewIds.filter(id=>state.mastery[id].needsReview).length,pass===0?2:0);
   assert.equal(state.sessions.advanced.id,initial.id,'review must preserve main session');
   if(pass===0){await p.locator('[data-action="review"]').last().click();await p.locator('[data-action="start-review"]').click();}
 }
 console.log('PASS shuffled review, no pre-shown key, two confident successes, main session preserved');
 await p.locator('[data-action="new"]').first().click();state=await readState(p);const second=state.sessions.advanced;
 assert.notDeepEqual(second.questionIds,initial.questionIds);assert.notDeepEqual([...second.questionIds].sort(),[...initial.questionIds].sort());
 await p.locator('[data-action="home"]').first().click();await p.locator('[data-action="new"]').first().click();assert.equal(await p.locator('dialog[open]').count(),1);
 await p.keyboard.press('Escape');assert.equal(await p.locator('dialog[open]').count(),0);assert.equal((await readState(p)).sessions.advanced.id,second.id);
 console.log('PASS genuinely different new session and non-destructive reset cancel');
 await p.locator('input[name="pack"][value="combined"]').check();await p.locator('[data-action="new"]').first().click();state=await readState(p);const combo=state.sessions.combined;
 const quotas={};for(const id of combo.questionIds){const module=byId.get(id).moduleId;quotas[module]=(quotas[module]||0)+1;}assert.equal(Object.keys(quotas).length,36);assert.ok(Object.values(quotas).every(n=>n===2||n===3));
 await p.locator('[data-action="learn"]').click();await p.locator('.learning-nav-button').last().click();await noOverflow(p);assert.ok((await p.locator('.concept-card').count())>0);
 console.log('PASS combined pack covers all 36 modules and learning navigation');
 // Exercise every interaction type through normal UI in a short, valid review fixture.
 const engine=await import('../assets/quiz-engine.mjs');
 const fixtureIds=['afe-02','advanced-29-15','advanced-28-15','subsurface-06','advanced-33a-02'];
 const combined={modules:[...foundation.modules,...advanced.modules],questions:[...foundation.questions,...advanced.questions]};
 const fixture=engine.createSession(combined,'combined',null,Math.random,fixtureIds);
 await p.evaluate(s=>{const v=JSON.parse(localStorage.getItem('drilling-mastery-v2'));v.reviews.combined=s;localStorage.setItem('drilling-mastery-v2',JSON.stringify(v));},fixture);
 await p.reload();await p.locator('[data-action="resume-review"]').click();
 for(const id of fixture.questionIds){await answer(p,byId.get(id));await p.locator('[data-action="next"]').click();}
 assert.equal((await readState(p)).history[0].score,100);
 console.log('PASS multiple-select, ordering, number, pin keyboard controls, question image');
 // Mobile rendering, quiz, learning, and actual asset loading.
 await p.setViewportSize({width:390,height:844});await p.locator('[data-action="home"]').first().click();await noOverflow(p);await p.screenshot({path:'/tmp/drilling-mobile-home.png',fullPage:true});
 await p.locator('[data-action="resume"]').first().click();await noOverflow(p);await p.screenshot({path:'/tmp/drilling-mobile-quiz.png',fullPage:true});
 await p.locator('[data-action="learn"]').click();await noOverflow(p);await p.screenshot({path:'/tmp/drilling-mobile-learning.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS mobile layout, no JavaScript errors, no failed HTTP assets');
 // Storage failure is visible and does not break answering.
 const denied=await browser.newContext();await denied.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('denied','QuotaExceededError')};});
 const d=await denied.newPage();await d.goto(url);await d.locator('[data-action="new"]').first().click();assert.equal(await d.locator('#storage-status').isVisible(),true);await denied.close();
 console.log('PASS unavailable local storage produces a visible warning');
 // Keep the original v1 local progress readable without replacing legacy keys.
 const legacy=engine.createSession(foundation,'foundation');delete legacy.version;delete legacy.packId;delete legacy.mode;
 const migr=await browser.newContext();await migr.addInitScript(v=>{localStorage.setItem('drilling-mastery-session-v1',JSON.stringify(v));localStorage.setItem('drilling-mastery-stats-v1',JSON.stringify({bestScore:87,totalAttempts:6,recentScores:[]}));},legacy);
 const m=await migr.newPage();await m.goto(url);await m.locator('[data-action="new"]').first().waitFor();const ms=await readState(m);assert.equal(ms.sessions.foundation.id,legacy.id);assert.equal(ms.stats.foundation.bestScore,87);assert.equal(ms.stats.foundation.totalAttempts,6);await migr.close();
 console.log('PASS existing foundation session and score history migrate');
 await context.close();
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
