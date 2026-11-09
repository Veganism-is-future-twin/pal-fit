// Small, dependency-free SVG charts. Everything is drawn at the real on-screen
// width so text stays crisp and readable on phones, tablets and laptops.
// Colours come from CSS variables, so charts follow light/dark mode.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

const fmtAxis = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k`.replace('.0k', 'k') : String(Math.round(v * 10) / 10));

/** Indices of x-labels to show so they never overlap (at least `minGap` px apart). */
function labelIndices(count, x, minGap = 64) {
  const idx = [0];
  for (let i = 1; i < count; i++) {
    if (x(i) - x(idx[idx.length - 1]) >= minGap) idx.push(i);
  }
  const last = count - 1;
  if (idx[idx.length - 1] !== last) {
    if (x(last) - x(idx[idx.length - 1]) < minGap) idx.pop();   // too close: drop the previous one
    idx.push(last);
  }
  return idx;
}

/**
 * Line chart with gaps for missing days and an optional dashed target line.
 *   lineChart({ labels, values, color, min, max, unit, target, width, height })
 */
export function lineChart({ labels, values, color = 'var(--ink)', min, max, unit = '', target = null, height = 190, width }) {
  const W = Math.max(280, Math.round(width || 360)), H = height;
  const padL = 38, padR = 14, padT = 14, padB = 26;
  const nums = values.filter((v) => v != null);
  const lo = min ?? Math.min(0, ...nums);
  // Round the top of the axis up to a "nice" number so ticks are tidy.
  const rawHi = max ?? Math.max(1, target || 0, ...nums) * 1.1;
  const step = Math.pow(10, Math.floor(Math.log10(rawHi || 1)));
  const hi = max ?? Math.ceil(rawHi / (step / 2)) * (step / 2);
  const n = Math.max(1, values.length - 1);
  const x = (i) => padL + (i / n) * (W - padL - padR);
  const y = (v) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - padT - padB);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Line chart' });

  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    svg.appendChild(el('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, fmtAxis(v)));
  }
  for (const i of labelIndices(labels.length, x)) {
    svg.appendChild(el('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle', class: 'axis' }, labels[i]));
  }

  if (target != null) {
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(target), y2: y(target), class: 'target-line' }));
    svg.appendChild(el('text', { x: W - padR, y: y(target) - 5, 'text-anchor': 'end', class: 'axis target-label' }, `Target ${fmtAxis(target)}${unit}`));
  }

  let d = '', area = '', open = false;
  values.forEach((v, i) => {
    if (v == null) { if (open) { area += `L${x(i - 1)},${y(lo)}Z`; open = false; } return; }
    if (!open) { d += `M${x(i)},${y(v)}`; area += `M${x(i)},${y(lo)}L${x(i)},${y(v)}`; open = true; }
    else { d += `L${x(i)},${y(v)}`; area += `L${x(i)},${y(v)}`; }
  });
  if (open) area += `L${x(values.length - 1)},${y(lo)}Z`;
  if (area) svg.appendChild(el('path', { d: area, class: 'area', fill: color }));
  if (d) svg.appendChild(el('path', { d, class: 'line', stroke: color }));
  values.forEach((v, i) => {
    if (v == null) return;
    const c = el('circle', { cx: x(i), cy: y(v), r: nums.length > 20 ? 3 : 4, class: 'dot', fill: color });
    c.appendChild(el('title', {}, `${labels[i]}: ${v}${unit}`));
    svg.appendChild(c);
  });
  if (!nums.length) {
    svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis empty-label' }, 'No data yet'));
  }
  return svg;
}

/**
 * Vertical bar chart (e.g. last 7 days' scores). Values may be null (= no log).
 *   barChart({ labels, values, max, colorFor(v), width, height, valueLabels })
 */
export function barChart({ labels, values, max = 100, colorFor = () => 'var(--ink)', width, height = 170, valueLabels = true }) {
  const W = Math.max(260, Math.round(width || 340)), H = height;
  const padT = 20, padB = 24, padX = 4;
  const slot = (W - padX * 2) / values.length;
  const barW = Math.min(36, slot * 0.6);
  const plotH = H - padT - padB;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Bar chart' });

  svg.appendChild(el('line', { x1: padX, x2: W - padX, y1: padT + plotH, y2: padT + plotH, class: 'grid' }));
  values.forEach((v, i) => {
    const cx = padX + slot * i + slot / 2;
    if (v == null) {
      // Missing day: a faint stub so the gap is visible.
      svg.appendChild(el('rect', { x: cx - barW / 2, y: padT + plotH - 4, width: barW, height: 4, rx: 2, class: 'bar-empty' }));
    } else {
      const h = Math.max(4, (Math.min(max, v) / max) * plotH);
      const r = el('rect', { x: cx - barW / 2, y: padT + plotH - h, width: barW, height: h, rx: Math.min(6, barW / 3), fill: colorFor(v) });
      r.appendChild(el('title', {}, `${labels[i]}: ${v}`));
      svg.appendChild(r);
      if (valueLabels) svg.appendChild(el('text', { x: cx, y: padT + plotH - h - 6, 'text-anchor': 'middle', class: 'axis bar-value' }, String(v)));
    }
    svg.appendChild(el('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, labels[i]));
  });
  return svg;
}

/**
 * Horizontal progress bars vs targets (HTML, not SVG).
 *   progressBars([{ label, value, target, unit, color, format }])
 */
export function progressBars(items) {
  const wrap = document.createElement('div');
  wrap.className = 'pbars';
  for (const it of items) {
    const pct = it.target ? Math.min(100, Math.round(((it.value || 0) / it.target) * 100)) : 0;
    const row = document.createElement('div');
    row.className = 'pbar';
    const head = document.createElement('div');
    head.className = 'pbar-head';
    const name = document.createElement('span');
    name.textContent = it.label;
    const val = document.createElement('span');
    val.className = 'num';
    const f = it.format || ((v) => String(v));
    val.textContent = `${it.value == null ? '–' : f(it.value)} / ${f(it.target)}${it.unit || ''}`;
    head.append(name, val);
    const track = document.createElement('div');
    track.className = 'pbar-track';
    const fill = document.createElement('div');
    fill.className = 'pbar-fill';
    fill.style.width = pct + '%';
    fill.style.background = it.color || 'var(--ink)';
    track.appendChild(fill);
    row.append(head, track);
    if (pct >= 100) row.classList.add('done');
    wrap.appendChild(row);
  }
  return wrap;
}
