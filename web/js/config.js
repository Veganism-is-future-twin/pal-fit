// Public configuration only — never put secrets here (this file is public).

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

// Where the API (Cloudflare Worker) lives.
export const API_BASE = isLocal
  ? `http://${location.hostname}:8787`
  : 'https://pal-fit-api.omkarwebsitetest.workers.dev';

export const APP_NAME = 'PAL Fitness';

// The app's own public link (used in WhatsApp reminders).
export const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
