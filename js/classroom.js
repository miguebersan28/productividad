// classroom.js — tus entregas de Google Classroom (solo lectura).
//
// Usa la cuenta del instituto (la que tiene Classroom), que puede ser distinta de la del calendario.
// Por eso tiene su propio token. Pide dos permisos de solo lectura:
//   - ver tus clases (cursos)
//   - ver tus tareas y si las has entregado
import * as S from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadGis } from './calendar.js';
import { toast } from './ui.js';

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
];
const API = 'https://classroom.googleapis.com/v1';
const TOKEN_KEY = 'hoy.classroom.token';
const C = () => S.state.classroom;
const DAY = 86400000;

/* ---------------- token (igual que el del calendario, pero aparte) ---------------- */
let token = (() => { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY)); return t && t.exp > Date.now() ? t : null; } catch { return null; } })();
function storeToken(t) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ }
}
export const hasToken = () => !!token && token.exp > Date.now() + 30_000;
export const isConnected = () => !!C().connected;

let tokenClient = null;
function client() {
  if (tokenClient || !window.google?.accounts?.oauth2) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES.join(' '),
    callback: onToken,
    error_callback: (err) => {
      if (err?.type !== 'popup_closed') setStatus(C().connected ? 'expired' : 'off', 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta web.');
    },
  });
  return tokenClient;
}

function onToken(resp) {
  if (resp.error) {
    // admin_policy_enforced / access_denied: el instituto no deja usar apps externas con su cuenta.
    const blocked = /admin|policy|denied/i.test(resp.error + ' ' + (resp.error_description || ''));
    setStatus(C().connected ? 'expired' : 'off', blocked
      ? 'Tu cuenta del instituto no permite conectar esta app (lo decide el administrador). Plan B: leer los avisos de Classroom de tu Gmail.'
      : 'Google no dio permiso para leer Classroom.');
    return;
  }
  if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
    setStatus(C().connected ? 'expired' : 'off', 'Necesito los dos permisos (clases y tareas) para enseñar tus entregas.');
    return;
  }
  storeToken({ value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) - 60) * 1000 });
  C().connected = true;
  refresh();
}

/** Desde un clic. Elige la cuenta del instituto en la ventana de Google. */
export function connect() {
  const c = client();
  if (!c) {
    setStatus(C().status, 'Cargando Google… vuelve a pulsar en un segundo.');
    loadGis().then(client).catch(() => setStatus(C().status, 'No se pudo cargar Google. ¿Hay conexión?'));
    return;
  }
  c.requestAccessToken({ prompt: C().connected ? '' : 'select_account consent' });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
  storeToken(null);
  S.state.classroom = { ...C(), connected: false, items: [], fetchedAt: null, status: 'off', error: null };
  S.commit();
}

function setStatus(status, error = null) {
  C().status = status;
  C().error = error;
  S.commit();
}

/* ---------------- pedir datos ---------------- */
async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token.value}` } });
  if (!r.ok) {
    const e = new Error('Classroom API ' + r.status);
    e.status = r.status;
    try { e.detail = (await r.json())?.error?.message || ''; } catch { e.detail = ''; }
    throw e;
  }
  return r.json();
}

/** Classroom guarda la fecha y la hora de entrega en UTC. Sin hora → final de ese día. */
function dueMs(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  if (w.dueTime && (w.dueTime.hours != null || w.dueTime.minutes != null)) {
    return Date.UTC(year, month - 1, day, w.dueTime.hours || 0, w.dueTime.minutes || 0);
  }
  return new Date(year, month - 1, day, 23, 59).getTime();
}

let busy = false;
export async function refresh() {
  if (!C().connected) return;
  if (!hasToken()) { if (C().status !== 'expired') setStatus('expired'); return; }
  if (busy) return;
  busy = true;
  try {
    const courses = (await api('/courses?studentId=me&courseStates=ACTIVE&pageSize=50')).courses || [];
    const since = Date.now() - 14 * DAY;
    // Cada asignatura en paralelo. Si una falla, las demás siguen.
    const perCourse = await Promise.all(courses.map(async (c) => {
      try {
        const [cw, subs] = await Promise.all([
          api(`/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&orderBy=updateTime%20desc&pageSize=50`),
          api(`/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`),
        ]);
        const state = new Map((subs.studentSubmissions || []).map((s) => [s.courseWorkId, s.state]));
        return (cw.courseWork || []).map((w) => ({
          id: w.id,
          title: (w.title || 'Tarea sin título').trim(),
          course: c.name,
          link: w.alternateLink,
          due: dueMs(w),
          created: Date.parse(w.creationTime) || 0,
          turnedIn: ['TURNED_IN', 'RETURNED'].includes(state.get(w.id)),
        }));
      } catch (e) {
        if (e.status === 401) throw e;
        return [];
      }
    }));
    // Nos quedamos con lo que no has entregado y es reciente: con fecha desde hace 2 semanas, o sin fecha y publicada hace menos de un mes.
    C().items = perCourse.flat().filter((t) => !t.turnedIn && (t.due ? t.due >= since : t.created >= Date.now() - 30 * DAY));
    // Las marcadas a mano que ya no aparecen se olvidan, para que la lista no crezca para siempre.
    const ids = new Set(C().items.map((t) => t.id));
    C().done = (C().done || []).filter((id) => ids.has(id));
    C().fetchedAt = Date.now();
    C().status = 'ok';
    C().error = null;
  } catch (e) {
    if (e.status === 401) { storeToken(null); C().status = 'expired'; C().error = null; }
    else if (e.status === 403) {
      C().status = 'error';
      C().error = /has not been used|disabled/i.test(e.detail)
        ? 'Activa la Google Classroom API en Google Cloud (README).'
        : 'Classroom ha rechazado la petición. Puede que tu instituto no lo permita.';
    } else { C().status = 'error'; C().error = 'Sin conexión: enseño lo último que cargué.'; }
  } finally {
    busy = false;
    S.commit();
  }
}

/* ---------------- marcar como hecha ---------------- */
export function markDone(id) {
  const t = C().items.find((x) => x.id === id);
  C().done = [...new Set([...(C().done || []), id])];
  S.commit();
  toast(`Entrega marcada como hecha`, 'Deshacer', () => {
    C().done = (C().done || []).filter((x) => x !== id);
    S.commit();
  });
  return t;
}

/* ---------------- pintar ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function pending() {
  const done = new Set(C().done || []);
  return (C().items || []).filter((t) => !done.has(t.id))
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || b.created - a.created);
}

/** Etiqueta de la fecha: "hoy · 14:00", "mañana", "viernes", "hace 2 días", "sin fecha". */
function dueLabel(t) {
  if (!t.due) return { text: 'sin fecha', cls: 'none' };
  const today = startOfDay(Date.now());
  const days = Math.round((startOfDay(t.due) - today) / DAY);
  const d = new Date(t.due);
  const time = d.getHours() === 23 && d.getMinutes() === 59 ? '' : ` · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 0 || t.due < Date.now()) return { text: days < 0 ? (days === -1 ? 'ayer' : `hace ${-days} días`) : `hoy${time}`, cls: 'late' };
  if (days === 0) return { text: `hoy${time}`, cls: 'today' };
  if (days === 1) return { text: `mañana${time}`, cls: 'soon' };
  if (days < 7) return { text: d.toLocaleDateString('es-ES', { weekday: 'long' }) + time, cls: '' };
  return { text: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), cls: '' };
}

