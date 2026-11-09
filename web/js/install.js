// "Install the app" support for Android, iPhone/iPad, Windows/Mac/Linux.

import { h, icon, toast } from './ui.js';

let deferredPrompt = null;
const listeners = new Set();

// Chrome / Edge / Samsung Internet fire this when the app can be installed.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  toast('PAL Fitness installed');
  listeners.forEach((fn) => fn());
});

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const canPrompt = () => !!deferredPrompt;

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

/** Step-by-step instructions for when there is no install button. */
function manualSteps() {
  const p = platform();
  if (p === 'ios') {
    return h('ol', { class: 'steps-list' },
      h('li', null, 'Open this page in ', h('b', null, 'Safari'), '.'),
      h('li', null, 'Tap the ', h('b', null, 'Share'), ' button (square with an arrow ↑).'),
      h('li', null, 'Scroll and tap ', h('b', null, 'Add to Home Screen'), ', then ', h('b', null, 'Add'), '.'));
  }
  if (p === 'android') {
    return h('ol', { class: 'steps-list' },
      h('li', null, 'Open this page in ', h('b', null, 'Chrome'), '.'),
      h('li', null, 'Tap the ', h('b', null, '⋮'), ' menu (top right).'),
      h('li', null, 'Tap ', h('b', null, 'Add to Home screen'), ' or ', h('b', null, 'Install app'), '.'));
  }
  return h('ol', { class: 'steps-list' },
    h('li', null, 'Use ', h('b', null, 'Chrome'), ' or ', h('b', null, 'Edge'), '.'),
    h('li', null, 'Click the install icon (⊕) at the right end of the address bar, or open the browser menu → ',
      h('b', null, 'Install PAL Fitness'), '.'));
}

/** A self-updating install card for the Profile screen. */
export function installCard() {
  const box = h('div', { class: 'card' });
  const render = () => {
    box.replaceChildren(
      h('div', { class: 'card-title' }, icon('phone'), h('h2', null, 'Get the app')),
    );
    if (isStandalone()) {
      box.appendChild(h('p', { class: 'muted' }, 'You are using the installed app.'));
    } else if (canPrompt()) {
      box.append(
        h('p', { class: 'muted' }, 'Install PAL Fitness on this device: opens full-screen from your home screen, like a normal app.'),
        h('button', { class: 'btn block mt-16', onclick: () => promptInstall() }, icon('download'), 'Install app'));
    } else {
      box.append(
        h('p', { class: 'muted' }, 'Add PAL Fitness to your home screen so it opens like a normal app:'),
        h('div', { class: 'mt-8' }, manualSteps()));
    }
  };
  render();
  listeners.add(render);
  return box;
}

/** Small dismissible banner for Home (only shown if not installed). */
export function installBanner(onDismiss) {
  if (isStandalone()) return null;
  return h('div', { class: 'banner' },
    icon('phone'),
    h('div', { class: 'grow' },
      h('b', null, 'Install PAL Fitness'),
      h('div', { class: 'small muted' },
        canPrompt() ? 'One tap to add it to your home screen.' : 'Add it to your home screen — see Profile → Get the app.'),
      canPrompt() && h('button', { class: 'btn sm mt-8', onclick: () => promptInstall() }, 'Install')),
    h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: onDismiss }, icon('x')));
}
