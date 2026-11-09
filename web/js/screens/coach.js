// Coach chat: ask the AI coach anything about food, fitness, sleep and habits.

import { get, post } from '../api.js';
import { h, mount, icon, markdown, disclaimer, toast } from '../ui.js';

const SUGGESTIONS = [
  'How can I get more protein as a vegan?',
  'Give me a 20-minute home workout',
  'How do I sleep better?',
  'Healthy snacks for evening hunger?',
  'How am I doing this week?',
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
  const quotaEl = h('span', { class: 'faint' });
  const paintQuota = () => { quotaEl.textContent = quota.limit ? `${quota.left} of ${quota.limit} messages left today` : 'Chat is off'; };

  const bubble = (m) => m.role === 'user'
    ? h('div', { class: 'bubble user' }, m.content)
    : h('div', { class: 'bubble coach' }, markdown(m.content));

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

  const scrollDown = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    if (quota.left <= 0) { toast(quota.limit ? "You've used today's coach messages. Chat resets at midnight." : 'Chat is turned off.', { error: true }); return; }
    busy = true;
    sendBtn.disabled = true;
    emptyEl?.remove();
    list.appendChild(bubble({ role: 'user', content: message }));
    const typing = h('div', { class: 'bubble coach typing', 'aria-label': 'Coach is typing' }, h('i'), h('i'), h('i'));
    list.appendChild(typing);
    input.value = ''; autosize();
    scrollDown();
    try {
      const res = await post('/api/chat', { message });
      typing.replaceWith(bubble(res.messages[1]));
      quota = res.quota; paintQuota();
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

  let emptyEl = null;
  if (!data.messages.length) {
    emptyEl = h('div', { class: 'card stack-sm' },
      h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'big-icon' }, icon('sparkle')),
        h('div', null, h('h2', null, 'Your PAL coach'),
          h('p', { class: 'muted small' }, 'I know your goal, plan and recent days. Ask me anything about food, workouts, sleep or habits.'))),
      h('div', { class: 'chips mt-8' }, SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'chip sm', onclick: () => send(s) }, s))));
  } else {
    data.messages.forEach((m) => list.appendChild(bubble(m)));
  }

  paintQuota();
  mount(view, h('div', { class: 'stack' },
    h('div', { class: 'spread' }, h('h1', { class: 'page-title' }, 'Coach'), quotaEl),
    emptyEl, list, form, disclaimer()));
  if (data.messages.length) scrollDown();
}
