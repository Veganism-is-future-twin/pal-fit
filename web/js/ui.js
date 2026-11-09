// Small UI toolkit. Everything builds real DOM nodes; text is always inserted
// as text (never as HTML), so user/AI content can't inject scripts.

// ---------------------------------------------------------------------------
// h(): tiny element builder
//   h('button', { class: 'btn', onclick: fn, disabled: true }, 'Save')
// ---------------------------------------------------------------------------
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;           // value, checked, disabled…
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------------------------------------------------------------------------
// Icons (static SVG paths, 24×24, stroke style)
// ---------------------------------------------------------------------------
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3',
  chat: 'M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  flame: 'M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-4 3 0-2 0-4-2-6-1 4-4 7-4 12 0 4 3 7 7 7z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  steps: 'M8 3c1.7 0 3 1.8 3 4.5S9.7 12 8 12 5 10 5 7.5 6.3 3 8 3zM5.5 14h5v2.5a2.5 2.5 0 0 1-5 0zM16 7c1.7 0 3 1.8 3 4.5S17.7 16 16 16s-3-2-3-4.5S14.3 7 16 7zM13.5 18h5v.5a2.5 2.5 0 0 1-5 0z',
  dumbbell: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  meal: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5v5h3v8',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M8 7l4-4 4 4',
  check: 'M5 12.5 10 17l9-10',
  send: 'M4 12 20 4l-6 16-3-7z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  scale: 'M5 4h14l1 16H4zM12 8a3 3 0 0 0-3 3h6a3 3 0 0 0-3-3z',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-6',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20v-3h3v-3h3l1.5-1.5',
  users: 'M16 20a6 6 0 0 0-12 0M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20a5 5 0 0 0-5-5M16 4a4 4 0 0 1 0 8',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  mood: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 9.5h.01M15 9.5h.01',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13.5 7 22l5-3 5 3-1.5-8.5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.info);
  svg.appendChild(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(message, { error = false, ms = 3200 } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' }, message);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
export function avatar(name, photoUrl, size = '', extraClass = '') {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  const fallback = () => h('span', { class: `avatar ${size} ${extraClass}`, 'aria-hidden': 'true' }, initials);
  if (!photoUrl) return fallback();
  const img = h('img', {
    class: `avatar ${size} ${extraClass}`, src: photoUrl, alt: '', loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

export function spinner(small) { return h('div', { class: 'spinner' + (small ? ' sm' : ''), role: 'status', 'aria-label': 'Loading' }); }

export function loadingView() { return h('div', { class: 'boot' }, spinner()); }

export function errorView(err, retry) {
  return h('div', { class: 'card empty' },
    h('div', { class: 'empty-icon' }, icon('info')),
    h('p', null, err?.message || 'Something went wrong.'),
    retry && h('button', { class: 'btn secondary mt-16', onclick: retry }, icon('refresh'), 'Try again'));
}

/** Toggle chip. onChange(pressed) */
export function chip(label, pressed, onChange, cls = '') {
  const b = h('button', { type: 'button', class: 'chip ' + cls, 'aria-pressed': String(!!pressed) }, label);
  b.addEventListener('click', () => {
    const now = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(now));
    onChange?.(now, b);
  });
  return b;
}

/** Single-choice chip group. options: [{value,label}] */
export function choiceChips(options, value, onChange, { allowNone = true, small = false } = {}) {
  const wrap = h('div', { class: 'chips', role: 'group' });
  let current = value;
  const buttons = options.map((o) => {
    const b = h('button', {
      type: 'button', class: 'chip' + (small ? ' sm' : ''), 'aria-pressed': String(o.value === current),
    }, o.label);
    b.addEventListener('click', () => {
      current = current === o.value && allowNone ? null : o.value;
      buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(options[i].value === current)));
      onChange(current);
    });
    return b;
  });
  wrap.append(...buttons);
  wrap.setValue = (v) => { current = v; buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(options[i].value === v))); };
  return wrap;
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'group' });
  const buttons = options.map((o) => h('button', {
    type: 'button', 'aria-pressed': String(o.value === value),
    onclick: () => {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === o.value)));
      onChange(o.value);
    },
  }, o.label));
  wrap.append(...buttons);
  return wrap;
}

export function switchField(label, checked, onChange, help) {
  const input = h('input', { type: 'checkbox', checked: !!checked, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' },
    h('span', { class: 'grow' }, h('span', { style: 'font-weight:650' }, label), help && h('div', { class: 'help' }, help)),
    input, h('span', { class: 'track', 'aria-hidden': 'true' }));
}

/** Range slider with live value. format(v) -> node/string */
export function slider({ min, max, step, value, color, format, onInput, label }) {
  const out = h('div', { class: 'range-value' });
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label || 'value' });
  const paint = () => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    if (color) input.style.setProperty('--range-color', color);
    mount(out, format(v));
  };
  input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
  paint();
  return h('div', { class: 'range-wrap' }, out, input,
    h('div', { class: 'range-scale' }, h('span', null, String(min)), h('span', null, String(max))));
}

export function scoreRing(score, { small = false, label = 'SCORE', provisional = false } = {}) {
  const p = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = p >= 75 ? 'var(--good)' : p >= 50 ? 'var(--warn)' : 'var(--danger)';
  const ring = h('div', { class: 'score-ring' + (small ? ' sm' : ''), role: 'img', 'aria-label': `Score ${score ?? 'not yet'}` },
    h('div', null, h('div', null, h('b', null, score == null ? '–' : (provisional ? '~' : '') + score), !small && h('small', null, label))));
  ring.style.setProperty('--p', p);
  ring.style.setProperty('--ring', color);
  return ring;
}

export function field(label, control, help) {
  return h('div', { class: 'field' }, h('label', null, label), control, help && h('div', { class: 'help' }, help));
}

export function disclaimer() {
  return h('p', { class: 'disclaimer' }, 'AI feedback is general wellness guidance, not medical advice.');
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const fmtInt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-IN'));

export function fmtDate(ymd, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!ymd) return '';
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-IN', opts);
}

export function greetingWord() {
  const hr = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// ---------------------------------------------------------------------------
// Safe markdown (headings, bullet lists, bold/italic, paragraphs)
// ---------------------------------------------------------------------------
function inline(text) {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    nodes.push(t.startsWith('**') ? h('strong', null, t.slice(2, -2)) : h('em', null, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function markdown(src) {
  const root = h('div', { class: 'md' });
  let list = null, para = null;
  const close = () => { list = null; para = null; };
  for (const rawLine of String(src || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { close(); continue; }
    let m;
    if ((m = /^#{1,2}\s+(.*)$/.exec(line)) && !line.startsWith('###')) { close(); root.appendChild(h('h2', null, inline(m[1]))); }
    else if ((m = /^#{3,6}\s+(.*)$/.exec(line))) { close(); root.appendChild(h('h3', null, inline(m[1]))); }
    else if ((m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
      para = null;
      if (!list) { list = h('ul'); root.appendChild(list); }
      list.appendChild(h('li', null, inline(m[1])));
    } else {
      list = null;
      if (!para) { para = h('p'); root.appendChild(para); } else para.appendChild(document.createTextNode(' '));
      append(para, inline(line));
    }
  }
  return root;
}


// Charts live in charts.js (re-exported here for convenience).
export { lineChart, barChart, progressBars } from './charts.js';
