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

**The whole loop in two minutes** (simulated season): sign in as the facilitator, book a field on `/book` and copy the farmer's link; open it in a private window (no account): it says *Requested*. Sign in as the operator: `/operator` shows the new request; on `/operator/plan` click **Make a fresh plan**, read *What approving does*, optionally click a field to move it, then **Approve and publish**. Reload the farmer's link: a firm date, the machine and its stop, and the reason in one sentence. Nothing a farmer sees changes until the operator approves.

Tests: `cd backend && npm test` runs everything in the backend: the engine (solver invariants for both planners, and the search compared with brute force on 200 small instances, whose gap it prints), then the API (Cedar, core loop, contract). `npm run test:engine` and `npm run test:api` run one half.

**See the planner work, no server needed:**

```bash
cd backend
npm run plan -- --seed 1                                         # a simulated 34-field season, planned in about 0.2 s
npm run plan -- --seed 1 --down m2:2026-11-05 --rain 2026-11-06  # a breakdown and rain: the re-plan keeps promises or says which broke
npm run plan -- --seed 1 --compare                               # the same cluster planned by CP-SAT too, on one objective
npm run plan -- --help                                           # every option (--fields, --machines, --today, --method, --json)
```

**Data.** By default the backend keeps data in memory (`REPO=memory`). To use DynamoDB, set `REPO=dynamo`, `TABLE_PREFIX` and `AWS_REGION` in `backend/.env` (credentials come from your AWS CLI login), then:

```bash
cd backend
npm run db:create   # creates any missing tables and indexes, waits until ACTIVE (safe to re-run)
npm run db:status   # tables, indexes and item counts
```

## How it decides

- **Code decides, the model explains.** OR-Tools CP-SAT assigns fields to (machine, day). Promises are hard constraints. Pass 1 minimises fields past the farmer's last waiting day. Pass 2 then minimises wheat loss, travel, fairness slack and unserved fields.
- **A fast planner beside it.** For the simulator (thousands of plans) and as CP-SAT's fallback, a second planner builds an earliest-burn-deadline plan and improves it with seeded local search: the same seed always gives the same plan. On 200 small random instances it matches the brute-force optimum on 198 and is never worse on promises, burn deadlines or unserved fields. If its plan would break a promise, CP-SAT is asked how few must break, and the answer says whether that minimum was proven (`solver.breaksProvenMinimal`). Both planners are scored on one lexicographic objective (promises, fields past the last waiting day, unserved fields, wheat lost, travel, fairness slack). The API uses CP-SAT unless `ENGINE_METHOD=search`.
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

Labelled "assumed" in the UI: road distance is straight-line × 1.3 at 20 km/h; 15 minutes of setup per field; 8-hour machine days from 08:00; machine speed prior spread over 5.3 to 12 acres per day. The engine accepts a road travel matrix in the request (`travelMatrix`), which is where the Amazon Location route matrix will plug in; until then the straight-line fallback is used and every plan says so (`solver.travelSource`).

Satellites show heat, not intent. Vaari never accuses a farmer of burning.
# Vaari
