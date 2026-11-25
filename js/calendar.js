// calendar.js — Google Calendar en modo solo lectura.
//
// Cómo funciona:
// 1. Cargamos la librería oficial de Google para iniciar sesión (Google Identity Services).
// 2. Al pulsar "Conectar", Google te pregunta si das permiso para VER tu calendario.
// 3. Si aceptas, nos da un "token de acceso" que vale 1 hora. Con él pedimos tus eventos
//    directamente a Google desde tu navegador: no pasan por ningún otro servidor.
// 4. Guardamos los eventos de hoy para seguir enseñándolos aunque el token caduque.
import * as S from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import * as CR from './classroom.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'hoy.gcal.token';
const $ = (s) => document.querySelector(s);
const G = () => S.state.gcal;

export const configured = () => !!GOOGLE_CLIENT_ID;

/* ---------------- token ---------------- */
let token = readToken();
function readToken() {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY)); return t && t.exp > Date.now() ? t : null; } catch { return null; }
}
function storeToken(t) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ }
}
const hasToken = () => !!token && token.exp > Date.now() + 30_000;

/* ---------------- Google Identity Services ---------------- */
let gisPromise = null;
let tokenClient = null;
export function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('No se pudo cargar Google')); };
    document.head.append(s);
  });
  return gisPromise;
}
function client() {
  if (tokenClient || !window.google?.accounts?.oauth2) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: onToken,
    error_callback: (err) => {
      // El usuario cerró la ventana o el navegador la bloqueó.
      setStatus(G().connected ? 'expired' : 'off', err?.type === 'popup_closed' ? null : 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta web.');
    },
  });
  return tokenClient;
}
function onToken(resp) {
  if (resp.error || !google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
    setStatus(G().connected ? 'expired' : 'off', 'Sin el permiso para ver tu calendario no puedo enseñar tus eventos.');
    return;
  }
  storeToken({ value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) - 60) * 1000 });
  G().connected = true;
  refresh({ calendars: true });
}

/** Tiene que llamarse desde un clic: los navegadores solo dejan abrir ventanas cuando tú pulsas algo. */
function connect() {
  const c = client();
  if (!c) {
    setStatus(G().status, 'Cargando Google… vuelve a pulsar en un segundo.');
    loadGis().then(client).catch(() => setStatus(G().status, 'No se pudo cargar Google. ¿Hay conexión?'));
    return;
  }
  c.requestAccessToken({ prompt: G().connected ? '' : 'consent' });
}

function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
  storeToken(null);
  S.state.gcal = { ...S.state.gcal, connected: false, calendars: [], selected: null, events: [], fetchedAt: null, day: null, status: 'off', error: null };
  S.commit();
}

function setStatus(status, error = null) {
  G().status = status;
  G().error = error;
  S.commit();
}

