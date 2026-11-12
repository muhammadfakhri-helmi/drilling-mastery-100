import { createSession, grade, correctText, answerText, updateMastery, summarize, isValidSession, isEligible, refreshSession } from './quiz-engine.mjs?v=concepts-2';

const root = document.getElementById('root');
const STORAGE_KEY = 'drilling-mastery-v2';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = (label, action, attrs = '', style = 'secondary-button') => `<button type="button" class="${style}" data-action="${action}" ${attrs}>${label}</button>`;
const types = { single: 'Pilihan ganda', multiple: 'Pilih semua yang benar', boolean: 'Benar / salah', order: 'Susun urutan', slider: 'Jawaban angka', pin: 'Tandai gambar' };
const hints = { single: 'Pilih satu jawaban paling tepat.', multiple: 'Pilih semua jawaban yang benar, tanpa pilihan tambahan.', boolean: 'Tentukan apakah pernyataan benar atau salah.', order: 'Gunakan tombol naik/turun untuk menyusun urutan.', slider: 'Geser atau ketik nilai jawabanmu.', pin: 'Tandai titik pada gambar atau atur koordinat dengan tombol panah pada slider.' };
let banks, lessons, concepts, allQuestions, packNames;
let state = { version: 2, packId: 'advanced', sessions: {}, reviews: {}, mastery: {}, history: [], stats: {}, legacyStats: null };
let view = 'home', activeMode = 'quiz', activeModule = '', modal = null, modalReturnFocus = null, storageWarning = '', notice = '';

function readJSON(key) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : null; }
  catch { storageWarning = 'Penyimpanan lokal tidak dapat dibaca. Sesi tetap bisa digunakan selama halaman ini terbuka.'; return null; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { storageWarning = 'Progres belum bisa disimpan di browser ini. Jangan tutup halaman sebelum selesai; izinkan penyimpanan lokal untuk melanjutkan nanti.'; }
  const status = document.getElementById('storage-status');
  if (status) { status.textContent = storageWarning; status.hidden = !storageWarning; }
}
function bank() { return banks[state.packId]; }
function session() { return (activeMode === 'review' ? state.reviews : state.sessions)[state.packId]; }
function putSession(value) { (activeMode === 'review' ? state.reviews : state.sessions)[state.packId] = value; }
function question() { const s = session(); return s ? allQuestions.get(s.questionIds[s.currentIndex]) : null; }
function draftFor(q = question()) {
  const s = session();
  s.drafts ||= {};
  const answer = s.answers[q.id];
  s.drafts[q.id] ||= { value: answer ? structuredClone(answer.value) : q.type === 'order' ? [...s.orderStates[q.id]] : q.type === 'slider' ? null : q.type === 'pin' ? null : [], confidence: answer?.confidence || null, reflection: '' };
  return s.drafts[q.id];
}
function queue(packId = state.packId) {
  return banks[packId].questions.filter(q => isEligible(q) && state.mastery[q.id]?.needsReview).map(q => q.id);
}
function go(next, focus = true) {
  view = next; render();
  if (focus) { window.scrollTo({ top: 0, behavior: 'instant' }); root.querySelector('h1')?.focus({ preventScroll: true }); }
}
function start(mode = 'quiz', ids = null) {
  activeMode = mode;
  const previous = session();
  putSession(createSession(bank(), state.packId, previous, Math.random, mode === 'review' ? (ids || queue()) : null));
  save(); go('quiz');
}
function requestStart(mode) {
  if (mode === 'review' && !queue().length) return;
  const existing = (mode === 'review' ? state.reviews : state.sessions)[state.packId];
  if (existing && !existing.completedAt) {
    modalReturnFocus = document.activeElement;
    modal = { mode }; renderModal(); return;
  }
  start(mode);
}
function resume(mode) { activeMode = mode; go(session()?.completedAt ? 'results' : 'quiz'); }
function openLesson(id) { activeModule = id || activeModule || bank().modules[0].id; go('learning'); }
function finish() {
  const s = session();
  if (s.questionIds.some(id => !s.answers[id])) return;
  s.completedAt ||= Date.now();
  if (!s.recorded && !state.history.some(h => h.id === s.id)) {
    const result = summarize(s, bank());
    state.history.unshift({ id: s.id, packId: state.packId, mode: s.mode, score: result.score, correct: result.correct, total: result.total, completedAt: s.completedAt });
    state.history = state.history.slice(0, 50);
    if (s.mode === 'quiz') {
      const stats = state.stats[state.packId];
      stats.bestScore = Math.max(stats.bestScore, result.score);
      stats.totalAttempts++;
    }
    s.recorded = true;
  }
  save(); go('results');
}
function submit() {
  const s = session(), q = question(), d = draftFor(q);
  if (s.answers[q.id] || !canSubmit(q, d)) return;
  const answer = { value: structuredClone(d.value), confidence: d.confidence, correct: Boolean(grade(q, d.value)), answeredAt: Date.now() };
  s.answers[q.id] = answer;
  state.mastery[q.id] = updateMastery(state.mastery[q.id], answer);
  save(); render();
  document.getElementById('answer-feedback')?.focus({ preventScroll: true });
}
function canSubmit(q, d) {
  if (!['sure', 'unsure'].includes(d.confidence)) return false;
  if (['single','multiple','boolean'].includes(q.type)) return d.value?.length > 0;
  if (q.type === 'slider') return typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= q.slider.min && d.value <= q.slider.max;
  return Boolean(d.value);
}
function next() {
  const s = session(); if (!s.answers[question().id]) return;
  const pending = s.questionIds.findIndex((id, i) => i > s.currentIndex && !s.answers[id]);
  const earlier = s.questionIds.findIndex(id => !s.answers[id]);
  if (pending < 0 && earlier < 0) { finish(); return; }
  s.currentIndex = pending >= 0 ? pending : earlier; save(); go('quiz');
}

