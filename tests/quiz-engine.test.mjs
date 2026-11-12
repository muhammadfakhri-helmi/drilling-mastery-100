import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createSession, selectQuestions, shuffle, grade, updateMastery, summarize, isValidSession, answerText, correctText, isEligible, refreshSession } from '../assets/quiz-engine.mjs';
const read = name => JSON.parse(readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
const {bank:foundation,lessons:foundationLessons}=read('foundation.json');
const advanced=read('advanced.json'), advancedLessons=read('advanced-lessons.json');
const combined={modules:[...foundation.modules,...advanced.modules],questions:[...foundation.questions,...advanced.questions]};
function seeded(seed) { return () => {seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}; }
function valueFor(q) {return q.type==='slider'?q.slider.answer:q.type==='pin'?{...q.pin.target}:q.type==='order'?[...q.correctOrder]:[...q.correctOptionIds];}

test('all 565 archived and concept questions have unique IDs, valid keys, media, and concept explanations',()=>{
  assert.equal(foundation.questions.length,280);assert.equal(advanced.questions.length,285);
  assert.equal(new Set(combined.questions.map(q=>q.id)).size,565);
  const concepts=new Map([...foundationLessons,...advancedLessons].flatMap(l=>l.concepts.flatMap(c=>c.questionIds.map(id=>[id,c]))));
  for(const bank of [foundation,advanced]){
    assert.equal(bank.modules.length,18);
    for(const module of bank.modules)assert.equal(bank.questions.filter(q=>q.moduleId===module.id).length,module.questionCount);
    for(const q of bank.questions){
      assert.ok(q.prompt.length>5,q.id);assert.ok(q.explanation.length>10,q.id);if(isEligible(q))assert.ok(concepts.has(q.id),q.id);
      assert.equal(Boolean(grade(q,valueFor(q))),true,q.id);
      if(q.options){assert.ok(q.options.every(o=>o.text.trim()),q.id);assert.equal(new Set(q.options.map(o=>o.id)).size,q.options.length);}
      if(q.media)assert.ok(existsSync(new URL('../'+q.media.replace(/^\//,''),import.meta.url)),q.id);
    }
  }
});
for(const [name,bank]of Object.entries({foundation,advanced,combined})){
  test(`${name}: 500 sessions contain exactly 100 unique questions with every topic proportioned`,()=>{
    const byId=new Map(bank.questions.map(q=>[q.id,q]));let previous=null;
    for(let seed=1;seed<=500;seed++){
      const s=createSession(bank,name,previous,seeded(seed));
      assert.equal(s.questionIds.length,100);assert.equal(new Set(s.questionIds).size,100);assert.ok(isValidSession(s,bank));
      const quotas=new Map(bank.modules.map(m=>[m.id,0]));
      for(const id of s.questionIds){const q=byId.get(id);assert.ok(isEligible(q));quotas.set(q.moduleId,quotas.get(q.moduleId)+1);
        if(q.options?.length)assert.deepEqual([...s.optionOrders[id]].sort(),q.options.map(o=>o.id).sort());
        if(q.type==='order')assert.notDeepEqual(s.orderStates[id],q.correctOrder);
      }
      const base=Math.floor(100/bank.modules.length);
      assert.ok([...quotas.values()].every(n=>n===base||n===base+1));
      assert.equal([...quotas.values()].filter(n=>n===base+1).length,100%bank.modules.length);
      if(previous){assert.notDeepEqual(s.questionIds,previous.questionIds);assert.notDeepEqual([...s.questionIds].sort(),[...previous.questionIds].sort());}
      previous=s;
    }
  });
}
test('new sessions use available questions outside the preceding session first',()=>{
  const first=createSession(advanced,'advanced',null,seeded(2));const second=createSession(advanced,'advanced',first,seeded(3));
  for(const m of advanced.modules){
    const pool=advanced.questions.filter(q=>q.moduleId===m.id&&isEligible(q));
    const unseen=pool.filter(q=>!first.questionIds.includes(q.id));
    const selected=second.questionIds.filter(id=>pool.some(q=>q.id===id));
    assert.equal(selected.filter(id=>unseen.some(q=>q.id===id)).length,Math.min(selected.length,unseen.length));
  }
});
test('randomization never mutates source data, and repeated option orders change',()=>{
  const snapshot=JSON.stringify(advanced);const a=createSession(advanced,'advanced',null,seeded(15));
  const b=createSession(advanced,'advanced',a,seeded(15));
  for(const id of b.questionIds.filter(id=>a.optionOrders[id]&&b.optionOrders[id]))assert.notDeepEqual(b.optionOrders[id],a.optionOrders[id]);
  assert.equal(JSON.stringify(advanced),snapshot);const source=[1,2,3];shuffle(source,seeded(3));assert.deepEqual(source,[1,2,3]);
});
test('single, boolean, and multiple grading is independent of shuffled visual labels',()=>{
  for(const q of combined.questions.filter(q=>q.correctOptionIds)){
    assert.equal(grade(q,[...q.correctOptionIds].reverse()),true,q.id);
    assert.equal(grade(q,[]),false,q.id);assert.equal(grade(q,[...q.correctOptionIds,...q.correctOptionIds]),false,q.id);
    const wrong=q.options.find(o=>!q.correctOptionIds.includes(o.id));if(wrong)assert.equal(grade(q,[...q.correctOptionIds,wrong.id]),false,q.id);
    if(q.correctOptionIds.length>1)assert.equal(grade(q,q.correctOptionIds.slice(1)),false,q.id);
  }
});
test('ordering, numeric, and pin interactions enforce correct values and boundaries',()=>{
  for(const q of combined.questions){
    if(q.type==='order')assert.equal(grade(q,[...q.correctOrder].reverse()),false,q.id);
    if(q.type==='slider'){assert.equal(grade(q,q.slider.answer+q.slider.step),false);assert.equal(grade(q,String(q.slider.answer)),false);assert.equal(grade(q,NaN),false);}
    if(q.type==='pin'){assert.equal(Boolean(grade(q,{x:0,y:0})),false);assert.equal(Boolean(grade(q,null)),false);}
  }
});
test('incorrect answers stay in review until two consecutive correct answers, without confidence',()=>{
  const answer=correct=>({correct,answeredAt:123});
  let m=updateMastery(null,answer(false));assert.equal(m.needsReview,true);assert.equal(m.streak,0);
  m=updateMastery(m,answer(true));assert.equal(m.needsReview,true);assert.equal(m.streak,1);
  m=updateMastery(m,{...answer(true),confidence:'unsure'});assert.equal(m.streak,2);assert.equal(m.needsReview,false);
  m=updateMastery(m,answer(false));assert.equal(m.streak,0);assert.equal(m.needsReview,true);assert.equal(m.attempts,4);
  assert.equal(updateMastery(null,answer(true)).needsReview,false);
});
test('review sessions deduplicate and exclude unknown or quarantined questions',()=>{
  const s=createSession(advanced,'advanced',null,seeded(1),['advanced-28-19','advanced-38-01','advanced-38-01','missing','advanced-38-02']);
  assert.equal(s.mode,'review');assert.equal(s.questionIds.length,2);assert.ok(isValidSession(s,advanced));assert.throws(()=>createSession(advanced,'advanced',null,seeded(1),[]));
});
test('partial sessions and per-topic results use the actual 100-question denominator',()=>{
  const s=createSession(advanced,'advanced',null,seeded(1));
  for(const [i,id] of s.questionIds.entries()){const q=advanced.questions.find(q=>q.id===id);s.answers[id]={value:valueFor(q),correct:i<75,confidence:i<25?'unsure':'sure'};}
  const r=summarize(s,advanced);assert.equal(r.score,75);assert.equal(r.correct,75);assert.equal(r.incorrect,25);assert.equal(r.topics.reduce((n,t)=>n+t.total,0),100);assert.equal(r.topics.reduce((n,t)=>n+t.correct,0),75);
});
test('malformed storage cannot turn duplicates, invalid choices, or incomplete runs into valid sessions',()=>{
  const s=createSession(advanced,'advanced',null,seeded(7));assert.ok(isValidSession(JSON.parse(JSON.stringify(s)),advanced));
  const mutate=fn=>{const c=structuredClone(s);fn(c);assert.equal(isValidSession(c,advanced),false);};
  mutate(c=>c.questionIds[1]=c.questionIds[0]);mutate(c=>c.currentIndex=-1);mutate(c=>c.completedAt=123);
  mutate(c=>c.optionOrders[c.questionIds.find(id=>c.optionOrders[id])]=['bad']);
  mutate(c=>c.answers[c.questionIds[0]]={value:{},correct:false,confidence:'sure'});
  mutate(c=>c.drafts='broken');
  const q=advanced.questions.find(q=>s.questionIds.includes(q.id)&&q.type==='single');
  mutate(c=>c.drafts[q.id]={value:'broken',confidence:null,reflection:''});
});
test('source keys and explanations retain case-study context and flag ambiguous budget question',()=>{
  const q=id=>advanced.questions.find(q=>q.id===id);
  assert.equal(q('advanced-28-19').reviewRequired,true);
  assert.equal(correctText(q('advanced-38-01')),'Electromagnetic MWD');
  assert.equal(correctText(q('advanced-29-03')),'Store and spool the tubing');
  assert.equal(q('advanced-33b-06').correctOptionIds.length,3);
  assert.equal(q('advanced-28-15').slider.answer,12);
  assert.match(q('advanced-22-03').prompt,/not a universal definition/);
  assert.equal(answerText(q('advanced-29-14'),q('advanced-29-14').correctOrder),'Reel → Gooseneck → Injector Head → Wellhead');
});

test('curated packs exclude brands, organization trivia, named units, and historical cases',()=>{
  assert.equal(foundation.questions.filter(isEligible).length,271);
  assert.equal(advanced.questions.filter(isEligible).length,263);
  assert.equal(combined.questions.filter(isEligible).length,534);
  const forbidden=/Power BI|Varco|Shaffer|Weatherford|Precision Northland|NESR|Bell 407|AMICS|South Sumatra|2017–2019|Diamond Sponsors|JDS|SPE-217910|promotional materials/i;
  for(const q of combined.questions.filter(isEligible))assert.doesNotMatch([q.prompt,q.explanation,...(q.options||[]).map(o=>o.text)].join(' '),forbidden,q.id);
  for(const lessons of [foundationLessons,advancedLessons])for(const l of lessons)for(const c of l.concepts){
    assert.doesNotMatch(c.explanation,forbidden,c.id);
    assert.ok(c.questionIds.every(id=>isEligible(combined.questions.find(q=>q.id===id))),c.id);
  }
  const review=createSession(advanced,'advanced',null,seeded(9),['advanced-36-07','advanced-22-13','advanced-29-09','advanced-38-01']);
  assert.deepEqual(review.questionIds,['advanced-38-01']);
});

test('unfinished old sessions replace excluded questions in the same topics and preserve eligible work',()=>{
  const oldBank={...advanced,questions:advanced.questions.map(q=>({...q,excluded:false}))};
  const original=createSession(oldBank,'advanced',null,seeded(7));
  const excluded=original.questionIds.filter(id=>!isEligible(advanced.questions.find(q=>q.id===id)));
  assert.ok(excluded.length>0);
  const safeId=original.questionIds.find(id=>isEligible(advanced.questions.find(q=>q.id===id)));
  const safe=advanced.questions.find(q=>q.id===safeId);
  original.answers[safeId]={value:valueFor(safe),correct:true,confidence:'sure',answeredAt:1};
  original.drafts[safeId]={value:valueFor(safe),confidence:'sure',reflection:'Catatan yang harus tetap ada.'};
  original.currentIndex=original.questionIds.indexOf(excluded[0]);
  const {session:s,changed}=refreshSession(original,advanced,seeded(99));
  assert.equal(changed,true);assert.equal(s.id,original.id);assert.equal(s.questionIds.length,100);assert.equal(new Set(s.questionIds).size,100);
  assert.ok(s.questionIds.every(id=>isEligible(advanced.questions.find(q=>q.id===id))));assert.ok(isValidSession(s,advanced));
  assert.deepEqual(s.answers[safeId],original.answers[safeId]);assert.deepEqual(s.drafts[safeId],original.drafts[safeId]);
  for(let i=0;i<100;i++)assert.equal(advanced.questions.find(q=>q.id===s.questionIds[i]).moduleId,oldBank.questions.find(q=>q.id===original.questionIds[i]).moduleId);
  assert.equal(refreshSession(s,advanced).changed,false);
});

test('old review queues are filtered, empty queues disappear, and completed score records stay unchanged',()=>{
  const oldBank={...advanced,questions:advanced.questions.map(q=>({...q,excluded:false}))};
  const old=createSession(oldBank,'advanced',null,seeded(8),['advanced-36-07','advanced-38-01']);
  const result=refreshSession(old,advanced);assert.deepEqual(result.session.questionIds,['advanced-38-01']);assert.ok(isValidSession(result.session,advanced));
  const empty=createSession(oldBank,'advanced',null,seeded(8),['advanced-36-07']);assert.equal(refreshSession(empty,advanced).session,null);
  const complete={...old,completedAt:123};assert.deepEqual(refreshSession(complete,advanced),{session:complete,changed:false});
});

test('every eligible question has its own reasoning, with formula and comparison content',()=>{
  const reasoning=read('reasoning.json');
  assert.equal(Object.keys(reasoning).length,534);
  for(const q of combined.questions.filter(isEligible)){
    const r=reasoning[q.id];assert.ok(r?.why.length>35,q.id);
    if(q.type!=='boolean')assert.ok(r.compare?.length>15,q.id);
    assert.doesNotMatch(r.why,/jawaban.*sesuai kunci|karena.*benar sesuai materi/i,q.id);
  }
  assert.match(reasoning['well-control-03'].why,/0,052.*9.*1.000.*468/);
  assert.match(reasoning['intro-08'].why,/47,04.*220.*267/);
  assert.match(reasoning['well-construction-20'].compare,/MD/);
  assert.equal(foundation.questions.find(q=>q.id==='hse-20').reviewRequired,true);
});
test('sessions without confidence and older saved records both remain valid',()=>{
  const s=createSession(advanced,'advanced',null,seeded(1));const q=advanced.questions.find(q=>q.id===s.questionIds[0]);
  s.answers[q.id]={value:valueFor(q),correct:true,answeredAt:1};
  s.drafts[q.id]={value:valueFor(q),reflection:'Pertahankan catatan.'};assert.ok(isValidSession(s,advanced));
  s.answers[q.id].confidence='unsure';s.drafts[q.id].confidence=null;assert.ok(isValidSession(s,advanced));
});