/* ---------------- pedir datos a Google ---------------- */
async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token.value}` } });
  if (!r.ok) { const e = new Error('Calendar API ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

function dayBounds() {
  const start = S.parseDay(S.today());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}

const declined = (e) => e.attendees?.some((a) => a.self && a.responseStatus === 'declined');

function toEvent(e, cal) {
  const allDay = !!e.start?.date;
  const start = allDay ? S.parseDay(e.start.date).getTime() : new Date(e.start.dateTime).getTime();
  const end = allDay ? S.parseDay(e.end.date).getTime() : new Date(e.end.dateTime).getTime();
  return { id: e.id, title: e.summary || '(Sin título)', start, end, allDay, color: cal.color, cal: cal.name };
}

let busy = false;
export async function refresh({ calendars = false } = {}) {
  if (!configured() || !G().connected) return;
  if (!hasToken()) { if (G().status !== 'expired') setStatus('expired'); return; }
  if (busy) return;
  busy = true;
  $('#calSync').classList.add('spin');
  try {
    if (calendars || !G().calendars.length) {
      const list = await api('/users/me/calendarList?minAccessRole=reader&maxResults=250');
      G().calendars = (list.items || []).map((c) => ({
        id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#5e5ce6',
        primary: !!c.primary, visible: !!c.selected,
      })).sort((a, b) => b.primary - a.primary || a.name.localeCompare(b.name));
      // La primera vez: los mismos que tienes visibles en Google Calendar.
      if (!G().selected) G().selected = G().calendars.filter((c) => c.visible || c.primary).map((c) => c.id);
    }
    const { start, end } = dayBounds();
    const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
    const cals = G().calendars.filter((c) => G().selected.includes(c.id));
    // Todas las peticiones a la vez (Promise.all) en lugar de una detrás de otra: tarda lo que la más lenta.
    const results = await Promise.all(cals.map((c) => api(`/calendars/${encodeURIComponent(c.id)}/events?${params}`).then((r) => ({ c, items: r.items || [] }))));
    // Un mismo evento puede estar en dos calendarios (p. ej. uno compartido): lo enseñamos una sola vez.
    const seen = new Set();
    G().events = results
      .flatMap(({ c, items }) => items.filter((e) => e.status !== 'cancelled' && !declined(e) && e.start).map((e) => ({ ...toEvent(e, c), uid: e.iCalUID || e.id })))
      .filter((e) => { const k = e.uid + '|' + e.start; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.allDay - a.allDay || a.start - b.start);
    G().fetchedAt = Date.now();
    G().day = S.today();
    G().status = 'ok';
    G().error = null;
  } catch (e) {
    if (e.status === 401) { storeToken(null); G().status = 'expired'; G().error = null; }
    else if (e.status === 403) { G().status = 'error'; G().error = 'Google ha rechazado la petición. Revisa que la Google Calendar API esté activada (README).'; }
    else { G().status = 'error'; G().error = 'Sin conexión: enseño lo último que cargué.'; }
  } finally {
    busy = false;
    S.commit();
  }
}

/* ---------------- pintar ---------------- */
const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayEvents = () => (G().day === S.today() ? G().events : []);

// Comparamos sin mayúsculas ni tildes: "geografia" oculta "Geografía".
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const isHidden = (e) => (G().hidden || []).some((h) => norm(h) === norm(e.title));
const visibleEvents = () => todayEvents().filter((e) => !isHidden(e));

function evItem(e, now) {
  const state = e.allDay ? '' : e.end <= now ? 'past' : e.start <= now ? 'live' : '';
  const time = e.allDay ? 'Todo el día' : hhmm(e.start);
  return `<li class="ev ${state}" title="${esc(e.cal)}"><span class="et">${time}</span><span class="edot" style="background:${esc(e.color)}"></span><span class="en">${esc(e.title)}</span>${state === 'live' ? '<span class="elive">Ahora</span>' : ''}</li>`;
}

export function renderCalendar() {
  const body = $('#calBody');
  const g = G();
  $('#calSync').hidden = !g.connected && !CR.isConnected();
  $('#calSettingsBtn').hidden = !configured();
  $('#calSync').classList.toggle('spin', busy);
  const now = Date.now();
  const loaded = g.day === S.today();
  const visible = visibleEvents();
  // En el widget solo lo que está pasando y lo que queda; lo terminado se ve al abrirlo.
  const upcoming = visible.filter((e) => e.allDay || e.end > now);
  const canOpen = configured() && ((g.connected && loaded) || CR.isConnected());
  const entregas = CR.widgetHtml(); // entregas de Classroom de hoy y mañana
  document.querySelector('.cal').classList.toggle('openable', canOpen);

  let html = '';
  if (!configured()) {
    html = `<p class="cal-empty">Falta el ID de cliente de Google. Sigue los pasos del README para conectarlo.</p>`;
  } else if (!g.connected) {
    html = entregas + `<p class="cal-empty">Ve aquí tus eventos de hoy.</p><button type="button" class="cal-connect" data-cal="connect">Conectar Google Calendar</button>`;
  } else {
    html = entregas;
    if (upcoming.length) html += '<ul class="evs">' + upcoming.map((e) => evItem(e, now)).join('') + '</ul>';
    else if (!entregas) html += `<p class="cal-empty">${!loaded ? 'Pulsa actualizar para cargar los eventos de hoy.' : visible.length ? 'No queda nada más hoy.' : 'Nada en el calendario hoy.'}</p>`;
    let foot = '';
    if (g.status === 'expired') foot = `<button type="button" class="cal-foot-btn" data-cal="connect">La sesión de Google caducó · Reconectar</button>`;
    else if (g.error) foot = `<span class="cal-err">${esc(g.error)}</span>`;
    else if (canOpen) foot = `<span>Ver el día completo</span><svg class="i"><use href="#i-chevron"/></svg>`;
    html += `<div class="cal-foot">${foot}</div>`;
  }
  if (body.innerHTML !== html) body.innerHTML = html;
  if ($('#calSheet').classList.contains('open')) renderSheet();
  if ($('#calPop').classList.contains('open')) $('#crSettings').innerHTML = CR.settingsHtml();
  renderNextEvent();
}

/** Vista completa del día: se abre al pulsar el widget, con lo ya terminado atenuado. */
function renderSheet() {
  const g = G();
  const now = Date.now();
  const visible = visibleEvents();
  const hiddenN = todayEvents().length - visible.length;
  const cr = CR.sheetHtml();
  if ($('#crSheet').innerHTML !== cr) $('#crSheet').innerHTML = cr;
  $('#calSheetEvTitle').hidden = !cr || !g.connected;
  const html = !g.connected ? '' : visible.length ? visible.map((e) => evItem(e, now)).join('') : '<li class="cal-empty">Nada en el calendario hoy.</li>';
  if ($('#calSheetList').innerHTML !== html) $('#calSheetList').innerHTML = html;
  const parts = [];
  if (hiddenN) parts.push(`${hiddenN} ${hiddenN === 1 ? 'evento oculto' : 'eventos ocultos'}`);
  if (g.fetchedAt) parts.push(`actualizado a las ${hhmm(g.fetchedAt)}`);
  const foot = parts.join(' · ');
  $('#calSheetFoot').textContent = foot ? foot[0].toUpperCase() + foot.slice(1) : '';
}

function openSheet(open) {
  const sheet = $('#calSheet');
  const on = open ?? !sheet.classList.contains('open');
  if (on === sheet.classList.contains('open')) return;
  if (on) { openPicker(false); renderSheet(); }
  sheet.classList.toggle('open', on);
  sheet.inert = !on;
  if (on) $('#calSheetClose').focus({ preventScroll: true });
}

/** Aviso en la tarjeta grande cuando falta menos de 1 hora para el siguiente evento. */
function renderNextEvent() {
  const el = $('#nextEv');
  const now = Date.now();
  const next = visibleEvents().find((e) => !e.allDay && e.start > now && e.start - now <= 60 * 60 * 1000);
  el.classList.toggle('show', !!next);
  if (!next) return;
  const mins = Math.ceil((next.start - now) / 60000);
  el.querySelector('span').textContent = `${next.title} ${mins <= 1 ? 'empieza ya' : `en ${mins} min`}`;
  el.classList.toggle('soon', mins <= 10);
}

function renderPicker() {
  $('#crSettings').innerHTML = CR.settingsHtml();
  const list = $('#calList');
  list.innerHTML = '';
  for (const c of G().calendars) {
    const li = document.createElement('label');
    li.className = 'cal-opt';
    li.innerHTML = `<input type="checkbox"><span class="edot"></span><span class="cname"></span>`;
    li.querySelector('input').checked = G().selected?.includes(c.id);
    li.querySelector('input').dataset.id = c.id;
    li.querySelector('.edot').style.background = c.color;
    li.querySelector('.cname').textContent = c.name + (c.primary ? ' (principal)' : '');
    list.append(li);
  }
  renderChips();
}

function renderChips() {
  const box = $('#hideChips');
  box.innerHTML = '';
  for (const name of G().hidden || []) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span></span><button type="button" aria-label=""><svg class="i"><use href="#i-x"/></svg></button>`;
    chip.firstChild.textContent = name;
    chip.querySelector('button').dataset.name = name;
    chip.querySelector('button').setAttribute('aria-label', `Dejar de ocultar ${name}`);
    box.append(chip);
  }
}