function source(q) {
  if (q.sourceKind === 'concept-extension') return 'Soal konsep tambahan · prinsip cost engineering dan administrasi kontrak';
  return q.sourceFile ? `${q.sourceFile.replace(' - Details - Kahoot!.pdf','')} · halaman ${q.sourcePage}, soal ${q.sourceNumber}` : `Paket dasar · ${q.moduleTitle} · soal ${q.sourceNumber}`;
}
function explanation(q) { return concepts.get(q.id)?.explanation || q.explanation; }
function heading(eyebrow, title, copy = '') {
  return `<div class="section-heading compact"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>${copy ? `<p>${copy}</p>` : ''}</div>`;
}
function header() {
  const s = session();
  return `<a class="skip-link" href="#main-content">Lewati ke konten</a><header class="site-header">
    ${btn('<span class="brand-mark" aria-hidden="true">DM</span><span><strong>Drilling Mastery</strong><small>Belajar · Uji · Pahami</small></span>', 'home', 'aria-label="Drilling Mastery — beranda"', 'brand')}
    <nav class="header-actions" aria-label="Navigasi utama">
      ${btn('Modul belajar','learn','','text-button')}
      ${btn(`Latihan ulang <span class="queue-count">${queue().length}</span>`,'review','', 'text-button')}
      ${view === 'quiz' && s ? `<span class="session-pill">${Object.keys(s.answers).length}/${s.questionIds.length} terjawab</span>` : ''}
    </nav></header>`;
}
function home() {
  const b = bank(), s = state.sessions[state.packId], r = state.reviews[state.packId];
  const count = b.questions.filter(isEligible).length;
  const base = Math.floor(100/b.modules.length), extra = 100 % b.modules.length;
  const stats = state.stats[state.packId];
  const best = stats.bestScore;
  return `<div id="main-content"><section class="hero">
    <div class="hero-copy"><p class="eyebrow">Knowledge training system</p>
      <h1 tabindex="-1">Bukan cuma hafal.<br><em>Pahami setiap keputusan.</em></h1>
      <p class="hero-lead">100 soal, proporsi seimbang, dan tantangan yang berubah setiap sesi. Temukan alasan di balik jawabanmu, lalu latih lagi bagian yang belum kamu kuasai.</p>
      <fieldset class="pack-picker"><legend>Pilih paket latihan</legend>${Object.entries(packNames).map(([id,name]) => `<label class="pack-option ${state.packId === id ? 'is-active' : ''}"><input type="radio" name="pack" value="${id}" ${state.packId === id ? 'checked' : ''}><strong>${esc(name)}</strong><small>${banks[id].modules.length} materi · ${banks[id].questions.filter(isEligible).length} soal siap latihan</small></label>`).join('')}</fieldset>
      <div class="hero-actions">${s && !s.completedAt ? btn(`Lanjutkan · ${Object.keys(s.answers).length}/100 terjawab →`,'resume','', 'primary-button') : btn(s ? 'Mulai 100 soal baru →' : 'Mulai 100 soal →','new','', 'primary-button')}
      ${s && !s.completedAt ? btn('Buat sesi baru','new') : btn('Jelajahi materi','learn')}
      ${s?.completedAt ? btn('Lihat hasil terakhir','resume','','text-button') : ''}</div>
      ${r && !r.completedAt ? `<p class="resume-review">${btn(`Lanjutkan latihan ulang · ${Object.keys(r.answers).length}/${r.questionIds.length}`,'resume-review','','text-button')}</p>` : ''}
      <p class="local-note">Progres tersimpan di browser perangkat ini, termasuk sesi yang baru dimulai.</p>
    </div>
    <div class="hero-visual" aria-label="100 soal per sesi, materi seimbang, dan pembahasan langsung">
      <div class="depth-scale" aria-hidden="true"><span>START</span><span>LEARN</span><span>RECALL</span><span>REPEAT</span></div><div class="well-path" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hero-score-card"><span>One session. Full coverage.</span><strong>100</strong><p>Keputusan untuk dipahami</p></div>
      <div class="learning-loop"><span>01 · Jawab & nilai keyakinan</span><span>02 · Pahami pembahasan</span><span>03 · Ulangi tanpa melihat kunci</span></div>
      <div class="hero-stats"><div><strong>${count}</strong><span>soal siap latihan</span></div><div><strong>${b.modules.length}</strong><span>materi tercakup</span></div><div><strong>${base}–${base+1}</strong><span>soal per materi</span></div></div>
    </div></section>
    <section class="overview-section">${heading('Proporsi sesi', 'Semua materi punya tempat.', `${base} soal dari setiap materi + 1 soal tambahan untuk ${extra} materi yang dipilih acak = tepat 100 soal unik. Materi penerima tambahan ikut berubah setiap sesi.`)}
      <div class="distribution-note"><strong>Paket ${esc(packNames[state.packId])}</strong><span>Setiap materi ${base}–${base+1}% dari sesi · soal dan pilihan jawaban diacak · soal di luar sesi terakhir diprioritaskan</span></div>
      <div class="module-grid">${b.modules.map((m,i)=> `<button class="module-card" type="button" data-action="module" data-id="${m.id}"><span>${String(i+1).padStart(2,'0')} <b class="quota-label">${base}–${base+1} soal / sesi</b></span><h3>${esc(m.title)}</h3><p>${b.questions.filter(q=>q.moduleId===m.id&&isEligible(q)).length} soal tersedia · Pelajari materi →</p></button>`).join('')}</div>
      ${b.questions.some(q=>q.reviewRequired) ? '<details class="editorial-note"><summary>Catatan kualitas bank soal</summary><p>ZIP berisi 275 soal. Satu soal perbandingan anggaran (Quiz 28, nomor 19) ditahan dari penilaian karena kunci pada PDF belum memiliki konteks angka yang cukup. Soal merek, sponsor, pencapaian, spesifikasi unit tertentu, dan hafalan studi kasus dikeluarkan dari latihan. Proporsi 100 soal tetap dipertahankan dengan soal konsep umum.</p></details>' : ''}
    </section>
    <section class="performance-section"><div><p class="eyebrow">Progres paket ini</p><h2>Pelajari. Coba lagi. Lihat kemajuannya.</h2></div><div><div class="performance-cards"><div><span>Skor terbaik</span><strong>${best}%</strong></div><div><span>Sesi 100 soal selesai</span><strong>${stats.totalAttempts}</strong></div><div><span>Perlu diulang</span><strong>${queue().length}</strong></div></div>${queue().length ? btn('Latih jawaban salah & ragu →','review','', 'secondary-button') : '<p class="local-note">Jawaban salah dan jawaban benar yang masih ragu akan masuk antrean latihan.</p>'}</div></section></div>`;
}

