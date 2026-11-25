// classroom.js — tus entregas de Google Classroom, leídas de los avisos que llegan a tu Gmail.
//
// Por qué así: la Junta no deja conectar apps externas a las cuentas del instituto, así que no
// podemos preguntar a Classroom directamente. Pero Classroom te manda un correo con cada tarea
// nueva ("Nueva tarea", "Se entrega mañana"…) a tu Gmail personal. Leemos esos correos (solo
// lectura) y sacamos de cada uno: asignatura, título, fecha de entrega y enlace a la tarea.
import * as S from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { loadGis } from './calendar.js';
import { toast } from './ui.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Avisos de Classroom de los últimos 3 meses, sin anuncios ni materiales (no son tareas).
const QUERY = 'from:no-reply@classroom.google.com newer_than:90d -subject:anuncio -subject:material';
const TOKEN_KEY = 'hoy.classroom.token';
const C = () => S.state.classroom;
const DAY = 86400000;

/* ---------------- token (aparte del del calendario) ---------------- */
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
  if (resp.error || !google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
    setStatus(C().connected ? 'expired' : 'off', 'Sin el permiso de leer el correo no puedo encontrar los avisos de Classroom.');
    return;
  }
  storeToken({ value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) - 60) * 1000 });
  C().connected = true;
  C().error = null;
  refresh();
}

/** Desde un clic. En la ventana de Google elige tu Gmail personal (donde llegan los avisos). */
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
  S.state.classroom = { ...C(), connected: false, items: [], parsed: {}, fetchedAt: null, status: 'off', error: null };
  S.commit();
}

function setStatus(status, error = null) {
  C().status = status;
  C().error = error;
  S.commit();
}

