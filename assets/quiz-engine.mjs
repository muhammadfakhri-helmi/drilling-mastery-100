/** Pure quiz rules. Data and browser storage are deliberately separate. */
export const SESSION_SIZE = 100;
export const VERSION = 2;
export const isEligible = question => Boolean(question && !question.reviewRequired && !question.excluded);

export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const sameOrder = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const differentOrder = (items, previous, rng) => {
  const result = shuffle(items, rng);
  return result.length > 1 && sameOrder(result, previous || []) ? [...result.slice(1), result[0]] : result;
};

export function selectQuestions(bank, previousIds = [], rng = Math.random) {
  const { modules, questions } = bank;
  if (!modules.length || modules.length > SESSION_SIZE) throw new Error('Jumlah materi tidak valid.');
  const base = Math.floor(SESSION_SIZE / modules.length);
  const extras = new Set(shuffle(modules, rng).slice(0, SESSION_SIZE % modules.length).map(m => m.id));
  const previous = new Set(previousIds);
  const selected = modules.flatMap(module => {
    const pool = questions.filter(q => q.moduleId === module.id && isEligible(q));
    const quota = base + Number(extras.has(module.id));
    if (pool.length < quota) throw new Error(`Bank soal ${module.title} belum cukup.`);
    // Prioritize questions absent from the last session; reuse only when needed for the quota.
    return [...shuffle(pool.filter(q => !previous.has(q.id)), rng), ...shuffle(pool.filter(q => previous.has(q.id)), rng)].slice(0, quota);
  });
  return differentOrder(selected.map(q => q.id), previousIds, rng);
}

export function createSession(bank, packId, previous = null, rng = Math.random, reviewIds = null) {
  const known = new Map(bank.questions.map(q => [q.id, q]));
  const questionIds = reviewIds
    ? differentOrder([...new Set(reviewIds)].filter(id => isEligible(known.get(id))), previous?.questionIds, rng)
    : selectQuestions(bank, previous?.questionIds, rng);
  if (!questionIds.length) throw new Error('Tidak ada soal untuk diulang.');
  const optionOrders = {}, orderStates = {};
  for (const id of questionIds) {
    const q = known.get(id);
    if (q.options?.length) optionOrders[id] = differentOrder(q.options.map(o => o.id), previous?.optionOrders?.[id], rng);
    if (q.type === 'order') orderStates[id] = differentOrder(q.correctOrder, q.correctOrder, rng);
  }
  return { version: VERSION, id: `${Date.now().toString(36)}-${rng().toString(36).slice(2)}`, packId,
    mode: reviewIds ? 'review' : 'quiz', questionIds, currentIndex: 0, answers: {}, drafts: {},
    optionOrders, orderStates, startedAt: Date.now() };
}

export function grade(q, value) {
  if (['single', 'multiple', 'boolean'].includes(q.type)) {
    return Array.isArray(value) && new Set(value).size === value.length && value.length === q.correctOptionIds.length && value.every(id => q.correctOptionIds.includes(id));
  }
  if (q.type === 'order') return Array.isArray(value) && sameOrder(value, q.correctOrder);
  if (q.type === 'slider') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - q.slider.answer) <= (q.slider.tolerance || 0);
  if (q.type === 'pin') return value && typeof value.x === 'number' && typeof value.y === 'number' && Math.hypot(value.x-q.pin.target.x, value.y-q.pin.target.y) <= q.pin.target.radius;
  return false;
}

/** Refresh unfinished sessions after editorial exclusions, preserving other work. */
export function refreshSession(session, bank, rng = Math.random) {
  if (!session || session.completedAt) return { session, changed: false };
  const known = new Map(bank.questions.map(q => [q.id, q]));
  const removed = session.questionIds.filter(id => !isEligible(known.get(id)));
  if (!removed.length) return { session, changed: false };
  const next = structuredClone(session);
  const currentId = next.questionIds[next.currentIndex];
  const used = new Set(next.questionIds);
  const replacements = new Map();
  if (next.mode === 'quiz') {
    for (const id of removed) {
      const pool = bank.questions.filter(q => q.moduleId === known.get(id).moduleId && isEligible(q) && !used.has(q.id));
      const replacement = shuffle(pool, rng)[0];
      if (!replacement) throw new Error('Bank konsep belum cukup untuk memperbarui sesi.');
      used.add(replacement.id); replacements.set(id, replacement.id);
    }
    const prepared = createSession(bank, next.packId, null, rng, [...replacements.values()]);
    Object.assign(next.optionOrders, prepared.optionOrders);
    Object.assign(next.orderStates, prepared.orderStates);
    next.questionIds = next.questionIds.map(id => replacements.get(id) || id);
  } else {
    next.questionIds = next.questionIds.filter(id => isEligible(known.get(id)));
  }
  for (const id of removed) {
    delete next.answers[id]; delete next.drafts?.[id];
    delete next.optionOrders[id]; delete next.orderStates[id];
  }
  if (!next.questionIds.length) return { session: null, changed: true };
  const pending = next.questionIds.findIndex(id => !next.answers[id]);
  next.currentIndex = pending >= 0 ? pending : Math.max(0, next.questionIds.indexOf(currentId));
  if (pending < 0) next.completedAt = Date.now();
  return { session: next, changed: true };
}

