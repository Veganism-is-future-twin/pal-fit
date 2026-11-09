# PAL Fitness (`pal-fit`)

The Pune Animal Liberation group's fitness challenge app. Log your day in under 30 seconds, get a personal AI coach score and feedback, and climb the leaderboard together.

**App:** https://veganism-is-future-twin.github.io/pal-fit/

Works on Android, iPhone/iPad, Windows, Mac and Linux, in any modern browser. It can be installed to the home screen like a normal app (Profile → Get the app).

---

## How it fits together

| Part | Where it runs | Folder |
|---|---|---|
| Web app (installable PWA, no build step) | GitHub Pages | `web/` |
| API | Cloudflare Worker `pal-fit-api` | `worker/src/` |
| Database | Cloudflare D1 `pal-fitness` | `worker/migrations/` |
| AI | Gemini → Groq → Cloudflare Workers AI → simple rules | `worker/src/ai/` |

### Scoring
Each day is scored 0–100:

| Part | Points | Scored by |
|---|---|---|
| Logged everything | 10 | code |
| Steps vs target | 20 | code |
| Water vs target | 15 | code |
| Sleep vs target | 20 | code |
| Workout vs target | 10 | code |
| Meals vs goal & diet | 25 | AI (or simple rules) |

- The score updates every time you save. The AI re-reviews meals and feedback up to 3 times a day, and only when something changed.
- At **00:00 IST** the day's score is locked as final. Anything the AI couldn't review is retried at 02:00 IST.
- **Leaderboard points** = 20 per logged day + score × 0.8, plus +10 for every 7-day streak.

### AI models
Two chains run, and both can be changed in the app under **Admin → AI & keys** without touching code:
- **Grading & plans:** Gemini 3.8 Flash → 3.6 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite → Groq `gpt-oss-120b` → Cloudflare `gemma-4-26b`
- **Coach chat:** Gemini 3.5 Flash-Lite → 3.1 Flash-Lite → Groq → Cloudflare

If every model fails, the app still works and uses simple automatic scoring.

---

## One-time setup (Windows PowerShell)

### 1. Cloudflare (already done: database `pal-fitness` exists)
Register a `workers.dev` subdomain once: Cloudflare dashboard → **Workers & Pages** → follow the onboarding. Then:

```powershell
cd "D:\Gemini\PAL diet tracker\worker"
npm install
npx wrangler secret put ADMIN_EMAILS        # e.g. omkardbz123@gmail.com
npx wrangler secret put GROUP_INVITE_CODE   # the code new members type on first sign-in
npx wrangler secret put SETTINGS_KEY        # any long random text — encrypts API keys saved in the app
npm run db:migrate:remote
npm run deploy
```

To make a random `SETTINGS_KEY`, paste this when wrangler asks for the value:
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### 2. Google Sign-In
1. https://console.cloud.google.com → create a project (e.g. "PAL Fitness").
2. **APIs & Services → OAuth consent screen**: External, app name "PAL Fitness", your email. Publish it.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorised JavaScript origins:
     `https://veganism-is-future-twin.github.io` and `http://localhost:5173`
4. Copy the **Client ID** into `GOOGLE_CLIENT_ID` in `worker/wrangler.toml`, then `npm run deploy` again.

### 3. AI keys (in the app)
Sign in as admin → **Admin → AI & keys** and paste:
- **Gemini** key: https://aistudio.google.com → Get API key
- **Groq** key: https://console.groq.com → API Keys
- *(optional)* **OpenRouter** key

Then press **Test grading chain**. Use **List Gemini models for my key** to check exact model names.

### 4. Web app
`web/js/config.js` holds the API address. Pushing to `main` publishes `web/` to GitHub Pages automatically (`.github/workflows/pages.yml`).

---

## Local development

```powershell
cd "D:\Gemini\PAL diet tracker\worker"
Copy-Item .dev.vars.example .dev.vars      # set DEV_LOGIN=1 and test values
npm run db:migrate:local
npx wrangler dev                            # API on http://localhost:8787
# (no internet / no subdomain yet?  npx wrangler dev -c wrangler.local-noai.toml)
```
In a second window:
```powershell
cd "D:\Gemini\PAL diet tracker"
npx serve web -l 5173                       # app on http://localhost:5173
```
With `DEV_LOGIN=1`, the login screen shows a developer login (localhost only).

Trigger the midnight job locally: `curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=30+18+*+*+*"`

## Changing the database
Add a new numbered file in `worker/migrations/` (e.g. `0002_add_x.sql`), then run `npm run db:migrate:local` and `npm run db:migrate:remote`. Never edit a migration that has already been applied.

## Backups
```powershell
cd "D:\Gemini\PAL diet tracker\worker"
npx wrangler d1 export pal-fitness --remote --output ..\backups\backup-2026-11.sql
```
Admins can also download every log as CSV: **Admin → Tools → Export**. Backups contain everyone's data, so keep them private (`backups/` is gitignored).

## Privacy & safety
- Body details (height, weight, age, goal) are visible only to their owner and in the admin export. The leaderboard shows only name, photo, points, streak and days logged.
- The AI never receives names, emails or Google IDs.
- Each member can turn the AI coach off in Profile.
- API keys saved in the app are AES-GCM encrypted. Only the last 4 characters are ever shown.
- AI feedback is general wellness guidance, not medical advice.
