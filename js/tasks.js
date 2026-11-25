// tasks.js — la lista de tareas: pintarla y todo lo que se puede hacer con ella.
import * as S from './store.js';
import { flip, rubberband, project, reduceMotion } from './spring.js';
import { toast } from './ui.js';

const PRIO = {
  3: { c: 'var(--red)', b: '!!!', name: 'alta' },
  2: { c: 'var(--orange)', b: '!!', name: 'media' },
  1: { c: 'var(--yellow)', b: '!', name: 'baja' },
};
const $ = (s) => document.querySelector(s);
const ul = { pending: $('#pending'), done: $('#done'), overdue: $('#overdue') };
const nodes = new Map(); // id de tarea → <li>. Reutilizamos los nodos para poder animarlos.
const pendingToggles = new Map();

/* ---------------- pintar ---------------- */

function daysAgo(day) {
  const n = Math.round((S.parseDay(S.today()) - S.parseDay(day)) / 86400000);
  return n === 1 ? 'ayer' : `hace ${n} días`;
}

function createRow(t) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = t.id;
  li.tabIndex = 0;
  li.innerHTML = `
    <button class="circ" type="button"></button>
    <div class="body">
      <span class="bang" aria-hidden="true"></span>
      <span class="name"></span>
      <span class="end">
        <span class="now">Ahora</span>
        <span class="age"></span>
        <button class="tohoy" type="button">Pasar a hoy</button>
        <svg class="i grip" aria-hidden="true"><use href="#i-grip"/></svg>
        <button class="del" type="button" aria-label="Borrar tarea"><svg class="i"><use href="#i-trash"/></svg></button>
      </span>
    </div>`;
  return li;
}

function updateRow(li, t, kind, currentId) {
  const p = PRIO[t.prio];
  li.dataset.p = t.prio;
  li.dataset.kind = kind;
  li.style.setProperty('--c', p.c);
  li.classList.toggle('done', t.done);
  li.classList.toggle('current', kind === 'pending' && t.id === currentId);
  li.querySelector('.bang').textContent = p.b;
  li.querySelector('.name').textContent = t.text;
  li.querySelector('.age').textContent = kind === 'overdue' ? daysAgo(t.day) : '';
  li.querySelector('.circ').setAttribute('aria-label', `${t.done ? 'Desmarcar' : 'Completar'}: ${t.text}`);
  li.setAttribute('aria-label', `${t.text}, prioridad ${p.name}`);
}

function sync(list, tasks, kind, currentId, seen) {
  for (const t of tasks) {
    let li = nodes.get(t.id);
    if (!li) {
      li = createRow(t);
      nodes.set(t.id, li);
      if (!firstRender) li.classList.add('born');
    }
    updateRow(li, t, kind, currentId);
    list.append(li); // si ya existía, append lo mueve a su sitio
    seen.add(t.id);
  }
}

let firstRender = true;
export function renderTasks(opts = {}) {
  const pend = S.todayPending();
  const done = S.todayDone();
  const late = S.overdue();
  const cur = S.currentTask();

  const mutate = () => {
    const seen = new Set();
    sync(ul.overdue, late, 'overdue', null, seen);
    sync(ul.pending, pend, 'pending', cur?.id, seen);
    sync(ul.done, done, 'done', null, seen);
    for (const [id, li] of nodes) if (!seen.has(id)) { li.remove(); nodes.delete(id); }

    $('#overdueBox').hidden = !late.length;
    $('#overdueCount').textContent = late.length;
    const open = S.state.ui.overdueOpen;
    $('#overdueToggle').setAttribute('aria-expanded', open);
    ul.overdue.hidden = !open;
    $('#doneHead').hidden = !done.length;
    $('#emptyMsg').hidden = pend.length > 0;
    $('#emptyMsg').textContent = done.length ? '¡Todo hecho por hoy!'
      : late.length ? 'Pasa alguna atrasada a hoy o escribe una tarea nueva arriba.'
      : 'Escribe arriba tu primera tarea y pulsa Enter.';
    $('#hint').hidden = pend.length < 2;
  };
  if (firstRender || opts.external) mutate(); else flip(mutate, opts);
  firstRender = false;

  // Contador y barra de progreso del día (solo tareas de hoy).
  const total = pend.length + done.length;
  $('#count').textContent = done.length;
  $('#total').textContent = total;
  $('#dprog').style.width = (total ? (done.length / total) * 100 : 0) + '%';
  $('#dprog').parentElement.setAttribute('aria-valuenow', total ? Math.round((done.length / total) * 100) : 0);
}

/* ---------------- acciones ---------------- */

function toggle(li) {
  const id = li.dataset.id;
  const t = S.findTask(id);
  if (!t) return;
  // Primero el feedback visual (tachado, círculo relleno) y, un instante después, la tarea viaja a su sitio.
  const willBeDone = !li.classList.contains('done');
  li.classList.toggle('done', willBeDone);
  clearTimeout(pendingToggles.get(id));
  pendingToggles.set(id, setTimeout(() => {
    pendingToggles.delete(id);
    S.setDone(id, willBeDone);
    S.commit();
  }, reduceMotion.matches ? 0 : 420));
}