export function answerText(q, value) {
  const label = id => q.options?.find(o => o.id === id)?.text || id;
  if (Array.isArray(value)) return value.map(label).join(q.type === 'order' ? ' → ' : '; ');
  if (typeof value === 'number') return `${value} ${q.slider?.unit || ''}`.trim();
  if (q.type === 'pin' && value) return `Titik x ${Math.round(value.x * 100)}%, y ${Math.round(value.y * 100)}%`;
  return 'Belum dijawab';
}
export function correctText(q) {
  return q.type === 'order' ? answerText(q, q.correctOrder) : q.type === 'slider' ? answerText(q, q.slider.answer) : q.type === 'pin' ? q.pin.label : answerText(q, q.correctOptionIds);
}
export function updateMastery(previous, answer) {
  const streak = answer.correct ? (previous?.streak || 0) + 1 : 0;
  return { attempts: (previous?.attempts || 0) + 1, correct: (previous?.correct || 0) + Number(answer.correct),
    streak, needsReview: !answer.correct || (previous?.needsReview === true && streak < 2), lastAnsweredAt: answer.answeredAt };
}
export function summarize(session, bank) {
  const topics = bank.modules.map(module => {
    const ids = session.questionIds.filter(id => bank.questions.find(q => q.id === id)?.moduleId === module.id);
    const correct = ids.filter(id => session.answers[id]?.correct).length;
    return { ...module, total: ids.length, correct, score: ids.length ? Math.round(correct/ids.length*100) : 0 };
  }).filter(m => m.total);
  const correct = session.questionIds.filter(id => session.answers[id]?.correct).length;
  const incorrect = session.questionIds.filter(id => session.answers[id] && !session.answers[id].correct).length;
  return { correct, incorrect, total: session.questionIds.length, score: Math.round(correct/session.questionIds.length*100), topics };
}

export function isValidSession(session, bank) {
  if (!session || session.version !== VERSION || !['quiz','review'].includes(session.mode)) return false;
  if (!Array.isArray(session.questionIds) || !session.questionIds.length || (session.mode === 'quiz' && session.questionIds.length !== SESSION_SIZE)) return false;
  const known = new Map(bank.questions.map(q => [q.id,q]));
  if (new Set(session.questionIds).size !== session.questionIds.length || !session.questionIds.every(id => known.has(id))) return false;
  if (!Number.isInteger(session.currentIndex) || session.currentIndex < 0 || session.currentIndex >= session.questionIds.length) return false;
  if (!session.answers || typeof session.answers !== 'object' || Array.isArray(session.answers) || !session.optionOrders || !session.orderStates) return false;
  if (session.drafts != null && (typeof session.drafts !== 'object' || Array.isArray(session.drafts))) return false;
  for (const id of session.questionIds) {
    const q = known.get(id);
    const validOrder = (a, expected) => Array.isArray(a) && new Set(a).size === expected.length && a.length === expected.length && a.every(id => expected.includes(id));
    if (q.options?.length && !validOrder(session.optionOrders[id], q.options.map(o => o.id))) return false;
    if (q.type === 'order' && !validOrder(session.orderStates[id], q.correctOrder)) return false;
    const validValue = (value, draft = false) => {
      if (draft && value === null && ['slider','pin'].includes(q.type)) return true;
      if (['single','multiple','boolean'].includes(q.type)) return Array.isArray(value) && (draft || value.length > 0) && (q.type === 'multiple' || value.length <= 1) && new Set(value).size === value.length && value.every(id => q.options.some(o => o.id === id));
      if (q.type === 'order') return validOrder(value, q.correctOrder);
      if (q.type === 'slider') return typeof value === 'number' && Number.isFinite(value) && value >= q.slider.min && value <= q.slider.max;
      if (q.type === 'pin') return value && ['x','y'].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]) && value[axis] >= 0 && value[axis] <= 1);
      return false;
    };
    const a = session.answers[id];
    if (a && (!validValue(a.value) || typeof a.correct !== 'boolean' || Boolean(grade(q,a.value)) !== a.correct)) return false;
    const draft = session.drafts?.[id];
    if (draft && (!validValue(draft.value, true) || typeof draft.reflection !== 'string')) return false;
  }
  return Object.keys(session.answers).every(id => session.questionIds.includes(id)) && (!session.completedAt || session.questionIds.every(id => session.answers[id]));
}
