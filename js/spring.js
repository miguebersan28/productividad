// spring.js — física de muelle para el movimiento.
// Una animación CSS normal tiene duración fija: si la interrumpes, salta o se reinicia.
// Un muelle no: en cada fotograma calcula la fuerza que tira hacia el destino y la que frena,
// así que siempre parte de donde está y conserva la velocidad que traía.

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Mueve `el` en vertical desde `from` hasta `to` (px).
 * response: lo rápido que llega (s). damping: 1 = sin rebote (lo que usa Apple por defecto).
 * v0: velocidad inicial en px/s (la del ratón al soltar).
 */
export function spring(el, from, to, v0 = 0, { response = 0.38, damping = 1 } = {}) {
  if (el._raf) cancelAnimationFrame(el._raf);
  if (reduceMotion.matches) { el.style.transform = ''; return; }
  const w = (2 * Math.PI) / response; // frecuencia del muelle
  let x = from - to; // distancia que falta
  let v = v0;
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min((t - last) / 1000, 0.064);
    last = t;
    // Pasos pequeños para que la simulación sea estable aunque el navegador vaya a tirones.
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -w * w * x - 2 * damping * w * v; // fuerza del muelle + rozamiento
      v += a * h;
      x += v * h;
    }
    if (Math.abs(x) < 0.25 && Math.abs(v) < 4) { el.style.transform = ''; el._raf = null; return; }
    el.style.transform = `translateY(${to + x}px)`;
    el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/**
 * FLIP (First, Last, Invert, Play): apuntamos dónde está cada fila, cambiamos el DOM de golpe,
 * y cada fila viaja con un muelle desde donde estaba hasta su sitio nuevo.
 */
export function flip(mutate, { el = null, velocity = 0 } = {}) {
  const rows = [...document.querySelectorAll('.row')];
  const first = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
  rows.forEach((r) => {
    if (r._raf) { cancelAnimationFrame(r._raf); r._raf = null; }
    r.classList.remove('shifting');
    r.style.transform = '';
  });
  mutate();
  rows.forEach((r) => {
    if (!r.isConnected || !first.has(r) || !r.offsetParent) return;
    const d = first.get(r) - r.getBoundingClientRect().top;
    if (Math.abs(d) > 0.5) spring(r, d, 0, r === el ? velocity : 0);
  });
}

/** Resistencia elástica: cuanto más te pasas del borde, menos se mueve. */
export const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

/** Dónde acabaría algo lanzado a velocidad v (px/s), igual que el scroll del iPhone. */
export const project = (v, decel = 0.99) => ((v / 1000) * decel) / (1 - decel);
