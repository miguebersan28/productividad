// timer.js — el Pomodoro: fases, sonido, notificaciones y ajustes.
import * as S from './store.js';
import { toast, segmented, setSegment } from './ui.js';

const $ = (s) => document.querySelector(s);
const PHASES = ['work', 'short', 'long'];
const LABEL = { work: 'Trabajo', short: 'Descanso', long: 'Descanso largo' };
const P = () => S.state.pomo;
const full = (phase) => S.state.settings[phase] * 60;

/* El tiempo restante se calcula con la hora de fin (endsAt), no restando 1 cada segundo.
   Así, aunque el navegador ralentice la pestaña o recargues la página, el tiempo es exacto. */
export const running = () => !!P().endsAt;
export function remaining() {
  const p = P();
  return p.endsAt ? Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000)) : p.remaining;
}

function start() {
  ensureAudio();
  askNotifications();
  const p = P();
  if (p.remaining <= 0) p.remaining = full(p.phase);
  p.endsAt = Date.now() + p.remaining * 1000;
  S.commit();
}
function pause() {
  const p = P();
  p.remaining = remaining();
  p.endsAt = null;
  S.commit();
}
export function toggle() { running() ? pause() : start(); }
function reset() {
  const p = P();
  p.endsAt = null;
  p.remaining = full(p.phase);
  S.commit();
}
function setPhase(phase) {
  const p = P();
  p.phase = phase;
  p.endsAt = null;
  p.remaining = full(phase);
  S.commit();
}

/** Pasa a la fase siguiente. Solo cuenta la sesión de trabajo si se ha terminado de verdad. */
function next(completed) {
  const p = P();
  const every = S.state.settings.every;
  let phase;
  if (p.phase === 'work') {
    if (completed) p.cycle++;
    phase = p.cycle >= every ? 'long' : 'short';
  } else {
    if (p.phase === 'long') p.cycle = 0;
    phase = 'work';
  }
  p.phase = phase;
  p.endsAt = null;
  p.remaining = full(phase);
}

function finish({ silent = false } = {}) {
  const ended = P().phase;
  next(true);
  S.commit();
  if (silent) return;
  chime(ended === 'work' ? 'rest' : 'work');
  const nextLabel = LABEL[P().phase].toLowerCase();
  const msg = ended === 'work' ? '¡Sesión terminada!' : 'Se acabó el descanso';
  notify(msg, ended === 'work' ? `Toca ${nextLabel}: ${S.state.settings[P().phase]} minutos.` : 'Vuelta al trabajo cuando quieras.');
  toast(msg, ended === 'work' ? `Empezar ${nextLabel}` : 'Empezar sesión', start, 20000);
}

/* ---------------- sonido: una campanilla generada con Web Audio (no hace falta ningún archivo) ---------------- */
let ctx = null;
export function ensureAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* sin audio */ }
}
function note(freq, t0, dur, vol) {
  for (const [mult, gainMult] of [[1, 1], [2, 0.18], [3, 0.06]]) { // nota + armónicos suaves = timbre de campana
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * gainMult, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / mult);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}
/** 'rest' = baja (relaja, toca descansar). 'work' = sube (activa, toca trabajar). */
export function chime(kind = 'rest') {
  const vol = S.state.settings.volume;
  if (!ctx || vol <= 0) return;
  const v = vol * 0.32;
  const t = ctx.currentTime + 0.03;
  const [a, b] = kind === 'rest' ? [880, 659.25] : [659.25, 987.77];
  note(a, t, 1.3, v);
  note(b, t + 0.24, 1.8, v);
}

/* ---------------- notificaciones del sistema ---------------- */
function askNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(renderSettings);
  }
}
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, tag: 'pomodoro', icon: 'icon.svg', silent: true }); } catch { /* algunos navegadores no dejan crearlas así */ }
}

/* ---------------- pintar ---------------- */
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const hhmm = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
let lastShown = -1;

