// Admin tools: members, challenges, AI keys & models, re-grade, export, usage, audit.

import { api, get, put, post, patch, del } from '../api.js';
import { h, mount, icon, avatar, segmented, field, toast, loadingView, errorView, fmtDate, spinner } from '../ui.js';

let tab = 'ai';

export async function renderAdmin(view) {
  const body = h('div', { class: 'stack' });
  mount(view, h('div', { class: 'stack' },
    h('h1', { class: 'page-title' }, 'Admin'),
    segmented([
      { value: 'ai', label: 'AI & keys' },
      { value: 'members', label: 'Members' },
      { value: 'challenges', label: 'Challenges' },
      { value: 'tools', label: 'Tools' },
    ], tab, (v) => { tab = v; load(); }),
    body));

  async function load() {
    mount(body, loadingView());
    try {
      if (tab === 'ai') await aiTab(body);
      else {
        const data = await get('/api/admin/overview');
        if (tab === 'members') membersTab(body, data, load);
        else if (tab === 'challenges') challengesTab(body, data, load);
        else toolsTab(body, data);
      }
    } catch (e) {
      mount(body, errorView(e, load));
    }
  }
  await load();
}

// ------------------------------------------------------------------ AI & keys
async function aiTab(body) {
  const { settings, settingsKeyConfigured } = await get('/api/admin/settings');

  const settingCard = (s) => {
    const status = h('div', { class: 'faint' });
    let control, getValue;
    if (s.secret) {
      status.append(s.status === 'set' ? h('span', { class: 'ok' }, `✓ Set ${s.hint || ''}`) : h('span', { class: 'bad' }, 'Not set'),
        s.source && s.status === 'set' ? ` · from ${s.source}` : '');
      control = h('input', { class: 'input code', type: 'password', autocomplete: 'off', placeholder: s.status === 'set' ? 'Paste a new value to replace' : 'Paste here' });
      getValue = () => control.value.trim();
    } else if (s.type === 'json') {
      control = h('textarea', { class: 'input code', rows: Math.min(10, (s.value?.length || 3) + 2), spellcheck: 'false' });
      control.value = JSON.stringify(s.value, null, 1);
      getValue = () => control.value;
      status.append(`Source: ${s.source}`);
    } else {
      control = h('input', { class: 'input', type: 'number', min: s.min, max: s.max, value: s.value ?? '' });
      getValue = () => control.value;
      status.append(`Source: ${s.source} · ${s.min}–${s.max}`);
    }
    const save = h('button', { class: 'btn sm' }, 'Save');
    const reset = h('button', { class: 'btn sm secondary' }, s.secret ? 'Remove' : 'Reset to default');
    save.addEventListener('click', async () => {
      const v = getValue();
      if (s.secret && !v) { control.focus(); return; }
      save.disabled = true;
      try { await put(`/api/admin/settings/${s.key}`, { value: v }); toast('Saved'); await aiTab(body); }
      catch (e) { toast(e.message, { error: true }); save.disabled = false; }
    });
    reset.addEventListener('click', async () => {
      if (!confirm(s.secret ? `Remove the saved ${s.label}?` : `Reset ${s.label} to the default?`)) return;
      try { await put(`/api/admin/settings/${s.key}`, { value: null }); toast('Done'); await aiTab(body); }
      catch (e) { toast(e.message, { error: true }); }
    });
    return h('div', { class: 'card stack-sm' },
      h('div', { class: 'spread' }, h('h3', null, s.label)), h('p', { class: 'help' }, s.help), status, control,
      h('div', { class: 'row-wrap' }, save, reset));
  };

  const testOut = h('div');
  const testBtn = (chain, label) => h('button', {
    class: 'btn secondary sm', onclick: async () => {
      mount(testOut, h('div', { class: 'row muted' }, spinner(true), 'Testing each model (can take ~30 s)…'));
      try {
        const r = await post('/api/admin/ai/test', { chain });
        mount(testOut, h('div', { class: 'table-wrap' }, h('table', { class: 'simple' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Provider'), h('th', null, 'Model'), h('th', null, 'Time'), h('th', null, 'Result'))),
          h('tbody', null, r.results.map((x) => h('tr', null,
            h('td', null, x.ok ? '✅' : '❌'), h('td', null, x.provider), h('td', { class: 'code' }, x.model),
            h('td', null, `${(x.ms / 1000).toFixed(1)} s`),
            h('td', { style: 'white-space:normal;min-width:180px' }, x.ok ? x.sample : x.error)))))));
      } catch (e) { mount(testOut, h('p', { class: 'error-text' }, e.message)); }
    },
  }, label);

  const modelsOut = h('div');
  const modelsBtn = h('button', {
    class: 'btn secondary sm', onclick: async () => {
      mount(modelsOut, spinner(true));
      try {
        const { models } = await get('/api/admin/ai/gemini-models');
        mount(modelsOut, h('div', { class: 'table-wrap' }, h('table', { class: 'simple' },
          h('tbody', null, models.map((m) => h('tr', null, h('td', { class: 'code' }, m.id), h('td', null, m.name)))))));
      } catch (e) { mount(modelsOut, h('p', { class: 'error-text' }, e.message)); }
    },
  }, 'List Gemini models for my key');

  mount(body,
    !settingsKeyConfigured && h('div', { class: 'banner warn' }, icon('info'), h('div', { class: 'small' },
      h('b', null, 'SETTINGS_KEY is not set on the Worker. '), 'Secrets can\'t be saved from here until it is (see README).')),
    h('div', { class: 'banner' }, icon('key'), h('div', { class: 'small' },
      'API keys are encrypted before they are stored and are never shown again — only the last 4 characters.')),
    h('div', { class: 'card stack-sm' },
      h('h3', null, 'Check the AI'),
      h('p', { class: 'help' }, 'Runs a tiny request on every model in a chain and shows which ones work right now.'),
      h('div', { class: 'row-wrap' }, testBtn('grade', 'Test grading chain'), testBtn('chat', 'Test chat chain'), modelsBtn),
      testOut, modelsOut),
    ...settings.map(settingCard));
}

// ------------------------------------------------------------------ members
function membersTab(body, data, reload) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // --- add someone by email
  const email = h('input', { class: 'input', type: 'email', placeholder: 'friend@gmail.com', autocomplete: 'off', 'aria-label': 'Email' });
  let role = 'member';
  const roleSeg = segmented([{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }], role, (v) => { role = v; });
  const addBtn = h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Add');
  const addForm = h('form', { class: 'card stack-sm' },
    h('h3', null, 'Add a member'),
    h('p', { class: 'help' }, 'Anyone can join by signing in with Google. Add an email here to give someone admin access in advance, or to change an existing member\'s role.'),
    h('div', { class: 'input-row' }, email, addBtn),
    roleSeg);
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.value.trim()) return email.focus();
    addBtn.disabled = true;
    try {
      const r = await post('/api/admin/members', { email: email.value, role });
      toast(r.status === 'updated' ? `${r.name} is now ${role === 'admin' ? 'an admin' : 'a member'}`
        : `Added. They'll get ${role} access when they first sign in.`);
      reload();
    } catch (err) { toast(err.message, { error: true }); addBtn.disabled = false; }
  });

  // --- pending (added, not signed in yet)
  const pending = (data.invites || []).map((i) => h('div', { class: 'list-row' },
    h('span', { class: 'avatar' }, icon('user')),
    h('div', { class: 'grow', style: 'min-width:0' },
      h('div', { style: 'overflow-wrap:anywhere' }, h('b', null, i.email), ' ', h('span', { class: 'tag' + (i.role === 'admin' ? ' ink' : '') }, i.role === 'admin' ? 'Admin' : 'Member')),
      h('div', { class: 'faint' }, `Added ${fmtDate(i.created_at.slice(0, 10))} · hasn't signed in yet`)),
    h('button', {
      class: 'icon-btn', 'aria-label': 'Remove', onclick: async () => {
        if (!confirm(`Remove ${i.email} from the pending list?`)) return;
        try { await del(`/api/admin/members/${encodeURIComponent(i.email)}`); reload(); }
        catch (err) { toast(err.message, { error: true }); }
      },
    }, icon('x'))));

  // --- current members
  const rows = data.users.map((u) => {
    const actions = u.owner
      ? h('p', { class: 'faint' }, 'Owner account — always an admin. It can\'t be removed or deactivated.')
      : h('div', { class: 'row-wrap' },
        h('button', {
          class: 'btn sm secondary', onclick: async () => {
            const newRole = u.role === 'admin' ? 'member' : 'admin';
            if (!confirm(`Make ${u.display_name} ${newRole === 'admin' ? 'an admin' : 'a regular member'}?`)) return;
            try { await patch(`/api/admin/users/${u.id}`, { role: newRole }); toast('Updated'); reload(); }
            catch (e) { toast(e.message, { error: true }); }
          },
        }, u.role === 'admin' ? 'Remove admin' : 'Make admin'),
        h('button', {
          class: 'btn sm ' + (u.active ? 'danger' : ''), onclick: async () => {
            if (!confirm(`${u.active ? 'Deactivate' : 'Re-activate'} ${u.display_name}?`)) return;
            try { await patch(`/api/admin/users/${u.id}`, { active: !u.active }); toast('Updated'); reload(); }
            catch (e) { toast(e.message, { error: true }); }
          },
        }, u.active ? 'Deactivate' : 'Activate'));
    return h('div', { class: 'list-row', style: 'align-items:flex-start' },
      avatar(u.display_name, u.photo_url, '', u.active ? '' : 'dim'),
      h('div', { class: 'grow stack-sm', style: 'min-width:0' },
        h('div', null, h('b', null, u.display_name), ' ',
          u.owner ? h('span', { class: 'tag ink' }, 'Owner') : u.role === 'admin' && h('span', { class: 'tag ink' }, 'Admin'), ' ',
          !u.active && h('span', { class: 'tag' }, 'Inactive'), ' ',
          !u.ai_enabled && h('span', { class: 'tag' }, 'AI off')),
        h('div', { class: 'faint', style: 'overflow-wrap:anywhere' }, u.email),
        h('div', { class: 'faint' }, `${plural(u.days_logged, 'day')} logged · last log ${u.last_log ? fmtDate(u.last_log) : 'never'} · joined ${fmtDate(u.created_at.slice(0, 10))}`),
        actions));
  });

  const active = data.users.filter((u) => u.active).length;
  const admins = data.users.filter((u) => u.role === 'admin').length;
  mount(body,
    addForm,
    pending.length ? h('div', { class: 'card' }, h('h3', null, `Waiting to sign in (${pending.length})`), pending) : null,
    h('p', { class: 'muted small' }, `${plural(active, 'active member')} · ${plural(admins, 'admin')}`),
    h('div', { class: 'card' }, rows.length ? rows : h('p', null, 'No members yet.')));
}

