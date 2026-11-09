// Public configuration only — never put secrets here (this file is public).

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const IS_LOCAL = isLocal;

// Where the API (Cloudflare Worker) lives.
export const API_BASE = isLocal
  ? `http://${location.hostname}:8787`
  : 'https://pal-fit-api.omkarwebsitetest.workers.dev';

// Google Sign-In client id (public by design). Kept here so the login button
// can appear instantly without asking the server first.
export const GOOGLE_CLIENT_ID = '504987242612-t8minvuvrmtnv7uv00aud3mg8nfdtju1.apps.googleusercontent.com';

export const APP_NAME = 'PAL Fitness';

// The app's own public link (used in WhatsApp reminders).
export const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
