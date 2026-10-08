"""FastAPI server for the engine (private ECS service in production).

Why it exists: in production the API calls the engine over the network instead of spawning
Python. Every request must carry the shared secret header; the engine is never public.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .contract import ExplainRequest, ExplainResponse, SolveRequest, SolveResponse
from .explain import explain
from .model import ImpossiblePinError
from .solve import solve

app = FastAPI(title="Vaari engine", version="0.1.0")


def require_secret(x_engine_secret: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ENGINE_SHARED_SECRET", "")
    if not expected or x_engine_secret is None or not hmac.compare_digest(expected, x_engine_secret):
        raise HTTPException(status_code=401, detail="missing or wrong X-Engine-Secret")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse, response_model_by_alias=True, dependencies=[Depends(require_secret)])
def solve_endpoint(request: SolveRequest) -> SolveResponse:
    try:
        return solve(request)
    except ImpossiblePinError as error:
        raise HTTPException(status_code=422, detail={"error": "IMPOSSIBLE_PIN", "detail": str(error)}) from error


@app.post("/explain", response_model=ExplainResponse, response_model_by_alias=True, dependencies=[Depends(require_secret)])
def explain_endpoint(request: ExplainRequest) -> ExplainResponse:
    return explain(request)