function item(t, { course = false } = {}) {
  const l = dueLabel(t);
  return `<li class="cr" data-cr="${esc(t.id)}">
    <button type="button" class="cr-chk" data-cr-done="${esc(t.id)}" aria-label="Marcar como hecha: ${esc(t.title)}"></button>
    <span class="cr-main"><a class="cr-t" href="${esc(t.link || '#')}" target="_blank" rel="noopener" title="${esc(t.course)}">${esc(t.title)}</a>${course ? `<span class="cr-c">${esc(t.course)}</span>` : ''}</span>
    <span class="cr-d ${l.cls}">${esc(l.text)}</span></li>`;
}

/** Para el widget: solo lo que se entrega hoy y mañana. */
export function widgetHtml() {
  if (!isConnected()) return '';
  const end = startOfDay(Date.now()) + 2 * DAY;
  const list = pending().filter((t) => t.due && t.due >= startOfDay(Date.now()) && t.due < end);
  if (!list.length) return '';
  return `<div class="cr-sec"><div class="cr-h">Entregas</div><ul class="crs">${list.map((t) => item(t)).join('')}</ul></div>`;
}

/** Para la vista completa: todo lo pendiente, con asignatura. */
export function sheetHtml() {
  if (!isConnected()) return '';
  const list = pending();
  let foot = '';
  if (C().status === 'expired') foot = `<button type="button" class="cal-foot-btn" data-cr="connect">La sesión de Classroom caducó · Reconectar</button>`;
  else if (C().error) foot = `<span class="cal-err">${esc(C().error)}</span>`;
  return `<div class="cr-sec full"><div class="cr-h">Entregas pendientes de Classroom${list.length ? ` <span class="badge">${list.length}</span>` : ''}</div>
    ${list.length ? `<ul class="crs">${list.map((t) => item(t, { course: true })).join('')}</ul>` : `<p class="cal-empty">Nada pendiente en Classroom.</p>`}
    ${foot ? `<div class="cal-foot">${foot}</div>` : ''}</div>`;
}

/** Bloque de los ajustes del widget. */
export function settingsHtml() {
  const c = C();
  const st = c.error ? c.error
    : !c.connected ? 'Sin conectar'
    : c.status === 'expired' ? 'Sesión caducada'
    : c.fetchedAt ? `Conectado · actualizado a las ${new Date(c.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Conectando…';
  return `<div class="pop-title">Google Classroom</div>
    <p class="pop-help cr-status"></p>
    <div class="cr-actions">${c.connected
      ? `<button type="button" class="mini" data-cr="connect">Actualizar</button><button type="button" class="mini" data-cr="disconnect">Desconectar</button>`
      : `<button type="button" class="mini" data-cr="connect">Conectar con la cuenta del instituto</button>`}</div>`
    .replace('<p class="pop-help cr-status"></p>', `<p class="pop-help cr-status">${esc(st)}</p>`);
}

/* ---------------- arranque ---------------- */
export function initClassroom() {
  if (!S.state.classroom) return;
  document.addEventListener('click', (e) => {
    const done = e.target.closest('[data-cr-done]');
    if (done) { e.stopPropagation(); markDone(done.dataset.crDone); return; }
    const b = e.target.closest('[data-cr]');
    if (!b || b.tagName === 'LI') return;
    if (b.dataset.cr === 'connect') hasToken() ? refresh() : connect();
    else if (b.dataset.cr === 'disconnect') disconnect();
  }, true);
  if (C().connected && !hasToken() && C().status === 'ok') C().status = 'expired';
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
