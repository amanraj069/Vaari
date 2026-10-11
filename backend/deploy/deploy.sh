#!/usr/bin/env bash
# Deploys the backend containers on this host (the EC2 instance). Run from anywhere:
#   deploy/deploy.sh            build the images from this checkout and start them (no registry)
#   deploy/deploy.sh <TAG>      pull $IMAGE_REGISTRY/vaari-api:<TAG> and vaari-engine:<TAG> (the pipeline)
#   deploy/deploy.sh current    the release running now again (after editing backend/.env)
# Why it exists: every check that used to be a debugging session runs here first, against the new
# image and the real .env, before the running containers are touched. If the new containers are
# not healthy, the previous release (or, on the first run, the old systemd service) comes back.
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf '\nDEPLOY FAILED: %s\n' "$*" >&2
  exit 1
}
# A value from .env without sourcing it (values may hold spaces or quotes).
env_value() {
  { grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" .env || true; } | tail -n 1 |
    sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//; s/^['\"]//; s/['\"]$//"
}

LEGACY_SERVICE=vaari-backend
RELEASE_FILE=deploy/.deployed-release
TAG="${1:-}"
[ -f .env ] || fail "backend/.env is missing. Copy backend/.env.example to backend/.env and fill it in."
command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is not installed"
if command -v systemctl >/dev/null && ! systemctl is-enabled --quiet docker 2>/dev/null; then
  echo "warning: docker does not start on boot, so the API stays down after the instance restarts. Fix: sudo systemctl enable docker"
fi

# The release running now: "IMAGE_REGISTRY TAG", written after each healthy registry deploy.
previous_registry="" previous_tag=""
if [ -f "$RELEASE_FILE" ]; then read -r previous_registry previous_tag <"$RELEASE_FILE" || true; fi
if [ "$TAG" = "current" ]; then
  [ -n "$previous_tag" ] || fail "no release has been deployed from the registry yet; pass a tag"
  TAG="$previous_tag"
fi

# WhatsApp on SQS needs the worker; start it unless COMPOSE_PROFILES says otherwise.
if [ -z "${COMPOSE_PROFILES:-}" ] && [ -z "$(env_value COMPOSE_PROFILES)" ] &&
  [ "$(env_value WHATSAPP_ENABLED)" = "true" ] && [ "$(env_value WHATSAPP_QUEUE)" = "sqs" ]; then
  export COMPOSE_PROFILES=worker
  echo "WHATSAPP_QUEUE=sqs: starting the worker too"
fi
# The services that must be healthy before the release counts as deployed.
services="engine api"
case ",${COMPOSE_PROFILES:-$(env_value COMPOSE_PROFILES)}," in
  *,worker,*) services="engine api worker" ;;
esac

log "Checking backend/.env"
compose_problem="$(docker compose config --quiet 2>&1)" || fail "docker compose cannot read the setup: ${compose_problem}"
dollar_keys="$(grep -E '^[A-Z_]+=[^'"'"']*\$' .env | cut -d= -f1 | tr '\n' ' ' || true)"
[ -z "$dollar_keys" ] || echo "warning: ${dollar_keys}contain \$ without single quotes; Compose will treat it as a variable"

if [ -n "$TAG" ]; then
  export IMAGE_TAG="$TAG"
  export IMAGE_REGISTRY="${IMAGE_REGISTRY:-${previous_registry:-$(env_value IMAGE_REGISTRY)}}"
  [ -n "$IMAGE_REGISTRY" ] || fail "IMAGE_REGISTRY is not set (the pipeline passes it; by hand: IMAGE_REGISTRY=<account>.dkr.ecr.<region>.amazonaws.com deploy/deploy.sh <tag>)"
  if [[ "$IMAGE_REGISTRY" == *.dkr.ecr.*.amazonaws.com* ]]; then
    log "Signing in to ECR"
    registry_region="$(echo "$IMAGE_REGISTRY" | cut -d. -f4)"
    aws ecr get-login-password --region "$registry_region" | docker login --username AWS --password-stdin "${IMAGE_REGISTRY%%/*}" >/dev/null ||
      fail "could not sign in to ECR. The instance role needs AmazonEC2ContainerRegistryReadOnly (backend/deploy/README.md)."
  fi
  log "Pulling images ${IMAGE_REGISTRY}/vaari-{api,engine}:${TAG}"
  docker compose pull --quiet api engine || fail "could not pull the images for ${TAG}"
else
  export IMAGE_TAG=local
  log "Building images from this checkout"
  docker compose build api engine || fail "the image build failed (output above)"
fi

log "Checking the configuration inside the new API image"
docker compose run --rm --no-deps -T api node dist/check-config.js ||
  fail "the API would refuse to start with this backend/.env (errors above). Nothing was changed."

