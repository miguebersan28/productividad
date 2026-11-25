// store.js — el "estado" de la app y cómo se guarda.
// Toda la información vive en un único objeto (state). Cada vez que algo cambia,
// llamamos a commit(): guarda en localStorage y avisa a quien esté escuchando para que repinte.

const KEY = 'hoy.dashboard.v1';

/** Fecha local como 'AAAA-MM-DD'. Se compara bien como texto: '2026-11-24' < '2026-11-25'. */
export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const today = () => dayStr();

const defaults = () => ({
  version: 1,
  tasks: [],            // { id, text, prio: 3|2|1, done, day, order, doneAt, carried }
  currentId: null,      // tarea elegida a mano como "en curso"
  lastDay: today(),     // último día en que se abrió la app (para detectar el cambio de día)
  streak: { count: 0, history: {} }, // history: { 'AAAA-MM-DD': 'ok' | 'fail' | 'none' }
  settings: { work: 25, short: 5, long: 15, every: 4, volume: 0.6 },
  pomo: { phase: 'work', cycle: 0, remaining: 25 * 60, endsAt: null },
  ui: { overdueOpen: true },
});

function merge(base, saved) {
  // Mezcla lo guardado sobre los valores por defecto, para que una versión nueva
  // de la app con campos nuevos no se rompa al leer datos antiguos.
  const out = { ...base, ...saved };
  for (const k of ['streak', 'settings', 'pomo', 'ui']) out[k] = { ...base[k], ...(saved[k] || {}) };
  if (!Array.isArray(out.tasks)) out.tasks = [];
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaults(), JSON.parse(raw));
  } catch { /* datos corruptos o almacenamiento bloqueado: empezamos de cero */ }
  return defaults();
}

export let state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sin almacenamiento: la app sigue funcionando en memoria */ }
}

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);
export function commit(opts) {
  save();
  listeners.forEach((fn) => fn(opts));
}

/** Si cambias algo en otra pestaña, esta se entera y se actualiza. */
export function reloadFromStorage() {
  state = load();
  listeners.forEach((fn) => fn({ external: true }));
}

/* ---------------- día nuevo y racha ---------------- */

/** Resultado de un día para la racha: todas las de prioridad alta hechas → 'ok'. Sin altas → 'none' (ni suma ni rompe). */
export function dayResult(ds) {
  const altas = state.tasks.filter((t) => t.day === ds && t.prio === 3 && !t.carried);
  if (!altas.length) return 'none';
  return altas.every((t) => t.done) ? 'ok' : 'fail';
}

/** Se llama al abrir la app y cada minuto. Devuelve true si ha cambiado el día. */
export function rollover() {
  const now = today();
  if (state.lastDay === now) return false;
  if (state.lastDay > now) { state.lastDay = now; return true; } // reloj del sistema atrasado: no tocamos la racha

  // Cerramos cada día desde la última visita hasta ayer.
  const d = parseDay(state.lastDay);
  const end = parseDay(now);
  while (d < end) {
    const ds = dayStr(d);
    const res = dayResult(ds);
    state.streak.history[ds] = res;
    if (res === 'ok') state.streak.count++;
    else if (res === 'fail') state.streak.count = 0;
    d.setDate(d.getDate() + 1);
  }
  // Las completadas de días pasados se van; las pendientes se quedan como "atrasadas".
  state.tasks = state.tasks.filter((t) => !(t.done && t.day < now));
  // Historial: solo guardamos los últimos 60 días.
  const limit = new Date(); limit.setDate(limit.getDate() - 60);
  for (const k of Object.keys(state.streak.history)) if (k < dayStr(limit)) delete state.streak.history[k];

  state.lastDay = now;
  state.currentId = null;
  return true;
}

/** Racha que se enseña: la acumulada + 1 si hoy ya has completado todas las altas. */
export function streakView() {
  const res = dayResult(today());
  return { count: state.streak.count + (res === 'ok' ? 1 : 0), todayRes: res };
}

/* ---------------- tareas ---------------- */

const byPrioOrder = (a, b) => b.prio - a.prio || a.order - b.order;

export const todayPending = () => state.tasks.filter((t) => t.day === today() && !t.done).sort(byPrioOrder);
export const todayDone = () => state.tasks.filter((t) => t.day === today() && t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
export const overdue = () => state.tasks.filter((t) => t.day < today() && !t.done).sort((a, b) => b.prio - a.prio || a.day.localeCompare(b.day) || a.order - b.order);
export const findTask = (id) => state.tasks.find((t) => t.id === id);

export function currentTask() {
  const pend = todayPending();
  return pend.find((t) => t.id === state.currentId) || pend[0] || null;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const nextOrder = (prio) => Math.max(-1, ...state.tasks.filter((t) => t.day === today() && t.prio === prio).map((t) => t.order)) + 1;

export function addTask(text, prio) {
  const t = { id: newId(), text, prio, done: false, day: today(), order: nextOrder(prio), doneAt: null, carried: false };
  state.tasks.push(t);
  return t;
}

export function setDone(id, done) {
  const t = findTask(id);
  if (!t) return;
  t.done = done;
  t.doneAt = done ? Date.now() : null;
  // Una atrasada completada pasa a "Completadas" de hoy, pero no cuenta para la racha.
  if (done && t.day < today()) { t.day = today(); t.carried = true; }
  if (done && state.currentId === id) state.currentId = null;
}

export function moveToToday(id) {
  const t = findTask(id);
  if (!t) return;
  t.day = today();
  t.carried = false;
  t.order = nextOrder(t.prio);
}

export function removeTask(id) {
  const i = state.tasks.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [t] = state.tasks.splice(i, 1);
  if (state.currentId === id) state.currentId = null;
  return t;
}
export function restoreTask(t) { state.tasks.push(t); }

/** Recibe los ids de un grupo de prioridad en su nuevo orden. */
export function setOrder(ids) {
  ids.forEach((id, i) => { const t = findTask(id); if (t) t.order = i; });
}

export function setCurrent(id) { state.currentId = id; }