function answerInput(q, s, answer, d) {
  const locked = Boolean(answer), value = answer ? answer.value : d.value;
  if (['single','multiple','boolean'].includes(q.type)) {
    return `<div class="answer-grid" role="group" aria-label="Pilihan jawaban">${s.optionOrders[q.id].map((id,i) => {
      const option = q.options.find(o=>o.id===id), selected = value.includes(id);
      const good = locked && q.correctOptionIds.includes(id), bad = locked && selected && !good;
      return `<button type="button" class="answer-option ${selected?'is-selected':''} ${good?'is-correct':''} ${bad?'is-wrong':''}" data-action="option" data-id="${id}" aria-pressed="${selected}" ${locked?'disabled':''}><span class="option-letter">${String.fromCharCode(65+i)}</span><span>${esc(option.text)}</span><i aria-hidden="true">${good?'✓':bad?'×':selected?'●':''}</i>${good?'<span class="sr-only">Jawaban benar</span>':bad?'<span class="sr-only">Jawaban salah</span>':''}</button>`;
    }).join('')}</div>`;
  }
  if (q.type === 'order') return `<ol class="order-list">${value.map((id,i)=>`<li class="${locked ? (id===q.correctOrder[i]?'order-correct':'order-wrong'):''}"><span class="order-number">${i+1}</span><span class="drag-handle" aria-hidden="true">⠿</span><strong>${esc(q.options.find(o=>o.id===id).text)}</strong><div class="order-controls">${btn('↑','up',`data-id="${id}" aria-label="Naikkan ${esc(q.options.find(o=>o.id===id).text)}" ${locked||i===0?'disabled':''}`,'')}${btn('↓','down',`data-id="${id}" aria-label="Turunkan ${esc(q.options.find(o=>o.id===id).text)}" ${locked||i===value.length-1?'disabled':''}`,'')}</div></li>`).join('')}</ol>`;
  if (q.type === 'slider') return `<div class="slider-answer"><output id="number-output" for="answer-range answer-number">${value===null?'—':esc(value)} <span>${esc(q.slider.unit)}</span></output><label class="sr-only" for="answer-range">Geser jawaban angka</label><input id="answer-range" type="range" min="${q.slider.min}" max="${q.slider.max}" step="${q.slider.step}" value="${value ?? q.slider.min}" ${locked?'disabled':''}><div class="slider-limits"><span>${q.slider.min}</span><span>${q.slider.max}</span></div><label class="number-label" for="answer-number">Atau ketik jawaban (${esc(q.slider.unit)})</label><input id="answer-number" class="number-input" type="number" min="${q.slider.min}" max="${q.slider.max}" step="${q.slider.step}" value="${value ?? ''}" ${locked?'disabled':''}></div>`;
  const point = value;
  return `<div class="pin-wrapper"><button type="button" class="pin-stage" data-action="pin" aria-label="Pilih titik pada gambar" ${locked?'disabled':''}><img src="${esc(mediaURL(q.media))}" alt="Gambar sayatan tipis sampel A dan B"><span class="pin-marker" ${point?`style="left:${point.x*100}%;top:${point.y*100}%"`:'hidden'}></span>${locked?`<span class="pin-target" style="left:${q.pin.target.x*100}%;top:${q.pin.target.y*100}%;width:${q.pin.target.radius*200}%;height:${q.pin.target.radius*200}%"></span>`:''}</button><div class="pin-coordinates"><label>Posisi horizontal <input type="range" data-pin-axis="x" aria-label="Posisi horizontal titik" min="0" max="100" value="${(point?.x??.5)*100}" ${locked?'disabled':''}></label><label>Posisi vertikal <input type="range" data-pin-axis="y" aria-label="Posisi vertikal titik" min="0" max="100" value="${(point?.y??.5)*100}" ${locked?'disabled':''}></label></div></div>`;
}
function mediaURL(path) { return new URL('../'+path.replace(/^\/+/,''), import.meta.url).href; }
function feedback(q, a, d) {
  return `<section id="answer-feedback" tabindex="-1" class="feedback-panel ${a.correct?'feedback-correct':'feedback-wrong'}" aria-label="Hasil jawaban"><div class="feedback-heading"><span aria-hidden="true">${a.correct?'✓':'×'}</span><strong>${a.correct ? (a.confidence==='sure'?'Tepat! Sekarang cek alasanmu.':'Benar, tapi masih ragu? Kita ulangi nanti.') : (a.confidence==='sure'?'Belum tepat — cek kembali asumsi yang kamu pakai.':'Belum tepat. Ini kesempatan memperjelas konsepnya.')}</strong></div><p><b>Jawabanmu:</b> ${esc(answerText(q,a.value))}</p><p><b>Jawaban benar:</b> ${esc(correctText(q))}</p><div class="reason-block"><span>Mengapa? · ${esc(concepts.get(q.id)?.title || 'Konsep kunci')}</span><p>${esc(explanation(q))}</p>${btn('Pelajari materi ini →','module',`data-id="${q.moduleId}"`,'reason-link')}</div><details class="reflection"><summary>Uji pemahamanmu, bukan hanya ingatanmu</summary><p>Tutup pembahasan, lalu jelaskan dengan kata-katamu sendiri: prinsip apa yang membuat jawaban itu tepat, dan mengapa pilihan lain kurang sesuai?</p><label for="reflection-note">Catatan penjelasanmu (opsional, tersimpan di browser ini)</label><textarea id="reflection-note" maxlength="2000" rows="3" placeholder="Menurutku, alasannya adalah…">${esc(d.reflection)}</textarea><p class="local-note">Catatan ini tidak dinilai otomatis. Bandingkan penalaranmu dengan pembahasan dan coba jawab lagi tanpa melihat kunci.</p></details><p class="source-reference">Sumber kunci: ${esc(source(q))}. Penjelasan tambahan dirangkum untuk belajar.</p></section>`;
}
function quiz() {
  const s = session(), q = question();
  if (!s || !q) { view='home'; return home(); }
  const answer = s.answers[q.id], d = draftFor(q), answered = Object.keys(s.answers).length;
  return `<section class="quiz-layout" id="main-content"><aside class="quiz-rail" aria-label="Progres sesi"><p class="eyebrow">${s.mode==='review'?'Latihan ulang':'Sesi 100 soal'}</p><div class="rail-number"><strong>${s.currentIndex+1}</strong><span>/ ${s.questionIds.length}</span></div><div class="rail-progress" role="progressbar" aria-valuenow="${answered}" aria-valuemin="0" aria-valuemax="${s.questionIds.length}" aria-label="Soal terjawab"><span style="height:${answered/s.questionIds.length*100}%"></span></div><div class="rail-score"><span>Benar</span><strong>${Object.values(s.answers).filter(a=>a.correct).length}</strong></div>${btn('Beranda','home','','rail-home')}</aside>
    <article class="question-card"><div class="question-meta"><span class="topic-chip">${esc(q.moduleTitle)}</span><span class="type-chip">${types[q.type]}</span></div><p class="question-counter">Soal ${s.currentIndex+1} dari ${s.questionIds.length}${s.mode==='review'?' · latihan ulang':''}</p><h1 tabindex="-1">${esc(q.prompt)}</h1><p class="question-hint">${hints[q.type]}</p>${q.media && q.type!=='pin' ? `<figure class="media-frame"><img src="${esc(mediaURL(q.media))}" alt="Gambar pendukung untuk soal ${esc(q.moduleTitle)}"></figure>`:''}
    ${answerInput(q,s,answer,d)}
    <fieldset class="confidence-picker" ${answer?'disabled':''}><legend>Seberapa yakin kamu dengan jawabanmu?</legend>${btn('Yakin, aku tahu alasannya','sure',`aria-pressed="${d.confidence==='sure'}"`,'confidence-button')}${btn('Masih ragu / menebak','unsure',`aria-pressed="${d.confidence==='unsure'}"`,'confidence-button')}</fieldset>
    ${answer?feedback(q,answer,d):'<p class="local-note">Pilih jawaban dan tingkat keyakinan sebelum memeriksa. Jawaban yang sudah diperiksa dikunci.</p>'}
    <div class="question-actions">${answer?btn(s.currentIndex===s.questionIds.length-1?'Selesaikan & lihat hasil →':'Soal berikutnya →','next','','primary-button'):btn('Periksa jawaban','submit',canSubmit(q,d)?'':'disabled','primary-button')}</div>
    </article></section>`;
}