function openPicker(open) {
  const pop = $('#calPop');
  const on = open ?? !pop.classList.contains('open');
  pop.classList.toggle('open', on);
  pop.inert = !on;
  $('#calSettingsBtn').setAttribute('aria-expanded', on);
  if (on) { openSheet(false); renderPicker(); }
  $('#calGoogleSection').hidden = !G().connected;
}

/* ---------------- arranque ---------------- */
export function initCalendar() {
  if (!S.state.gcal) return;
  $('#calPop').inert = true;
  $('#calSheet').inert = true;
  if (configured()) loadGis().then(client).catch(() => {}); // se precarga para que "Conectar" abra la ventana al instante

  document.querySelector('.cal').addEventListener('click', (e) => {
    if (e.target.closest('[data-cal="connect"]')) return connect();
    // Pulsar el cuerpo del widget abre la vista completa del día.
    if (e.target.closest('a,button')) return; // los botones y enlaces de dentro hacen lo suyo
    if (e.target.closest('#calBody') && document.querySelector('.cal').classList.contains('openable')) openSheet(true);
  });
  $('#calBody').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === $('#calBody') && document.querySelector('.cal').classList.contains('openable')) { e.preventDefault(); openSheet(true); }
  });
  $('#calSheetClose').addEventListener('click', (e) => { e.stopPropagation(); openSheet(false); });
  $('#calSync').addEventListener('click', () => {
    if (G().connected) hasToken() ? refresh() : connect();
    else if (CR.isConnected()) CR.hasToken() ? CR.refresh() : CR.connect();
  });
  $('#calSettingsBtn').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  $('#calList').addEventListener('change', (e) => {
    const id = e.target.dataset.id;
    const sel = new Set(G().selected || []);
    e.target.checked ? sel.add(id) : sel.delete(id);
    G().selected = [...sel];
    S.commit();
    refresh();
  });
  // Lista de nombres ocultos
  $('#hideChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]');
    if (!b) return;
    G().hidden = (G().hidden || []).filter((h) => h !== b.dataset.name);
    S.commit();
    renderChips();
  });
  $('#hideInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = e.target.value.trim().slice(0, 80);
    if (!name) return;
    if (!(G().hidden || []).some((h) => norm(h) === norm(name))) G().hidden = [...(G().hidden || []), name];
    e.target.value = '';
    S.commit();
    renderChips();
  });
  $('#calDisconnect').addEventListener('click', () => { openPicker(false); disconnect(); });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#calPop,#calSettingsBtn')) openPicker(false);
    if (!e.target.closest('#calSheet,#calBody,#toast')) openSheet(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openPicker(false); openSheet(false); } });

  if (G().connected && !hasToken() && G().status === 'ok') G().status = 'expired';
  refresh();
  setInterval(() => refresh(), 5 * 60 * 1000); // cada 5 minutos mientras el token sea válido
  setInterval(renderCalendar, 15 * 1000);       // para que los eventos terminados salgan del widget a su hora
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

export { hasToken };
