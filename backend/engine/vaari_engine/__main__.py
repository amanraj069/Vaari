"""CLI: `python -m vaari_engine solve|explain` reads JSON on stdin and writes JSON on stdout.

Why it exists: the API's LocalEngineClient spawns this in development and tests, so the whole
product runs on a laptop with no engine server and no AWS account.
"""

from __future__ import annotations

import json
import sys

from pydantic import ValidationError

from .contract import ExplainRequest, SolveRequest
from .explain import explain
from .model import ImpossiblePinError
from .solve import solve


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("solve", "explain"):
        print("usage: python -m vaari_engine solve|explain < request.json", file=sys.stderr)
        return 2
    command = sys.argv[1]
    raw = sys.stdin.read()
    try:
        if command == "solve":
            response = solve(SolveRequest.model_validate_json(raw))
        else:
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
