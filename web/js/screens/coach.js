// Coach chat: a clean, full-height chat. Messages scroll; the composer stays at the bottom.

import { get, post } from '../api.js';
import { h, mount, icon, markdown, toast } from '../ui.js';

const SUGGESTIONS = [
  'How can I get more protein as a vegan?',
  'Give me a 20-minute home workout',
  'How do I sleep better?',
  'Healthy snacks for evening hunger?',
  'How am I doing this week?',
  'Plan my meals for tomorrow',
];

export async function renderCoach(view, { go }) {
  const data = await get('/api/chat');

  if (!data.aiEnabled) {
    mount(view, h('div', { class: 'card empty' },
      h('div', { class: 'empty-icon' }, icon('sparkle')),
      h('h2', null, 'The AI coach is off'),
      h('p', { class: 'muted mt-8' }, 'Turn it on in your Profile to chat with the coach and get personal feedback.'),
      h('button', { class: 'btn mt-16', onclick: () => go('profile') }, 'Go to Profile')));
    return;
  }

  let quota = data.quota;
  let busy = false;

  const list = h('div', { class: 'chat', 'aria-live': 'polite' });
  const meta = h('div', { class: 'chat-meta' });
  const paintMeta = () => {
    meta.textContent = (quota.limit ? `${quota.left} of ${quota.limit} messages left today` : 'Chat is turned off')
      + ' · General guidance, not medical advice';
  };

  const bubble = (m) => m.role === 'user'
    ? h('div', { class: 'msg user' }, h('div', { class: 'bubble user' }, m.content))
    : h('div', { class: 'msg coach' },
      h('div', { class: 'coach-avatar', 'aria-hidden': 'true' }, icon('sparkle')),
      h('div', { class: 'bubble coach' }, markdown(m.content)));

  const input = h('textarea', {
    rows: 1, placeholder: 'Ask your coach…', maxlength: 600, 'aria-label': 'Message', enterkeyhint: 'send',
  });
  const sendBtn = h('button', { class: 'btn', type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const form = h('form', { class: 'composer' }, input, sendBtn);

  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    // Enter sends on laptops; on phones Enter adds a new line.
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); form.requestSubmit(); }
  });

  const scrollDown = (smooth = true) => requestAnimationFrame(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));

  // Empty state: centred intro + suggestion cards.
  const emptyEl = h('div', { class: 'chat-empty' },
    h('div', { class: 'big-icon' }, icon('sparkle')),
    h('h2', null, 'Your PAL coach'),
    h('p', { class: 'muted small', style: 'max-width:420px' },
      'Knows your goal, targets and recent days. Ask about food, workouts, sleep or habits.'),
    h('div', { class: 'suggestions' },
      SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'suggestion', onclick: () => send(s) }, s))));

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    if (quota.left <= 0) {
      toast(quota.limit ? "You've used today's coach messages. Chat resets at midnight." : 'Chat is turned off.', { error: true });
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    emptyEl.remove();
    list.appendChild(bubble({ role: 'user', content: message }));
    const typing = h('div', { class: 'msg coach' },
      h('div', { class: 'coach-avatar', 'aria-hidden': 'true' }, icon('sparkle')),
      h('div', { class: 'bubble coach typing', 'aria-label': 'Coach is typing' }, h('i'), h('i'), h('i')));
    list.appendChild(typing);
    input.value = ''; autosize();
    scrollDown();
    try {
      const res = await post('/api/chat', { message });
      typing.replaceWith(bubble(res.messages[1]));
      quota = res.quota; paintMeta();
    } catch (e) {
      typing.remove();
      toast(e.message, { error: true });
      input.value = message;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      scrollDown();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

  data.messages.forEach((m) => list.appendChild(bubble(m)));
  paintMeta();

  mount(view, h('div', { class: 'chat-screen' },
    h('h1', { class: 'page-title' }, 'Coach'),
    h('div', { class: 'chat-body' }, data.messages.length ? null : emptyEl, list),
    h('div', { class: 'chat-footer' }, form, meta)));
  if (data.messages.length) scrollDown(false);
}