function remove(li) {
  const id = li.dataset.id;
  li.classList.add('leaving');
  setTimeout(() => {
    const t = S.removeTask(id);
    S.commit();
    if (t) toast(`Tarea borrada`, 'Deshacer', () => { S.restoreTask(t); S.commit(); });
  }, 170);
}

function moveWithinGroup(li, delta) {
  const group = S.todayPending().filter((t) => String(t.prio) === li.dataset.p).map((t) => t.id);
  const i = group.indexOf(li.dataset.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return;
  [group[i], group[j]] = [group[j], group[i]];
  S.setOrder(group);
  S.commit();
  li.focus();
}

export function initTasks() {
  // Un solo "escuchador" para toda la lista (delegación de eventos): funciona también con filas nuevas.
  document.querySelector('.scroller').addEventListener('click', (e) => {
    const li = e.target.closest('.row');
    if (!li) return;
    if (e.target.closest('.circ')) return toggle(li);
    if (e.target.closest('.del')) return remove(li);
    if (e.target.closest('.tohoy')) { S.moveToToday(li.dataset.id); S.commit(); }
  });

  document.querySelector('.scroller').addEventListener('keydown', (e) => {
    const li = e.target.closest('.row');
    if (!li || e.target !== li) return;
    if (e.key === 'Enter' && li.dataset.kind === 'pending') { S.setCurrent(li.dataset.id); S.commit(); }
    else if (e.key === ' ') { e.preventDefault(); toggle(li); }
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(li);
    else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveWithinGroup(li, -1); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveWithinGroup(li, 1); }
  });

  $('#overdueToggle').addEventListener('click', () => {
    S.state.ui.overdueOpen = !S.state.ui.overdueOpen;
    S.commit();
  });

  // Añadir tarea
  $('#newTask').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const text = e.target.value.trim();
    if (!text) return;
    const i = Number(getComputedStyle($('#prioSeg')).getPropertyValue('--i')) || 0;
    S.addTask(text.slice(0, 200), [3, 2, 1][i]);
    e.target.value = '';
    S.commit();
  });

  initDrag();
}

/* ---------------- arrastrar para reordenar ---------------- */
// 1:1 con el ratón, resistencia al llegar al borde de su grupo de prioridad,
// e inercia al soltar (si la lanzas, llega más lejos).

function initDrag() {
  ul.pending.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.button !== 0 || e.target.closest('button,input')) return;
    if (row._raf) { cancelAnimationFrame(row._raf); row._raf = null; }

    const group = [...ul.pending.children].filter((r) => r.dataset.p === row.dataset.p);
    const idx = group.indexOf(row);
    const h = row.offsetHeight;
    const tops = group.map((r) => r.offsetTop);
    const minDy = tops[0] - tops[idx];
    const maxDy = tops.at(-1) - tops[idx];
    const startY = e.clientY;
    let dragging = false;
    let vis = 0;
    const hist = [];
    row.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 8) return; // margen para no confundir un clic con un arrastre
        dragging = true;
        row.classList.add('lifted');
        document.body.classList.add('is-dragging');
        group.forEach((r) => r !== row && r.classList.add('shifting'));
      }
      hist.push({ y: ev.clientY, t: ev.timeStamp });
      while (hist.length > 2 && ev.timeStamp - hist[0].t > 90) hist.shift();
      vis = dy < minDy ? minDy - rubberband(minDy - dy, h * 2) : dy > maxDy ? maxDy + rubberband(dy - maxDy, h * 2) : dy;
      row.style.transform = `translateY(${vis}px)`;
      const target = Math.max(0, Math.min(group.length - 1, Math.round(idx + vis / h)));
      group.forEach((r, i) => {
        if (r === row) return;
        const s = i > idx && i <= target ? -h : i < idx && i >= target ? h : 0;
        r.style.transform = s ? `translateY(${s}px)` : '';
      });
    };

    const up = () => {
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
      if (!dragging) {
        // Ha sido un clic: esta pasa a ser la tarea en curso.
        S.setCurrent(row.dataset.id);
        S.commit();
        return;
      }
      const a = hist[0], b = hist.at(-1);
      const v = a && b && b.t > a.t ? (b.y - a.y) / ((b.t - a.t) / 1000) : 0;
      const land = Math.max(0, Math.min(group.length - 1, Math.round(idx + (vis + project(v)) / h)));
      row.classList.remove('lifted');
      document.body.classList.remove('is-dragging');
      const ids = group.map((r) => r.dataset.id);
      ids.splice(idx, 1);
      ids.splice(land, 0, row.dataset.id);
      S.setOrder(ids);
      S.commit({ el: row, velocity: v });
    };

    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
  });
}

export { PRIO };