if [ "$(env_value REPO)" = "dynamo" ] && [ -z "$(env_value DYNAMODB_ENDPOINT)" ]; then
  log "Checking AWS access from inside a container"
  docker compose run --rm --no-deps -T api node --input-type=module -e "
    const { DynamoDBClient, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
    const table = (process.env.TABLE_PREFIX || 'vaari-dev') + '-chcs';
    try {
      await new DynamoDBClient({}).send(new DescribeTableCommand({ TableName: table }));
      console.log('  AWS ok: ' + table + ' is reachable');
    } catch (error) {
      console.error('  ' + (error.name || 'Error') + ': ' + error.message);
      process.exit(1);
    }" ||
    fail "the containers cannot use DynamoDB. 'Could not load credentials' means the instance metadata hop limit is 1 (set it to 2, see backend/deploy/README.md); 'ResourceNotFoundException' means the tables for TABLE_PREFIX do not exist in AWS_REGION; 'AccessDenied' means the instance role lacks DynamoDB rights. Nothing was changed."
fi

# First container deploy: the old `node dist/server.js` service holds the port. Stop it only now,
# after every check passed, so the API is down for seconds; it comes back if the containers fail.
legacy_stopped=false
if command -v systemctl >/dev/null && systemctl is-active --quiet "$LEGACY_SERVICE" 2>/dev/null; then
  log "Stopping the old ${LEGACY_SERVICE} systemd service (replaced by the containers)"
  sudo -n systemctl disable --now "$LEGACY_SERVICE" ||
    fail "could not stop ${LEGACY_SERVICE} (no passwordless sudo). Run once: sudo systemctl disable --now ${LEGACY_SERVICE}"
  legacy_stopped=true
fi

# A worker container from a release that ran one, now unwanted (WHATSAPP_QUEUE is no longer sqs):
# `up` leaves services outside the active profiles alone, and that worker would crash-loop or keep
# reading the queue. Removed before the new release starts.
case " $services " in
  *" worker "*) ;;
  *)
    if [ -n "$(docker compose --profile worker ps -aq worker 2>/dev/null)" ]; then
      log "Removing the worker container (not needed with this .env)"
      docker compose --profile worker rm --stop --force worker >/dev/null || true
    fi
    ;;
esac

log "Starting the containers"
docker compose up -d --remove-orphans || true

wait_healthy() {
  local deadline=$((SECONDS + 180)) service container status
  while [ "$SECONDS" -lt "$deadline" ]; do
    local all_healthy=true
    for service in $services; do
      container="$(docker compose ps -q "$service")"
      status="$( [ -n "$container" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" || echo missing)"
      case "$status" in
        healthy) ;;
        unhealthy | exited | dead | missing)
          echo "  $service is $status"
          return 1
          ;;
        *) all_healthy=false ;;
      esac
    done
    if $all_healthy; then return 0; fi
    sleep 3
  done
  echo "  timed out after 180 s"
  return 1
}

api_port="$(env_value PORT)"
if wait_healthy && curl -fsS --max-time 5 "http://127.0.0.1:${api_port:-4000}/healthz" >/dev/null; then
  if [ -n "$TAG" ]; then echo "$IMAGE_REGISTRY $TAG" >"$RELEASE_FILE"; fi
  log "Deployed ${TAG:-a local build}: ${services// /, } healthy; the API answers on port ${api_port:-4000}"
  docker compose ps
  # Keep the running release and the one before it (for rollback); remove older backend images.
  docker images --format '{{.Repository}}:{{.Tag}}' | while read -r image; do
    case "$image" in
      */vaari-api:* | */vaari-engine:*)
        image_tag="${image##*:}"
        if [ "$image_tag" != "${TAG:-local}" ] && [ "$image_tag" != "$previous_tag" ] && [ "$image_tag" != "local" ]; then
          docker rmi "$image" >/dev/null 2>&1 || true
        fi
        ;;
    esac
  done
  docker image prune -f >/dev/null
  exit 0
fi

log "The new containers are not healthy. Last log lines:"
# shellcheck disable=SC2086 # $services is a list of service names
docker compose logs --no-color --tail 60 $services || true
if $legacy_stopped; then
  log "Bringing the old ${LEGACY_SERVICE} service back"
  docker compose down || true
  sudo -n systemctl enable --now "$LEGACY_SERVICE" || true
elif [ -n "$TAG" ] && [ -n "$previous_tag" ] && [ "$previous_tag" != "$TAG" ]; then
  log "Rolling back to ${previous_tag}"
  IMAGE_REGISTRY="$previous_registry" IMAGE_TAG="$previous_tag" docker compose up -d --remove-orphans || true
  if wait_healthy; then echo "  ${previous_tag} is running and healthy again"; else echo "  ${previous_tag} is not healthy either: check docker compose logs"; fi
fi
fail "release ${TAG:-local} did not become healthy (logs above)"
