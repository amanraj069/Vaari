# syntax=docker/dockerfile:1.7
# The engine image: FastAPI (POST /solve, /explain) on port 8000, private to the Compose network.
# Why it exists: the API calls the engine over HTTP (ENGINE_MODE=http) instead of spawning Python,
# so the API image needs no Python. Every request must carry X-Engine-Secret (ENGINE_SHARED_SECRET).
# Build from the repo root: docker build -f backend/engine/Dockerfile -t vaari-engine .
ARG PYTHON_VERSION=3.12

FROM ghcr.io/astral-sh/uv:0.11.19 AS uv

FROM python:${PYTHON_VERSION}-slim-bookworm
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/engine/.venv \
    PATH=/app/engine/.venv/bin:$PATH \
    PYTHONPATH=/app/engine \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data
WORKDIR /app/engine
# Dependencies first (cached until the lockfile changes); the package itself is on PYTHONPATH.
# uv and its download cache are mounted for this step only, so neither ends up in the image.
COPY backend/engine/pyproject.toml backend/engine/uv.lock ./
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY backend/engine/vaari_engine ./vaari_engine
COPY data /app/data
RUN useradd --system --uid 10001 engine
USER engine
EXPOSE 8000
CMD ["uvicorn", "vaari_engine.server:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
