// ui.js — piezas pequeñas reutilizables: avisos (toast) y controles segmentados.

const toastEl = document.getElementById('toast');
let toastTimer = null;
let toastAction = null;

/** Aviso abajo a la derecha, con un botón opcional (p. ej. "Deshacer"). */
export function toast(msg, actionLabel, onAction, ms = 6000) {
  toastEl.querySelector('.msg').textContent = msg;
  const btn = toastEl.querySelector('button');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  toastAction = onAction || null;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() {
  toastEl.classList.remove('show');
  toastAction = null;
}
toastEl.querySelector('button').addEventListener('click', () => {
  const fn = toastAction;
  hideToast();
  fn?.();
});

/** Control segmentado tipo iOS. onChange recibe el índice elegido. */
export function segmented(seg, onChange) {
  const btns = [...seg.querySelectorAll('button')];
  btns.forEach((b, i) => b.addEventListener('click', (e) => {
    e.preventDefault();
    setSegment(seg, i);
    onChange?.(i);
  }));
}
export function setSegment(seg, i) {
  const btns = [...seg.querySelectorAll('button')];
  btns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', j === i); });
  seg.style.setProperty('--i', i);
}
