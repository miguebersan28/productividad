// main.js — arranca la app y conecta las piezas.
import * as S from './store.js';
import { renderTasks, initTasks, PRIO } from './tasks.js';
import { renderTimer, initTimer, toggle as toggleTimer } from './timer.js';
import { segmented } from './ui.js';
import { reduceMotion } from './spring.js';
import { initCalendar, renderCalendar, refresh as refreshCalendar } from './calendar.js';
import { initClassroom } from './classroom.js';
import { initRoutine, renderRoutine } from './routine.js';

const $ = (s) => document.querySelector(s);

/* ---------------- tarjeta de foco: la tarea en curso ---------------- */
function splitTask(text) {
  // "Matemáticas: derivadas, hoja 4" → asignatura "Matemáticas", título "Derivadas, hoja 4"
  const i = text.indexOf(':');
  if (i > 0 && i < 40 && text.slice(i + 1).trim()) {
    const rest = text.slice(i + 1).trim();
    return [text.slice(0, i).trim(), rest[0].toUpperCase() + rest.slice(1)];
  }
  return [null, text];
}

let shownTitle = null;
function renderFocus() {
  const cur = S.currentTask();
  let meta, title, subjectText;
  if (cur) {
    const [subject, t] = splitTask(cur.text);
    const p = PRIO[cur.prio];
    meta = `<span class="bang" style="color:${p.c}">${p.b}</span><span></span>`;
    title = t;
    subjectText = subject || 'Tarea en curso';
  } else {
    const any = S.todayPending().length + S.todayDone().length;
    meta = '<span></span>';
    subjectText = any ? 'Buen trabajo' : 'Sin tareas todavía';
    title = any ? 'Todo hecho por hoy' : 'Añade tu primera tarea a la derecha';
  }
  const key = title + '|' + subjectText;
  if (key === shownTitle) return;
  const apply = () => {
    $('#meta').innerHTML = meta;
    $('#meta').lastElementChild.textContent = subjectText; // textContent: el texto del usuario nunca se interpreta como HTML
    $('#title').textContent = title;
  };
  if (shownTitle === null || reduceMotion.matches) apply();
  else {
    // Fundido con un poco de desenfoque: se lee como una sola transformación, no como dos textos superpuestos.
    $('#title').classList.add('swap');
    $('#meta').classList.add('swap');
    setTimeout(() => { apply(); $('#title').classList.remove('swap'); $('#meta').classList.remove('swap'); }, 200);
  }
  shownTitle = key;
}

/* ---------------- racha ---------------- */
function renderStreak() {
  const { count, todayRes } = S.streakView();
  $('#streakN').textContent = count;
  $('#streakTitle').textContent = `${count} ${count === 1 ? 'día' : 'días'} de racha`;
  $('#streakPill').classList.toggle('hot', todayRes === 'ok');
  $('#streakPill').classList.toggle('cold', count === 0);
  const notes = {
    ok: 'Hoy ya cuenta: todas las !!! hechas.',
    fail: 'Completa las tareas !!! para sumar hoy.',
    none: 'Añade alguna tarea !!! para sumar hoy.',
  };
  $('#streakNote').textContent = notes[todayRes];
  $('#streakPill').setAttribute('aria-label', `Racha: ${count} ${count === 1 ? 'día' : 'días'}. ${notes[todayRes]}`);
  // Últimos 7 días (el último es hoy)
  const bars = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = S.dayStr(d);
    const res = i === 0 ? (todayRes === 'ok' ? 'ok' : 'today') : S.state.streak.history[ds] || 'none';
    bars.push(`<i class="${res}"></i>`);
  }
  $('#streakWeek').innerHTML = bars.join('');
}

/* ---------------- reloj ---------------- */
function renderClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const wd = d.toLocaleDateString('es-ES', { weekday: 'long' });
  $('#weekday').textContent = wd[0].toUpperCase() + wd.slice(1);
  $('#date').textContent = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

/* ---------------- modo foco ---------------- */
function setFocusMode(on) {
  const go = () => {
    document.body.classList.toggle('focus-mode', on);
    $('#focusLbl').textContent = on ? 'Salir' : 'Modo foco';
    $('#focusBtn').setAttribute('aria-pressed', on);
  };
  // View Transitions: el navegador anima solo el cambio entre "antes" y "después".
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(go);
  else go();
}
const inFocus = () => document.body.classList.contains('focus-mode');

/* ---------------- todo junto ---------------- */
function renderAll(opts = {}) {
  renderTasks(opts);
  renderFocus();
  renderStreak();
  renderTimer(true);
  renderCalendar();
  renderRoutine();
}

S.rollover();
S.save();
S.subscribe(renderAll);
initTasks();
initTimer();
initCalendar();
initClassroom();
initRoutine();
segmented($('#prioSeg'));
renderClock();
renderAll();

setInterval(() => {
  renderClock();
  if (S.rollover()) { S.commit(); refreshCalendar(); } // ha pasado la medianoche: día nuevo
}, 1000);

// Otra pestaña ha cambiado los datos → nos actualizamos.
addEventListener('storage', (e) => { if (e.key === 'hoy.dashboard.v1') S.reloadFromStorage(); });

$('#focusBtn').addEventListener('click', () => setFocusMode(!inFocus()));

// Atajos de teclado (solo cuando no estás escribiendo)
addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input,textarea,[contenteditable]');
  if (e.key === 'Escape') {
    if (typing) e.target.blur();
    else if (inFocus()) setFocusMode(false);
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('.row') && (e.key === ' ' || e.key === 'Enter')) return; // las filas tienen sus propias teclas
  if (e.code === 'Space' && !e.target.closest?.('button')) { e.preventDefault(); toggleTimer(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); if (inFocus()) setFocusMode(false); $('#newTask').focus(); }
  else if (e.key === 'f' || e.key === 'F') setFocusMode(!inFocus());
});