function results() {
  const s=session(); if(!s?.completedAt) return quiz();
  const r=summarize(s,bank()), reviewIds=s.questionIds.filter(id=>isEligible(allQuestions.get(id))&&(!s.answers[id]?.correct||s.answers[id]?.confidence==='unsure'));
  const remaining=queue();
  return `<section class="results-page" id="main-content"><div class="result-hero"><div><p class="eyebrow">${s.mode==='review'?'Latihan ulang selesai':'100 keputusan. Satu langkah maju.'}</p><h1 tabindex="-1">Lihat yang sudah kuat.<br>Latih yang belum mantap.</h1><p>${r.correct} dari ${r.total} jawaban benar. ${r.uncertain} jawaban masih kamu ragukan. Skor ini mengukur sesi ini; pemahaman dibangun lewat alasan yang benar dan latihan terpisah.</p><div class="hero-actions">${btn('Mulai 100 soal baru →','new','','primary-button')}${remaining.length?btn(`Latihan ulang (${remaining.length})`,'review') : btn('Pelajari materi','learn')}</div></div><div class="score-dial" style="--score:${r.score}%" aria-label="Skor ${r.score} persen"><div><strong>${r.score}</strong><span>/100</span></div></div></div>
    <div class="result-summary"><div><span>Jawaban benar</span><strong>${r.correct}/${r.total}</strong></div><div><span>Masih ragu di sesi ini</span><strong>${r.uncertain}</strong></div><div><span>Antrean latihan paket ini</span><strong>${remaining.length}</strong></div></div>
    <section class="topic-results">${heading('Peta pemahaman','Nilai per materi','Mulai dari materi dengan nilai terendah. Dua jawaban benar dan yakin pada dua percobaan berturut-turut mengeluarkan soal dari antrean latihan.')}
      <div class="topic-result-grid">${[...r.topics].sort((a,b)=>a.score-b.score).map(m=>`<article><div><h3 title="${esc(m.title)}">${esc(m.title)}</h3><span>${m.correct}/${m.total} benar · ${btn('Pelajari','module',`data-id="${m.id}"`,'text-button')}</span></div><div class="topic-bar" role="img" aria-label="${m.score}% benar"><span style="width:${m.score}%"></span></div><strong>${m.score}%</strong></article>`).join('')}</div></section>
    <section class="review-section">${heading('Tinjau & ingat kembali','Jawaban salah dan yang masih ragu',`${reviewIds.length} soal dari sesi ini. Latihan ulang menyajikan soal tanpa kunci lebih dulu dan mengacak pilihannya kembali.`)}${reviewIds.length?`<div class="review-list">${reviewIds.map((id,i)=>{const q=allQuestions.get(id),a=s.answers[id];return `<details><summary><span>${String(i+1).padStart(2,'0')}</span><div><small>${esc(q.moduleTitle)} · ${a.correct?'Benar, masih ragu':a.confidence==='sure'?'Salah, tadinya yakin':'Belum tepat'}</small><strong>${esc(q.prompt)}</strong></div><i aria-hidden="true">+</i></summary><div class="review-body"><p><b>Jawabanmu:</b> ${esc(answerText(q,a.value))}</p><p><b>Jawaban benar:</b> ${esc(correctText(q))}</p><div class="review-reason"><strong>Alasan & konsep</strong><p>${esc(explanation(q))}</p>${s.drafts[id]?.reflection?`<p><b>Catatanmu:</b> ${esc(s.drafts[id].reflection)}</p>`:''}${btn('Pelajari materi →','module',`data-id="${q.moduleId}"`,'reason-link')}</div></div></details>`}).join('')}</div>`:'<div class="perfect-card"><strong>Benar dan yakin untuk seluruh sesi.</strong><p>Coba sesi baru dengan soal berbeda. Menjawab lagi setelah jeda membantu memeriksa apakah konsepnya masih kamu ingat.</p></div>'}</section>
    <section class="review-section">${heading('Riwayat lokal','Bandingkan dengan percobaan sebelumnya')}<ol class="history-list">${state.history.filter(h=>h.packId===state.packId).slice(0,8).map(h=>`<li><span>${new Date(h.completedAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})} · ${h.mode==='review'?'Latihan ulang':'Sesi 100 soal'}</span><strong>${h.correct}/${h.total} · ${h.score}%</strong></li>`).join('')}</ol></section></section>`;
}
function learning() {
  const b=bank();
  if (!b.modules.some(m=>m.id===activeModule)) activeModule=b.modules[0].id;
  const m=b.modules.find(m=>m.id===activeModule), lesson=lessons.get(m.id);
  const qs=b.questions.filter(q=>q.moduleId===m.id&&isEligible(q)), answered=qs.filter(q=>state.mastery[q.id]), strong=answered.filter(q=>state.mastery[q.id].streak>=2);
  const active=state.sessions[state.packId];
  return `<section class="learning-page" id="main-content"><div class="learning-hero"><div><p class="eyebrow">Learn the reason. Recall the concept.</p><h1 tabindex="-1">Pahami prinsipnya.<br>Jawaban akan mengikuti.</h1><p>Baca konsep, tutup materi, lalu coba jelaskan kembali. Gunakan soal untuk menguji alasanmu, bukan menghafal posisi pilihan.</p></div><div class="learning-actions">${active&&!active.completedAt?btn('Lanjutkan sesi →','resume','','primary-button'):btn('Mulai 100 soal →','new','','primary-button')}${btn('Kembali ke beranda','home')}</div></div>
    <div class="learning-layout"><nav class="learning-nav" aria-label="Daftar materi"><p class="eyebrow">${esc(packNames[state.packId])}</p>${b.modules.map((mod,i)=>`<button type="button" class="learning-nav-button ${mod.id===m.id?'is-active':''}" data-action="module" data-id="${mod.id}" ${mod.id===m.id?'aria-current="page"':''}><span>${String(i+1).padStart(2,'0')}</span>${esc(mod.title)}</button>`).join('')}</nav><article class="learning-content"><div class="learning-title"><div><p class="eyebrow">Modul belajar</p><h2>${esc(m.title)}</h2></div><span class="source-badge" data-kind="bank-soal">${qs.filter(isEligible).length} soal latihan</span></div>
    <p class="learning-overview">${esc(lesson?.overview || '')}</p><div class="module-progress"><strong>${answered.length}/${qs.filter(isEligible).length} soal pernah dicoba</strong><span>${strong.length} soal benar & yakin setidaknya dua kali berturut-turut.</span></div>
    <div class="concept-list">${(lesson?.concepts || []).map((c,i)=>`<section class="concept-card"><div><span>Konsep ${String(i+1).padStart(2,'0')}</span><small>${c.questionIds.length} soal terkait</small></div><h3>${esc(c.title)}</h3><p>${esc(c.explanation)}</p><details class="recall-prompt"><summary>Cek pemahamanmu</summary><p>Tanpa melihat paragraf di atas, jelaskan prinsip “${esc(c.title)}” dan berikan satu contoh penerapannya. Jika belum bisa menjelaskan alasannya, baca kembali lalu coba setelah jeda.</p></details></section>`).join('')}</div><div class="source-note"><strong>Rujukan materi & konteks</strong><ul>${(lesson?.sources||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p class="local-note">Pembahasan berfokus pada konsep dan prinsip yang dapat diterapkan lintas proyek. Merek, sponsor, pencapaian, dan hafalan kejadian proyek tidak diujikan.</p></div>${qs.some(q=>q.reviewRequired)?`<details class="editorial-note"><summary>Soal yang menunggu verifikasi</summary>${qs.filter(q=>q.reviewRequired).map(q=>`<p>${esc(q.prompt)}</p><p>${esc(q.reviewNote)}</p>`).join('')}</details>`:''}</article></div></section>`;
}
function reviewPage() {
  const ids=queue(), pending=state.reviews[state.packId];
  return `<section class="learning-page review-intro" id="main-content"><p class="eyebrow">Recall, bukan membaca ulang kunci</p><h1 tabindex="-1">${ids.length ? `${ids.length} soal untuk dimantapkan.` : 'Belum ada soal dalam antrean.'}</h1><p>Jawaban salah atau jawaban benar yang masih ragu masuk ke sini. Jawab benar dan yakin pada dua percobaan berturut-turut untuk mengeluarkannya dari antrean. Ini indikator latihan, bukan jaminan penguasaan.</p><div class="hero-actions">${pending&&!pending.completedAt?btn('Lanjutkan latihan ulang →','resume-review','','primary-button'):ids.length?btn(`Mulai latihan ulang · ${ids.length} soal →`,'start-review','','primary-button'):btn('Mulai 100 soal →','new','','primary-button')}${pending&&!pending.completedAt&&ids.length?btn('Susun ulang latihan','start-review'):btn('Pelajari materi','learn')}</div><p class="local-note">Latihan ulang mengikuti jumlah soal dalam antrean. Sesi utama selalu 100 soal dengan proporsi semua materi.</p><div class="review-queue">${bank().modules.map(m=>({m,count:ids.filter(id=>allQuestions.get(id).moduleId===m.id).length})).filter(x=>x.count).map(({m,count})=>`<div><strong>${esc(m.title)}</strong><span>${count} soal</span>${btn('Pelajari','module',`data-id="${m.id}"`,'text-button')}</div>`).join('')}</div></section>`;
}
function render() {
  root.innerHTML = `<main class="app-shell">${header()}<p id="storage-status" class="storage-warning" role="status" ${storageWarning?'':'hidden'}>${esc(storageWarning)}</p>${notice?`<p class="notice" role="status">${esc(notice)}</p>`:''}${({home,quiz,results,learning,review:reviewPage}[view] || home)()}<footer class="site-footer"><p>${bank().modules.length} materi · Progres disimpan di perangkat ini · Latih lagi setelah jeda</p><span>Drilling Mastery 100</span></footer></main>`;
  if(modal) renderModal();
}
function renderModal() {
  document.getElementById('confirm-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='confirm-dialog';dialog.className='confirm-modal';
  dialog.setAttribute('aria-labelledby','reset-title');
  dialog.innerHTML=`<p class="eyebrow">Ganti sesi aktif</p><h2 id="reset-title">${modal.mode==='review'?'Susun ulang latihan?':'Buat 100 soal baru?'}</h2><p>Progres ${modal.mode==='review'?'latihan ulang':'sesi utama'} yang belum selesai akan diganti. Riwayat yang sudah selesai dan catatan pemahaman tetap tersimpan.</p><div class="modal-actions">${btn('Pertahankan sesi','cancel-modal','','secondary-button')}${btn('Ganti dengan soal baru','confirm-new','','primary-button')}</div>`;
  root.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();closeModal();});dialog.showModal();dialog.querySelector('button')?.focus();
}
function closeModal() { document.getElementById('confirm-dialog')?.close();document.getElementById('confirm-dialog')?.remove();modal=null;modalReturnFocus?.focus(); }

