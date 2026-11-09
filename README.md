# PAL Fitness (`pal-fit`)

A phone-friendly daily fitness log for the Pune Animal Liberation group's monthly challenges.
Log your day in under 30 seconds and get AI coach feedback, a leaderboard and streaks.

> Status: **early build.** The database and backend foundation are in place. The AI coach design is being finalised before the app screens are built.

## How it fits together

| Part | Where it runs | Folder |
|---|---|---|
| Web app (PWA) | GitHub Pages: `https://veganism-is-future-twin.github.io/pal-fit/` | `web/` |
| API | Cloudflare Worker `pal-fit-api` | `worker/` |
| Database | Cloudflare D1 `pal-fitness` | `worker/schema.sql` |

The full product and technical brief is kept privately (not in this repo).

## Accounts used

- **GitHub:** `Veganism-is-future-twin` (repo `pal-fit`, GitHub Pages)
- **Cloudflare:** the `omkarwebsitetest` account (Worker + D1 database)
- **Admin of the app:** set with the `ADMIN_EMAILS` Worker secret (not stored in this public repo)

## Local development (Windows PowerShell)

```powershell
cd "D:\Gemini\PAL diet tracker\worker"
npm install
Copy-Item .dev.vars.example .dev.vars    # then edit .dev.vars with local test values
npm run db:init:local                    # create tables in the local test database
npm run dev                              # API at http://localhost:8787
```

Check it works by opening `http://localhost:8787/api/health`.

## Secrets (production)

Never commit secrets. Set them on the Worker:

```powershell
cd "D:\Gemini\PAL diet tracker\worker"
npx wrangler secret put GROUP_INVITE_CODE
npx wrangler secret put ADMIN_EMAILS
```

AI keys (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`) are added once the AI coach design is final.

## Backups

```powershell
npx wrangler d1 export pal-fitness --remote --output backup-YYYY-MM.sql
```

Backups contain everyone's data. Keep them private (they are gitignored).

_Deploy steps get filled in as the build progresses._
