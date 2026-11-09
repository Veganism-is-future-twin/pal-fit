// First sign-in: confirm name + AI coach choice, then the profile form (skippable).

import { patch } from '../api.js';
import { state, refreshMe } from '../store.js';
import { h, mount, avatar, field, switchField, toast } from '../ui.js';
import { profileForm } from './profile-form.js';

export async function renderOnboarding(view, { done }) {
  const user = state.me.user;
  let aiEnabled = user.aiEnabled;

  const finishLater = () => done();

  function step1() {
    const name = h('input', { class: 'input', maxlength: 40, value: user.displayName, autocomplete: 'nickname' });
    const err = h('div', { class: 'error-text' });
    const form = h('form', { class: 'stack' },
      h('div', { class: 'center stack-sm' },
        h('div', { style: 'display:flex;justify-content:center' }, h('img', { src: 'icons/pal-logo.png', alt: '', class: 'logo', style: 'width:88px;height:88px' })),
        h('h1', null, 'Welcome to PAL Fitness'),
        h('p', { class: 'muted' }, "Let's set you up — it takes a minute.")),
      h('div', { class: 'card stack' },
        field('What should the group call you?', name, 'Shown on the leaderboard.'),
        switchField('Use the AI coach', aiEnabled, (v) => { aiEnabled = v; },
          'Gives you a personal score, feedback, a plan and coach chat. Your entries (never your name or email) are sent to AI services.')),
      err,
      h('button', { class: 'btn block lg', type: 'submit' }, 'Continue'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await patch('/api/me', { displayName: name.value, aiEnabled });
        await refreshMe();
        step2();
      } catch (e2) { err.textContent = e2.message; }
    });
    mount(view, h('div', { class: 'stack', style: 'max-width:520px;margin:0 auto;padding-top:16px' }, form));
  }

  function step2() {
    mount(view, h('div', { class: 'stack', style: 'max-width:560px;margin:0 auto;padding-top:16px' },
      h('div', { class: 'stack-sm' },
        h('h1', null, 'About you'),
        h('p', { class: 'muted' }, 'This lets the coach set targets and judge your day against YOUR goal. Fill what you like — you can change it anytime.')),
      h('div', { class: 'card' }, profileForm(state.me.profile, {
        submitLabel: 'Save & start',
        onSaved: async () => {
          await refreshMe();
          toast('Your personal plan is being prepared');
          done();
        },
      })),
      h('button', { class: 'btn ghost block', onclick: finishLater }, 'Skip for now')));
  }

  step1();
}