root.addEventListener('click', e => {
  const target=e.target.closest('[data-action]'); if(!target||target.disabled) return;
  const action=target.dataset.action;
  if(action==='home') return go('home');
  if(action==='learn') return openLesson();
  if(action==='module') return openLesson(target.dataset.id);
  if(action==='new') return requestStart('quiz');
  if(action==='resume') return resume('quiz');
  if(action==='review') return go('review');
  if(action==='start-review') return requestStart('review');
  if(action==='resume-review') return resume('review');
  if(action==='cancel-modal') return closeModal();
  if(action==='confirm-new') {const mode=modal.mode;closeModal();return start(mode);}
  if(view!=='quiz') return;
  if(action==='submit') return submit();
  if(action==='next') return next();
  const s=session(),q=question();if(s.answers[q.id])return;
  const d=draftFor(q);
  if(action==='option') {const id=target.dataset.id;d.value=q.type==='multiple'?(d.value.includes(id)?d.value.filter(x=>x!==id):[...d.value,id]):[id];}
  if(action==='sure'||action==='unsure') d.confidence=action;
  if(action==='up'||action==='down') {const index=d.value.indexOf(target.dataset.id),to=index+(action==='up'?-1:1);if(to>=0&&to<d.value.length)[d.value[index],d.value[to]]=[d.value[to],d.value[index]];s.orderStates[q.id]=[...d.value];}
  if(action==='pin') {const rect=target.getBoundingClientRect();d.value=e.detail===0?{x:.5,y:.5}:{x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))};}
  save();render();
  if(action==='up'||action==='down') root.querySelector(`[data-action="${action}"][data-id="${target.dataset.id}"]`)?.focus();
  else if(action!=='pin') root.querySelector(`[data-action="${action}"]${target.dataset.id?`[data-id="${target.dataset.id}"]`:''}`)?.focus();
});
root.addEventListener('change',e=>{
  if(e.target.name==='pack' && banks[e.target.value]) {state.packId=e.target.value;activeMode='quiz';activeModule='';save();render();root.querySelector(`input[name="pack"][value="${state.packId}"]`)?.focus();}
});
root.addEventListener('input',e=>{
  if(view!=='quiz')return;
  const q=question(),s=session(),d=draftFor(q),el=e.target;
  if(el.id==='reflection-note') {d.reflection=el.value;save();return;}
  if(s.answers[q.id])return;
  if(el.id==='answer-range'||el.id==='answer-number') {
    d.value=el.value===''?null:Number(el.value);
    const other=document.getElementById(el.id==='answer-range'?'answer-number':'answer-range');other.value=d.value??q.slider.min;
    document.getElementById('number-output').innerHTML=`${d.value??'—'} <span>${esc(q.slider.unit)}</span>`;
  }
  if(el.dataset.pinAxis) {
    d.value={...(d.value||{x:.5,y:.5}),[el.dataset.pinAxis]:Number(el.value)/100};
    const marker=root.querySelector('.pin-marker');marker.hidden=false;marker.style.left=`${d.value.x*100}%`;marker.style.top=`${d.value.y*100}%`;
  }
  root.querySelector('[data-action="submit"]').disabled=!canSubmit(q,d);save();
});

