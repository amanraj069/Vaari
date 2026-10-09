"""CLI for the engine.

Why it exists: the API's LocalEngineClient spawns `python -m vaari_engine solve|explain` (JSON on
stdin, JSON on stdout) in development and tests, so the whole product runs on a laptop with no
engine server and no AWS account. `python -m vaari_engine plan [--seed N]` plans the seeded,
simulated cluster for a person to read (`npm run plan` in backend/).

Imports happen per command: OR-Tools takes about 0.4 s to import and only CP-SAT needs it.
"""

from __future__ import annotations

import json
import sys

from pydantic import ValidationError

from .contract import ExplainRequest, SolveRequest
from .problem import ImpossiblePinError


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "plan":
        from .plan_cli import run

        return run(sys.argv[2:])
    if command == "simulate":
        from .sim.runner import main as simulate

        return simulate(sys.argv[2:])
    if len(sys.argv) != 2 or command not in ("solve", "explain"):
        print("usage: python -m vaari_engine solve|explain < request.json\n       python -m vaari_engine plan [--seed N]\n       python -m vaari_engine simulate [--runs N] [--seed N]", file=sys.stderr)
        return 2
    raw = sys.stdin.read()
    try:
        if command == "solve":
            from .solve import solve

            response = solve(SolveRequest.model_validate_json(raw))
        else:
            from .explain import explain

            response = explain(ExplainRequest.model_validate_json(raw))
    except ValidationError as error:
        json.dump({"error": "INVALID_REQUEST", "detail": json.loads(error.json())}, sys.stdout)
        return 1
    except ImpossiblePinError as error:
        json.dump({"error": "IMPOSSIBLE_PIN", "detail": str(error)}, sys.stdout)
        return 1
    sys.stdout.write(response.model_dump_json(by_alias=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
