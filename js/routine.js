// routine.js — tu rutina (actividades con hora que se repiten ciertos días) y tus recados sueltos.
//
// - Rutina: cada actividad tiene hora de inicio (y de fin, opcional) y los días de la semana en que toca.
//   Cada día las puedes tachar; al día siguiente se desmarcan solas.
// - Recados: cosas puntuales sin hora (comprar algo, llamar a alguien). Al hacerlos, desaparecen.
import * as S from './store.js';
import { toast } from './ui.js';

const $ = (s) => document.querySelector(s);
const R = () => S.state.routine;
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const weekday = (d = new Date()) => (d.getDay() + 6) % 7; // lunes = 0
const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

let viewDay = weekday(); // día que enseña la vista completa
let formDays = new Set([weekday()]);

/** Los tachados son de hoy: si ha cambiado el día, empiezan vacíos. */
function checks() {
  if (R().checks?.day !== S.today()) R().checks = { day: S.today(), ids: [] };
  return R().checks;
}
const isChecked = (id) => checks().ids.includes(id);

const itemsOn = (wd) => R().items.filter((a) => a.days.includes(wd)).sort((a, b) => toMin(a.start) - toMin(b.start));

/** Fin de una actividad: el que pusiste o, si no, cuando empieza la siguiente (máx. 1 h). */
function endOf(a, list) {
  if (a.end) return toMin(a.end);
  const next = list.find((b) => toMin(b.start) > toMin(a.start));
  return Math.min(next ? toMin(next.start) : Infinity, toMin(a.start) + 60);
}

function state(a, list) {
  if (isChecked(a.id)) return 'done';
  const n = nowMin();
  if (n >= endOf(a, list)) return 'past';
  if (n >= toMin(a.start)) return 'live';
  return '';
}

const timeText = (a) => a.end ? `${a.start}–${a.end}` : a.start;

/* ---------------- widget (hueco pequeño): lo de ahora y lo siguiente ---------------- */
export function renderRoutine() {
  const today = itemsOn(weekday());
  const upcoming = today.filter((a) => !['done', 'past'].includes(state(a, today))).slice(0, 3);
  const errands = R().errands.length;
  let html = '';
  if (!R().items.length) {
    html = `<p class="cal-empty">Apunta aquí tu día a día: gimnasio, comer, estudiar…</p>`;
  } else if (!upcoming.length) {
    html = `<p class="cal-empty">${today.length ? 'Rutina de hoy completada.' : 'Hoy no tienes nada en la rutina.'}</p>`;
  } else {
    html = '<ul class="evs rt-mini">' + upcoming.map((a) => {
      const st = state(a, today);
      return `<li class="ev ${st}"><span class="et">${esc(a.start)}</span><span class="edot rt-dot"></span><span class="en">${esc(a.title)}</span>${st === 'live' ? '<span class="elive">Ahora</span>' : ''}</li>`;
    }).join('') + '</ul>';
  }
  const foot = `${errands ? `<span class="rt-errands">${errands} ${errands === 1 ? 'recado' : 'recados'}</span><span class="dotsep">·</span>` : ''}<span>Ver el día</span><svg class="i"><use href="#i-chevron"/></svg>`;
  html += `<div class="cal-foot">${foot}</div>`;
  if ($('#rtBody').innerHTML !== html) $('#rtBody').innerHTML = html;
  if ($('#rtSheet').classList.contains('open')) renderSheet();
}

/* ---------------- vista completa: horario del día, recados y añadir ---------------- */
function renderSheet() {
  const wd = viewDay;
  const isToday = wd === weekday();
  $('#rtDayTabs').innerHTML = DAYS.map((d, i) => `<button type="button" data-rt-day="${i}" class="${i === wd ? 'on' : ''}${i === weekday() ? ' today' : ''}" aria-pressed="${i === wd}" aria-label="${DAY_NAMES[i]}">${d}</button>`).join('');
  $('#rtTitle').textContent = isToday ? 'Rutina de hoy' : `Rutina del ${DAY_NAMES[wd]}`;
  const list = itemsOn(wd);
  $('#rtList').innerHTML = list.length ? list.map((a) => {
    const st = isToday ? state(a, list) : '';
    return `<li class="rt ${st}" data-rt="${esc(a.id)}">
      ${isToday ? `<button type="button" class="cr-chk rt-chk" data-rt-check="${esc(a.id)}" aria-pressed="${st === 'done'}" aria-label="${st === 'done' ? 'Desmarcar' : 'Tachar'}: ${esc(a.title)}"></button>` : ''}
      <span class="et">${esc(timeText(a))}</span>
      <span class="rt-main"><span class="en">${esc(a.title)}</span>
      <span class="rt-days">${a.days.length === 7 ? 'todos los días' : a.days.length === 5 && a.days.every((d) => d < 5) ? 'L a V' : a.days.length === 1 ? `solo ${DAY_NAMES[a.days[0]]}` : a.days.map((d) => DAYS[d]).join(' ')}</span></span>
      ${st === 'live' ? '<span class="elive">Ahora</span>' : ''}
      <button type="button" class="del rt-del" data-rt-del="${esc(a.id)}" aria-label="Quitar ${esc(a.title)} de la rutina"><svg class="i"><use href="#i-trash"/></svg></button>
    </li>`;
  }).join('') : `<li class="cal-empty">Nada el ${DAY_NAMES[wd]}. Añade una actividad abajo.</li>`;

  $('#rtFormDays').innerHTML = DAYS.map((d, i) => `<button type="button" data-rt-fday="${i}" class="${formDays.has(i) ? 'on' : ''}" aria-pressed="${formDays.has(i)}" aria-label="${DAY_NAMES[i]}">${d}</button>`).join('');

  const errands = R().errands;
  $('#rtErrands').innerHTML = errands.length ? errands.map((e) => `<li class="rt rt-errand">
      <button type="button" class="cr-chk" data-rt-errand="${esc(e.id)}" aria-label="Hecho: ${esc(e.text)}"></button>
      <span class="en">${esc(e.text)}</span></li>`).join('') : `<li class="cal-empty">Sin recados pendientes.</li>`;
}

