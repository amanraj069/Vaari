# Vaari ਵਾਰੀ

> Your turn, guaranteed. No fire needed.

Vaari gives every farmer in a Punjab village cluster a **promised machine date** for sowing wheat after paddy, so nobody burns stubble while waiting for a Super Seeder. A Custom Hiring Centre (CHC) operator approves tomorrow's route for each machine. The farmer sees a firm date, or a window that narrows to one, with a reason if it moves.

Built for the WeMakeDevs x AWS Environmental Hacks (Air track), 8-11 October 2026.

**Everything in the demo is simulated** (farmers, fields, machines, breakdowns), and the names are invented. Village names and locations are real (OpenStreetMap). The sowing optimum (first fortnight of November) and the yield loss (about 150 kg per acre per week) are from PAU's Package of Practices, Rabi 2025-26.

## Run it locally (no AWS account)

Needs Node 22+ and [uv](https://docs.astral.sh/uv/) (uv installs Python 3.12 and OR-Tools for the engine).

```bash
# Terminal 1: backend (Express API on :4000; sets up the Python engine on first run)
cd backend
npm install
npm run dev

# Terminal 2: frontend (Next.js on :3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and click **Try as farmer** or **Try as operator**.

Tests: `cd backend && npm test` (API, Cedar, core loop) and `npm run test:engine` (solver invariants).

## How it decides

- **Code decides, the model explains.** OR-Tools CP-SAT assigns fields to (machine, day). Promises are hard constraints. Pass 1 minimises fields past the farmer's last waiting day. Pass 2 then minimises wheat loss, travel, fairness slack and unserved fields.
- **Promises never break silently.** Minimal-break mode runs only when the promises are infeasible. It breaks the fewest, starting with the farmers who can wait longest, gives them the earliest new date, and notifies them at once.
- **"Why this date?"** re-solves with the field forced earlier, using CP-SAT assumption literals. The infeasible core becomes the reasons list, which is phrased by templates (en / pa / hi).
- **Cedar** policies in `backend/api/policies/vaari.cedar` decide who can see and change what.

## Layout

```
backend/           Express + TypeScript API (npm run dev)
  src/             auth, Cedar authorisation, planner, routes
  src/shared/      Zod contract: the source of truth for API and engine shapes
  policies/        Cedar policies
  engine/          Python 3.12: CP-SAT model, routes, explanations (no AWS imports); the API spawns it
frontend/          Next.js 15 (App Router) with a backend-for-frontend (tokens stay in httpOnly cookies)
  src/shared/      Generated copy of backend/src/shared (run `npm run contract:sync` in backend/)
data/              scripts/ (fetchers), derived/ (small committed JSON), raw/ (git-ignored)
```

## Assumptions

Labelled "assumed" in the UI: road distance is straight-line × 1.3 at 20 km/h; 15 minutes of setup per field; 8-hour machine days from 08:00; machine speed prior spread over 5.3 to 12 acres per day.

Satellites show heat, not intent. Vaari never accuses a farmer of burning.
# Vaari