export function renderTimer(force = false) {
  const p = P();
  const r = remaining();
  const run = running();
  document.body.classList.toggle('paused', !run);
  document.body.dataset.phase = p.phase;
  if (r !== lastShown || force) {
    lastShown = r;
    $('#timer').textContent = fmt(r);
    $('#tbar').style.width = `${(1 - r / full(p.phase)) * 100}%`;
    document.title = run ? `${fmt(r)} · ${LABEL[p.phase]}` : 'Hoy';
  }
  if (!force) return;

  setSegment($('#phaseSeg'), PHASES.indexOf(p.phase));
  for (const ph of PHASES) document.querySelectorAll(`[data-min="${ph}"]`).forEach((el) => (el.textContent = S.state.settings[ph]));

  const every = S.state.settings.every;
  const inCycle = Math.min(p.cycle, every);
  $('#sessLabel').textContent = p.phase === 'work' ? `Sesión ${inCycle + 1} de ${every}` : p.phase === 'long' ? `Ciclo de ${every} completado` : `Descanso tras la sesión ${inCycle}`;
  $('#pips').innerHTML = Array.from({ length: every }, (_, i) => `<i class="${i < inCycle ? 'on' : ''}${i === inCycle && p.phase === 'work' ? ' cur' : ''}"></i>`).join('');

  if (run) {
    const end = new Date(p.endsAt);
    $('#timerNote').textContent = p.phase === 'work'
      ? `${p.cycle + 1 >= every ? 'Descanso largo' : 'Descanso'} a las ${hhmm(end)}`
      : `Vuelta al trabajo a las ${hhmm(end)}`;
  } else {
    $('#timerNote').textContent = r === full(p.phase) ? `Listo para ${LABEL[p.phase].toLowerCase()}` : 'En pausa';
  }
}

/* ---------------- ajustes ---------------- */
const LIMITS = { work: [1, 90], short: [1, 30], long: [1, 60], every: [2, 8] };

function renderSettings() {
  const st = S.state.settings;
  for (const k of Object.keys(LIMITS)) $(`#set-${k}`).textContent = st[k];
  $('#set-volume').value = Math.round(st.volume * 100);
  const n = 'Notification' in window ? Notification.permission : 'unsupported';
  const btn = $('#notifBtn');
  btn.disabled = n !== 'default';
  btn.textContent = { default: 'Activar', granted: 'Activadas', denied: 'Bloqueadas', unsupported: 'No disponibles' }[n];
  $('#notifHelp').hidden = n !== 'denied';
}

function changeSetting(key, delta) {
  const st = S.state.settings;
  const [lo, hi] = LIMITS[key];
  const old = st[key];
  st[key] = Math.max(lo, Math.min(hi, old + delta));
  const p = P();
  // Si la fase actual está parada y sin empezar, se actualiza al nuevo tiempo.
  if (key === p.phase && !running() && p.remaining === old * 60) p.remaining = st[key] * 60;
  S.commit();
  renderSettings();
}

function openSettings(open) {
  const pop = $('#settings');
  const on = open ?? !pop.classList.contains('open');
  pop.classList.toggle('open', on);
  pop.inert = !on;
  $('#settingsBtn').setAttribute('aria-expanded', on);
  if (on) { renderSettings(); pop.querySelector('button')?.focus({ preventScroll: true }); }
}

export function initTimer() {
  $('#play').addEventListener('click', toggle);
  $('#resetBtn').addEventListener('click', reset);
  $('#skipBtn').addEventListener('click', () => { next(false); S.commit(); });
  segmented($('#phaseSeg'), (i) => setPhase(PHASES[i]));

  $('#settingsBtn').addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  $('#settings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) changeSetting(b.dataset.key, Number(b.dataset.step));
  });
  $('#set-volume').addEventListener('input', (e) => { S.state.settings.volume = e.target.value / 100; S.save(); });
  $('#set-volume').addEventListener('change', () => { ensureAudio(); chime('rest'); });
  $('#testSound').addEventListener('click', () => { ensureAudio(); chime('rest'); });
  $('#notifBtn').addEventListener('click', askNotifications);
  document.addEventListener('pointerdown', (e) => {
    ensureAudio(); // el navegador solo deja sonar audio después de que toques algo
    if (!e.target.closest('#settings,#settingsBtn')) openSettings(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });
  $('#settings').inert = true;

  // Si cerraste la web con el temporizador en marcha y ya ha terminado, pasamos a la siguiente fase sin sonar.
  if (running() && remaining() <= 0) finish({ silent: true });

  setInterval(() => {
    if (running() && remaining() <= 0) finish();
    else renderTimer();
  }, 250);
}