function openSheet(open) {
  const sheet = $('#rtSheet');
  const on = open ?? !sheet.classList.contains('open');
  if (on === sheet.classList.contains('open')) return;
  if (on) { viewDay = weekday(); formDays = new Set([viewDay]); renderSheet(); }
  sheet.classList.toggle('open', on);
  sheet.inert = !on;
  if (on) $('#rtClose').focus({ preventScroll: true });
}

/* ---------------- acciones ---------------- */
function addActivity() {
  const title = $('#rtNewTitle').value.trim().slice(0, 80);
  const start = $('#rtNewStart').value;
  const end = $('#rtNewEnd').value;
  const err = !title ? 'Escribe qué actividad es.' : !start ? 'Pon la hora a la que empieza.' : !formDays.size ? 'Elige al menos un día.' : end && toMin(end) <= toMin(start) ? 'La hora de fin tiene que ser después del inicio.' : '';
  $('#rtFormErr').textContent = err;
  if (err) return;
  R().items.push({ id: newId(), title, start, end: end || null, days: [...formDays].sort() });
  $('#rtNewTitle').value = '';
  $('#rtNewEnd').value = '';
  formDays = new Set([viewDay]); // vuelve al día que estás viendo, para no añadir sin querer a toda la semana
  S.commit();
  $('#rtNewTitle').focus();
}

function removeActivity(id) {
  const i = R().items.findIndex((a) => a.id === id);
  if (i < 0) return;
  const [a] = R().items.splice(i, 1);
  S.commit();
  toast(`"${a.title}" quitada de la rutina`, 'Deshacer', () => { R().items.splice(i, 0, a); S.commit(); });
}

function toggleCheck(id) {
  const c = checks();
  c.ids = c.ids.includes(id) ? c.ids.filter((x) => x !== id) : [...c.ids, id];
  S.commit();
}

function addErrand() {
  const text = $('#rtNewErrand').value.trim().slice(0, 120);
  if (!text) return;
  R().errands.push({ id: newId(), text });
  $('#rtNewErrand').value = '';
  S.commit();
}

function doneErrand(id) {
  const i = R().errands.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [e] = R().errands.splice(i, 1);
  S.commit();
  toast('Recado hecho', 'Deshacer', () => { R().errands.splice(i, 0, e); S.commit(); });
}

/* ---------------- arranque ---------------- */
export function initRoutine() {
  $('#rtSheet').inert = true;
  const w = $('.w.routine');
  w.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#rtBody')) return openSheet(true);
    if (t.closest('#rtClose')) return openSheet(false);
    const day = t.closest('[data-rt-day]');
    if (day) { viewDay = Number(day.dataset.rtDay); formDays = new Set([viewDay]); return renderSheet(); }
    const fday = t.closest('[data-rt-fday]');
    if (fday) { const d = Number(fday.dataset.rtFday); formDays.has(d) ? formDays.delete(d) : formDays.add(d); return renderSheet(); }
    if (t.closest('[data-rt-preset="weekdays"]')) { formDays = new Set([0, 1, 2, 3, 4]); return renderSheet(); }
    if (t.closest('[data-rt-preset="all"]')) { formDays = new Set([0, 1, 2, 3, 4, 5, 6]); return renderSheet(); }
    const chk = t.closest('[data-rt-check]');
    if (chk) return toggleCheck(chk.dataset.rtCheck);
    const del = t.closest('[data-rt-del]');
    if (del) return removeActivity(del.dataset.rtDel);
    const er = t.closest('[data-rt-errand]');
    if (er) return doneErrand(er.dataset.rtErrand);
    if (t.closest('#rtAddBtn')) return addActivity();
  });
  $('#rtBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(true); } });
  $('#rtNewTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addActivity(); } });
  $('#rtNewErrand').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addErrand(); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#rtSheet,#rtBody,#toast')) openSheet(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
  setInterval(renderRoutine, 30 * 1000); // para que "Ahora" y lo siguiente avancen con la hora
}