// ------------------------------------------------------------------ challenges
function challengesTab(body, data, reload) {
  const today = data.today;
  const monthStart = today.slice(0, 8) + '01';
  const d = new Date(Date.parse(monthStart + 'T00:00:00Z'));
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  const monthEnd = d.toISOString().slice(0, 10);
  const monthName = new Date(monthStart + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const name = h('input', { class: 'input', maxlength: 60, value: `${monthName} Challenge` });
  const start = h('input', { class: 'input', type: 'date', value: today < monthEnd ? today : monthStart });
  const end = h('input', { class: 'input', type: 'date', value: monthEnd });
  const form = h('form', { class: 'card stack' },
    h('h3', null, 'New challenge'),
    field('Name', name),
    h('div', { class: 'form-grid' }, field('Start', start), field('End', end)),
    h('p', { class: 'help' }, 'Creating a challenge makes it the active one. The leaderboard\'s "Challenge" view uses its dates.'),
    h('button', { class: 'btn block', type: 'submit' }, icon('plus'), 'Create & activate'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/api/admin/challenges', { name: name.value, startDate: start.value, endDate: end.value }); toast('Challenge created'); reload(); }
    catch (err) { toast(err.message, { error: true }); }
  });

  const list = data.challenges.map((c) => h('div', { class: 'list-row' },
    h('div', { class: 'grow' },
      h('b', null, c.name), ' ', c.active ? h('span', { class: 'tag good' }, 'Active') : null,
      h('div', { class: 'faint' }, `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`)),
    h('button', {
      class: 'btn sm secondary', onclick: async () => {
        try { await patch(`/api/admin/challenges/${c.id}`, { active: !c.active }); reload(); }
        catch (err) { toast(err.message, { error: true }); }
      },
    }, c.active ? 'Deactivate' : 'Activate'),
    h('button', {
      class: 'icon-btn', 'aria-label': 'Delete', onclick: async () => {
        if (!confirm(`Delete "${c.name}"? Logs are kept.`)) return;
        try { await del(`/api/admin/challenges/${c.id}`); reload(); }
        catch (err) { toast(err.message, { error: true }); }
      },
    }, icon('x'))));

  mount(body, form, h('div', { class: 'card' }, h('h3', null, 'All challenges'),
    list.length ? list : h('p', { class: 'muted mt-8' }, 'None yet — the leaderboard uses the current month until you create one.')));
}

// ------------------------------------------------------------------ tools
function toolsTab(body, data) {
  const exportBtn = h('button', { class: 'btn block' }, icon('download'), 'Download all logs (CSV)');
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const res = await api('GET', '/api/admin/export.csv', undefined, { raw: true });
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: `pal-fitness-logs-${data.today}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast(e.message, { error: true }); }
    exportBtn.disabled = false;
  });

  const yesterday = new Date(Date.parse(data.today + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);
  const date = h('input', { class: 'input', type: 'date', max: data.today, value: yesterday });
  const gradeOut = h('div');
  const gradeBtn = h('button', { class: 'btn secondary' }, 'Re-grade');
  gradeBtn.addEventListener('click', async () => {
    if (!confirm(`Ask the AI to re-grade every log on ${date.value}? Uses AI quota.`)) return;
    gradeBtn.disabled = true;
    mount(gradeOut, h('div', { class: 'row muted' }, spinner(true), 'Grading… (up to a minute)'));
    try {
      const r = await post(`/api/admin/grade?date=${date.value}`);
      const counts = {};
      for (const s of r.summary) counts[s.status] = (counts[s.status] || 0) + 1;
      const detail = Object.entries(counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ');
      mount(gradeOut, h('p', { class: 'ok' }, `Done: ${r.graded} log(s)${detail ? ` — ${detail}` : ''}.`));
    } catch (e) { mount(gradeOut, h('p', { class: 'error-text' }, e.message)); }
    gradeBtn.disabled = false;
  });

  const usageTable = data.aiUsage.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'simple' },
    h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', null, 'Model'), h('th', null, 'Calls'), h('th', null, 'Failed'))),
    h('tbody', null, data.aiUsage.map((u) => h('tr', null,
      h('td', null, fmtDate(u.day, { day: 'numeric', month: 'short' })), h('td', { class: 'code' }, u.provider),
      h('td', null, String(u.calls)), h('td', { class: u.failures ? 'bad' : '' }, String(u.failures))))))) : h('p', { class: 'muted' }, 'No AI calls in the last 7 days.');

  const auditList = data.audit.length ? data.audit.map((a) => h('div', { class: 'list-row small' },
    h('div', { class: 'grow' }, h('b', null, a.action), a.target ? ` · ${a.target.length > 20 ? a.target.slice(0, 8) + '…' : a.target}` : '',
      h('div', { class: 'faint' }, `${a.admin} · ${a.created_at} UTC`)))) : h('p', { class: 'muted' }, 'No admin actions yet.');

  mount(body,
    h('div', { class: 'card stack-sm' }, h('h3', null, 'Export'), h('p', { class: 'help' }, 'Every log from everyone, for backups or Excel.'), exportBtn),
    h('div', { class: 'card stack-sm' }, h('h3', null, 'Re-grade a day'),
      h('p', { class: 'help' }, 'Use if the AI was down and scores came from the simple rules.'),
      h('div', { class: 'input-row' }, date, gradeBtn), gradeOut),
    h('div', { class: 'card stack-sm' }, h('h3', null, 'AI usage (last 7 days)'), usageTable),
    h('div', { class: 'card stack-sm' }, h('h3', null, 'Recent admin actions'), auditList));
}