async function init() {
  const [foundation,advanced,advancedLessons]=await Promise.all(['foundation.json','advanced.json','advanced-lessons.json'].map(async name=>{
    const response=await fetch(new URL('../data/'+name+'?v=concepts-2',import.meta.url));if(!response.ok)throw new Error(`Tidak dapat memuat ${name}`);return response.json();
  }));
  banks={advanced,foundation:foundation.bank,combined:{modules:[...foundation.bank.modules,...advanced.modules],questions:[...foundation.bank.questions,...advanced.questions]}};
  packNames={advanced:'Lanjutan · dari ZIP baru',foundation:'Dasar · paket sebelumnya',combined:'Gabungan · semua materi'};
  lessons=new Map([...foundation.lessons,...advancedLessons].map(l=>[l.moduleId,l]));
  concepts=new Map([...lessons.values()].flatMap(l=>l.concepts.flatMap(c=>c.questionIds.map(id=>[id,c]))));
  allQuestions=new Map(banks.combined.questions.map(q=>[q.id,q]));
  const stored=readJSON(STORAGE_KEY);
  const validLegacyStats = value => value && Number.isFinite(value.bestScore) && value.bestScore >= 0 && value.bestScore <= 100 && Number.isInteger(value.totalAttempts) && value.totalAttempts >= 0;
  if(stored?.version===2){
    if(banks[stored.packId])state.packId=stored.packId;
    for(const [id,b] of Object.entries(banks)){
      for(const key of ['sessions','reviews']){
        const s=stored[key]?.[id];
        if(isValidSession(s,b) && s.mode===(key==='reviews'?'review':'quiz'))state[key][id]=s;
        else if(s)notice='Satu sesi tersimpan tidak valid dan tidak dimuat. Kamu bisa memulai sesi baru.';
      }
    }
    if(stored.mastery && typeof stored.mastery==='object')for(const [id,m] of Object.entries(stored.mastery)){
      if(allQuestions.has(id) && Number.isInteger(m?.streak) && m.streak>=0 && Number.isInteger(m?.attempts) && m.attempts>=0 && Number.isInteger(m?.correct) && m.correct>=0 && typeof m.needsReview==='boolean')state.mastery[id]=m;
    }
    if(Array.isArray(stored.history))state.history=stored.history.filter(h=>banks[h?.packId]&&Number.isFinite(h.score)&&h.score>=0&&h.score<=100&&Number.isFinite(h.completedAt)&&Number.isFinite(h.correct)&&Number.isFinite(h.total)).slice(0,50);
    if(validLegacyStats(stored.legacyStats))state.legacyStats=stored.legacyStats;
  } else {
    const oldStats=readJSON('drilling-mastery-stats-v1');
    if(validLegacyStats(oldStats))state.legacyStats={bestScore:oldStats.bestScore,totalAttempts:oldStats.totalAttempts};
    const legacy=readJSON('drilling-mastery-session-v1');
    if(legacy){
      const migrated={...legacy,version:2,packId:'foundation',mode:'quiz',drafts:{}};
      for(const a of Object.values(migrated.answers||{}))a.confidence='unsure';
      if(isValidSession(migrated,banks.foundation)){
        state.sessions.foundation=migrated;
        for(const [id,a]of Object.entries(migrated.answers))state.mastery[id]=updateMastery(null,a);
        notice='Progres paket dasar sebelumnya berhasil dipertahankan. Paket lanjutan dari ZIP sudah tersedia.';
      }
    }
  }
  for (const id of Object.keys(banks)) {
    if (validLegacyStats(stored?.stats?.[id])) state.stats[id] = stored.stats[id];
    else {
      const history = state.history.filter(h => h.packId === id && h.mode === 'quiz');
      const legacy = id === 'foundation' ? state.legacyStats : null;
      state.stats[id] = { bestScore: Math.max(legacy?.bestScore || 0, ...history.map(h => h.score)), totalAttempts: history.length + (legacy?.totalAttempts || 0) };
    }
    for (const key of ['sessions', 'reviews']) {
      const refreshed = refreshSession(state[key][id], banks[id]);
      if (refreshed.changed) {
        if (refreshed.session) state[key][id] = refreshed.session;
        else delete state[key][id];
        notice = 'Soal merek, pencapaian, dan hafalan studi kasus sudah dikeluarkan. Sesi aktif diperbarui; jawaban lain dan riwayat skor tetap tersimpan.';
      }
    }
  }
  save();render();
}
init().catch(error=>{
  console.error(error);
  root.innerHTML='<main class="learning-page"><h1>Materi belum bisa dimuat.</h1><p>Periksa koneksi ke server website, lalu muat ulang halaman.</p><button type="button" class="primary-button" id="retry-load">Coba lagi</button></main>';
  document.getElementById('retry-load').addEventListener('click',()=>location.reload());
});
