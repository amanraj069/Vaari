# Vaari. Each folder is a normal npm project; this file only saves typing.
# `make test` and `make dev` run on any laptop with no AWS account.
.PHONY: setup dev test plan simulate simulate-check data

setup:            ## Install backend (npm + Python engine via uv) and frontend (npm)
	cd backend && npm install && npm run engine:setup
	cd frontend && npm install

dev:              ## Backend on :4000 and frontend on :3000 (or run `npm run dev` in each folder)
	(cd backend && npm run dev) & (cd frontend && npm run dev); wait

test:             ## Engine invariants and brute-force gap, Cedar allow/deny, core loop, contract sync
	cd backend && npm test

plan:             ## Plan the seeded, simulated cluster in the terminal (SEED=1 by default)
	cd backend && npm run plan -- --seed $(or $(SEED),1)

simulate:         ## 50 district seasons x 3 policies x 2 scenarios (base, capacity shortfall) -> data/sim/results.json (not re-timed since the shortfall scenario was added; was about 14 min on 6 workers for base alone)
	cd backend && npm run simulate -- --runs $(or $(RUNS),50) --seed $(or $(SEED),1)

simulate-check:   ## Fast reproducibility check: --runs 5 --centres 3 twice, files compared byte for byte (results.json untouched)
	cd backend && npm run simulate:check

data:             ## Villages from OpenStreetMap (network), then harvest curves from the FIRMS CSVs (offline)
	cd backend && npm run data:villages && npm run data:prepare
