// Spotted wants: when the agent reads something that may hold a want, decide whether to act on it, ask the owner,
// or let it go, and learn the owner's own cut-off from their answers.
// The owner is asked only in the middle: a very sure want is acted on, an unlikely one is dropped. Pure: no I/O,
// no clock, arguments never changed.
//
// The score is how sure the decision model is that a record holds a want: 1 - p(none).
// Defaults come from experiments in agent-network (decision_models/RESULTS.md): with d3-mini on 30 records, every score
// of 0.9 or more was a real want, more than half of 0.2-0.9 were, and none below 0.2 was.
//
// The floor learns from two signals:
// - Answers to confirmations. If the lowest-scoring answers since the last change are mostly "no", asking that low is
//   wasted work, so the floor rises one step.
// - Misses. When the owner later asks for something the agent had dropped, the floor falls one step (never below the
//   missed score).
// The act level stays fixed: wants acted on alone are not asked about, so there is no answer to learn from.

const DEFAULTS = { act: 0.9, floor: 0.2, step: 0.05, minFloor: 0.05, maxFloor: 0.6, window: 8, minYes: 0.25, keep: 200 };

function isPlain(v) { return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype; }
function isScore(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1; }
function isTime(v) { return Number.isSafeInteger(v) && v >= 0; }
function round(v) { return Math.round(v * 1000) / 1000; }
function copy(state) {
  return { ...state, answers: state.answers.map(a => ({ ...a })), changes: state.changes.map(c => ({ ...c })) };
}

// probs: the decision model's probabilities over want categories plus "none".
export function wantScore(probs) {
  if (!isPlain(probs) || !isScore(probs.none)) return { ok: false, errors: ['probs must be an object with a "none" probability'] };
  return { ok: true, score: round(1 - probs.none) };
}

export function createWantGate(options = {}) {
  if (!isPlain(options)) return { ok: false, errors: ['options must be a plain object'] };
  for (const k of Object.keys(options)) if (!(k in DEFAULTS)) return { ok: false, errors: ['unknown option: ' + k] };
  const o = { ...DEFAULTS, ...options };
  for (const k of ['act', 'floor', 'step', 'minFloor', 'maxFloor', 'minYes']) if (!isScore(o[k])) return { ok: false, errors: [k + ' must be in 0..1'] };
  for (const k of ['window', 'keep']) if (!Number.isSafeInteger(o[k]) || o[k] < 1) return { ok: false, errors: [k + ' must be a positive integer'] };
  if (!(o.minFloor <= o.floor && o.floor <= o.maxFloor && o.maxFloor < o.act)) return { ok: false, errors: ['need minFloor <= floor <= maxFloor < act'] };
  if (o.step <= 0) return { ok: false, errors: ['step must be above 0'] };
  return { ok: true, state: { version: 1, ...o, answers: [], changes: [] } };
}

// 'act': go ahead (for example, draft an ask-around). 'confirm': ask the owner first. 'drop': let it go.
export function routeWant(state, score) {
  if (!isScore(score)) return { ok: false, errors: ['score must be in 0..1'] };
  const route = score >= state.act ? 'act' : score >= state.floor ? 'confirm' : 'drop';
  return { ok: true, route };
}

function change(state, floor, at, reason) {
  floor = round(Math.min(state.maxFloor, Math.max(state.minFloor, floor)));
  if (floor === state.floor) return state;
  state.changes.push({ at, from: state.floor, to: floor, reason });
  state.floor = floor;
  return state;
}

// The owner's answer to a confirmation: yes = it was a real want.
export function recordAnswer(state, answer) {
  if (!isPlain(answer)) return { ok: false, errors: ['answer must be a plain object'] };
  if (!isScore(answer.score)) return { ok: false, errors: ['score must be in 0..1'] };
  if (typeof answer.yes !== 'boolean') return { ok: false, errors: ['yes must be true or false'] };
  if (!isTime(answer.at)) return { ok: false, errors: ['at must be a time'] };
  const s = copy(state);
  s.answers.push({ score: answer.score, yes: answer.yes, at: answer.at });
  if (s.answers.length > s.keep) s.answers = s.answers.slice(-s.keep);
  const since = s.changes.length ? s.changes[s.changes.length - 1].at : -1;
  const low = s.answers.filter(a => a.at > since && a.score >= s.floor && a.score < s.act)
    .sort((a, b) => a.score - b.score).slice(0, s.window);
  if (low.length === s.window && low.filter(a => a.yes).length / s.window < s.minYes)
    change(s, s.floor + s.step, answer.at, 'mostly no at the bottom of the confirm band');
  return { ok: true, state: s };
}

// The owner wanted something the agent had dropped, with this score.
export function recordMiss(state, miss) {
  if (!isPlain(miss)) return { ok: false, errors: ['miss must be a plain object'] };
  if (!isScore(miss.score)) return { ok: false, errors: ['score must be in 0..1'] };
  if (!isTime(miss.at)) return { ok: false, errors: ['at must be a time'] };
  const s = copy(state);
  if (miss.score < s.floor) change(s, Math.max(miss.score, s.floor - s.step), miss.at, 'missed a real want');
  return { ok: true, state: s };
}
