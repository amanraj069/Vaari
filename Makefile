# Vaari. Each folder is a normal npm project; this file only saves typing.
# `make test` and `make dev` run on any laptop with no AWS account.
.PHONY: setup dev test data

setup:            ## Install backend (npm + Python engine via uv) and frontend (npm)
	cd backend && npm install && npm run engine:setup
	cd frontend && npm install

dev:              ## Backend on :4000 and frontend on :3000 (or run `npm run dev` in each folder)
	(cd backend && npm run dev) & (cd frontend && npm run dev); wait

test:             ## Engine invariants, Cedar allow/deny, core loop, contract sync
	cd backend && npm run test:engine && npm test

data:             ## Villages from OpenStreetMap (network), then harvest curves from the FIRMS CSVs (offline)
	cd backend && npm run data:villages && npm run data:prepare