/* ---------------- leer los correos ---------------- */
async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token.value}` } });
  if (!r.ok) {
    const e = new Error('Gmail API ' + r.status);
    e.status = r.status;
    try { e.detail = (await r.json())?.error?.message || ''; } catch { e.detail = ''; }
    throw e;
  }
  return r.json();
}

/** Gmail manda el texto en base64 "de URL". Lo pasamos a texto normal respetando tildes y emojis. */
function decode(data) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}
/** Un correo tiene varias "partes" (texto, HTML…). Buscamos la de texto plano. */
function plainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  for (const p of part.parts || []) { const t = plainText(p); if (t) return t; }
  return '';
}

const MONTHS = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, oct: 9, nov: 10, dic: 11 };

/** "Fecha de entrega: 27 nov" (o "27 nov 2027, 14:00") → milisegundos. El año se deduce de la fecha del correo. */
function parseDue(line, mailDate) {
  const m = line.match(/Fecha de entrega:\s*(\d{1,2})\s+(?:de\s+)?([a-zé]{3,4})[a-zé]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?:,?\s*(\d{1,2}):(\d{2}))?/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (month == null) return null;
  const sent = new Date(mailDate);
  let year = m[3] ? Number(m[3]) : sent.getFullYear();
  const make = (y) => new Date(y, month, Number(m[1]), m[4] ? Number(m[4]) : 23, m[4] ? Number(m[5]) : 59).getTime();
  // Un aviso de diciembre con entrega "10 ene" es del año siguiente.
  if (!m[3] && make(year) < sent.getTime() - 60 * DAY) year++;
  return make(year);
}

/** Saca la tarea de un aviso. Devuelve null si el correo no es de una tarea (comentarios, etc.). */
export function parseMail(text, mailDate) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const courseIdx = lines.findIndex((l) => /classroom\.google\.com\/c\/[^/?&]+\?/.test(l));
  const linkLine = lines.find((l) => /classroom\.google\.com\/c\/[^/]+\/a\/[^/?]+/.test(l));
  if (courseIdx < 1 || !linkLine) return null;
  const ids = linkLine.match(/classroom\.google\.com\/c\/([^/]+)\/a\/([^/?]+)/);
  const rest = lines.slice(courseIdx + 1).filter(Boolean);
  const kind = rest[0] || '';
  if (/coment/i.test(kind)) return null; // comentarios privados: no son tareas nuevas
  const title = rest[1];
  if (!title || title.startsWith('<')) return null;
  const dueLine = lines.find((l) => /^Fecha de entrega:/i.test(l));
  return {
    id: `${ids[1]}/${ids[2]}`,
    title,
    course: lines[courseIdx - 1],
    link: linkLine.replace(/^<|>$/g, ''),
    due: dueLine ? parseDue(dueLine, mailDate) : null,
    created: mailDate,
  };
}

let busy = false;
export async function refresh() {
  if (!C().connected) return;
  if (!hasToken()) { if (C().status !== 'expired') setStatus('expired'); return; }
  if (busy) return;
  busy = true;
  try {
    const list = await api(`/messages?maxResults=150&q=${encodeURIComponent(QUERY)}`);
    const ids = (list.messages || []).map((m) => m.id);
    // Solo descargamos los correos que no habíamos leído ya (los demás están guardados).
    const parsed = { ...(C().parsed || {}) };
    const fresh = ids.filter((id) => !(id in parsed));
    for (let i = 0; i < fresh.length; i += 10) { // de 10 en 10 para no saturar a Google
      const batch = await Promise.all(fresh.slice(i, i + 10).map((id) => api(`/messages/${id}?format=full`).catch((e) => { if (e.status === 401) throw e; return null; })));
      batch.forEach((msg, j) => { parsed[fresh[i + j]] = msg ? parseMail(plainText(msg.payload), Number(msg.internalDate)) : null; });
    }
    // Olvidamos los correos que ya no salen en la búsqueda (de hace más de 3 meses).
    for (const id of Object.keys(parsed)) if (!ids.includes(id)) delete parsed[id];
    C().parsed = parsed;
    // Una misma tarea puede tener varios avisos ("Nueva tarea", "Se entrega mañana"): nos quedamos con el más reciente.
    const byTask = new Map();
    for (const t of Object.values(parsed)) {
      if (!t) continue;
      const prev = byTask.get(t.id);
      if (!prev || t.created > prev.created) byTask.set(t.id, { ...t, due: t.due ?? prev?.due ?? null, created: Math.min(t.created, prev?.created ?? t.created) });
    }
    C().items = [...byTask.values()];
    const keys = new Set(C().items.map((t) => t.id));
    C().done = (C().done || []).filter((id) => keys.has(id));
    C().fetchedAt = Date.now();
    C().status = 'ok';
    C().error = null;
  } catch (e) {
    if (e.status === 401) { storeToken(null); C().status = 'expired'; C().error = null; }
    else if (e.status === 403) {
      C().status = 'error';
      C().error = /has not been used|disabled/i.test(e.detail)
        ? 'Activa la Gmail API en Google Cloud (README).'
        : 'Google ha rechazado la petición al correo.';
    } else { C().status = 'error'; C().error = 'Sin conexión: enseño lo último que cargué.'; }
  } finally {
    busy = false;
    S.commit();
  }
}

/* ---------------- marcar como hecha ---------------- */
export function markDone(id) {
  C().done = [...new Set([...(C().done || []), id])];
  S.commit();
  toast('Entrega marcada como hecha', 'Deshacer', () => {
    C().done = (C().done || []).filter((x) => x !== id);
    S.commit();
  });
}

/* ---------------- pintar ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Pendientes: todo lo que no has marcado, por antiguo que sea. Primero las atrasadas, al final las sin fecha. */
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
  const today = startOfDay(Date.now());
  const list = pending().filter((t) => t.due && t.due >= today && t.due < today + 2 * DAY);
  if (!list.length) return '';
  return `<div class="cr-sec"><div class="cr-h">Entregas</div><ul class="crs">${list.map((t) => item(t)).join('')}</ul></div>`;
}

/** Para la vista completa: todo lo pendiente, con asignatura. */
export function sheetHtml() {
  if (!isConnected()) return '';
  const list = pending();
  let foot = '';
  if (C().status === 'expired') foot = `<button type="button" class="cal-foot-btn" data-cr="connect">La sesión de Gmail caducó · Reconectar</button>`;
  else if (C().error) foot = `<span class="cal-err">${esc(C().error)}</span>`;
  return `<div class="cr-sec full"><div class="cr-h">Entregas pendientes de Classroom${list.length ? ` <span class="badge">${list.length}</span>` : ''}</div>
    ${list.length ? `<ul class="crs">${list.map((t) => item(t, { course: true })).join('')}</ul>` : `<p class="cal-empty">${C().fetchedAt ? 'Nada pendiente en Classroom.' : 'Buscando avisos de Classroom…'}</p>`}
    ${foot ? `<div class="cal-foot">${foot}</div>` : ''}</div>`;
}

/** Bloque de los ajustes del widget. */
export function settingsHtml() {
  const c = C();
  const st = c.error ? c.error
    : !c.connected ? 'Lee los avisos de tareas que Classroom manda a tu Gmail.'
    : c.status === 'expired' ? 'Sesión caducada'
    : c.fetchedAt ? `Conectado · actualizado a las ${new Date(c.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Buscando avisos…';
  return `<div class="pop-title">Google Classroom (vía Gmail)</div>
    <p class="pop-help cr-status">${esc(st)}</p>
    <div class="cr-actions">${c.connected
      ? `<button type="button" class="mini" data-cr="connect">Actualizar</button><button type="button" class="mini" data-cr="disconnect">Desconectar</button>`
      : `<button type="button" class="mini" data-cr="connect">Conectar Gmail</button>`}</div>`;
}

/* ---------------- arranque ---------------- */
export function initClassroom() {
  if (!S.state.classroom) return;
  // Si venías de la versión que usaba la API de Classroom, empezamos de cero.
  if (C().source !== 'gmail') { storeToken(null); S.state.classroom = { connected: false, items: [], parsed: {}, done: [], fetchedAt: null, status: 'off', error: null, source: 'gmail' }; S.save(); }
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
