# Backend on EC2 with Docker Compose

Three containers on the EC2 host, defined in `backend/docker-compose.yml`:

| Service | Image | Reachable from | Notes |
|---|---|---|---|
| `api` | `vaari-api` (`backend/Dockerfile`) | CloudFront, on `.env`'s `PORT` | Express API; seeds the demo centre on first start |
| `engine` | `vaari-engine` (`backend/engine/Dockerfile`) | the api and worker only (no published port) | FastAPI + OR-Tools; needs `X-Engine-Secret` |
| `worker` | `vaari-api`, `node dist/worker.js` | nothing | WhatsApp SQS consumer; runs only with `COMPOSE_PROFILES=worker` (automatic when `WHATSAPP_QUEUE=sqs`) |

**Environment.** `backend/.env` on the host is the only place settings live. Every line reaches the api and the worker unchanged. Compose sets only what must differ inside containers: `ENGINE_MODE=http`, `ENGINE_URL=http://engine:8000`, `DATA_DIR=/app/data` and the container port (4000). `PORT` in `.env` stays the host port, so CloudFront's origin is unchanged. Values containing `$` must be single-quoted.

**Pipeline** (`.github/workflows/backend.yml`). Every pull request runs the tests and builds both images. A push to `main` that touches `backend/`, `data/` or the workflow then:

1. pushes the images to ECR, tagged with the commit SHA;
2. runs `backend/deploy/deploy.sh <sha>` on the instance through SSM Run Command.

On the host, `deploy.sh`:

1. fast-forwards the checkout;
2. checks `.env`;
3. runs the new image's config check (`dist/check-config.js`);
4. checks that the containers can reach DynamoDB;
5. starts the containers and waits for both health checks;
6. if they are not healthy, rolls back to the previous release.

The pipeline uses GitHub OIDC (no AWS keys anywhere) and SSM (no SSH port).

## One-time setup

### 1. On your laptop (AWS CLI signed in as an admin of the account)

```bash
export AWS_REGION=ap-south-1                      # the region the instance and tables are in
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export INSTANCE_ID=i-0123456789abcdef0            # EC2 console > Instances
export INSTANCE_ROLE=instanceRole                 # IAM role attached to the instance
export GITHUB_REPO=amanraj069/Vaari
fill() { sed -e "s/ACCOUNT_ID/$ACCOUNT_ID/g" -e "s/REGION/$AWS_REGION/g" -e "s/INSTANCE_ID/$INSTANCE_ID/g" -e "s#GITHUB_REPO#$GITHUB_REPO#g" "$1"; }
cd backend/deploy/iam
```

**a. Let containers use the instance role.** IMDSv2 answers only one network hop by default, and a container is two hops away. Without this step every AWS call from a container fails with "Could not load credentials".

```bash
aws ec2 modify-instance-metadata-options --instance-id $INSTANCE_ID \
  --http-endpoint enabled --http-tokens required --http-put-response-hop-limit 2
```

**b. Instance role.** SSM, so the pipeline can run the deploy. ECR read, so the host can pull the images. Optionally CloudWatch Logs for the containers.

```bash
aws iam attach-role-policy --role-name $INSTANCE_ROLE --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name $INSTANCE_ROLE --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
fill instance-logs-policy.json > /tmp/vaari-logs.json
aws iam put-role-policy --role-name $INSTANCE_ROLE --policy-name vaari-container-logs --policy-document file:///tmp/vaari-logs.json
```

**c. Image repositories.** Each keeps its last 10 images.

```bash
for repo in vaari-api vaari-engine; do
  aws ecr create-repository --repository-name $repo --image-scanning-configuration scanOnPush=true
  aws ecr put-lifecycle-policy --repository-name $repo --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep the last 10","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'
done
```

**d. The role GitHub Actions assumes.** Create the OIDC provider once per account; skip that command if it already exists.

```bash
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
fill github-trust.json > /tmp/vaari-trust.json
fill github-deploy-policy.json > /tmp/vaari-deploy.json
aws iam create-role --role-name vaari-github-deploy --assume-role-policy-document file:///tmp/vaari-trust.json
aws iam put-role-policy --role-name vaari-github-deploy --policy-name vaari-deploy --policy-document file:///tmp/vaari-deploy.json
```

The role can push only `vaari-api` and `vaari-engine`, and run commands only on this one instance. It can be assumed only from `main` or the `production` environment of this repo.

### 2. GitHub repository variables

Settings > Secrets and variables > Actions > **Variables** (not secrets; nothing here is secret):

```bash
gh variable set AWS_REGION --body "$AWS_REGION"
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::$ACCOUNT_ID:role/vaari-github-deploy"
gh variable set EC2_INSTANCE_ID --body "$INSTANCE_ID"
# Only if `uname -m` on the instance says aarch64 (Graviton):
gh variable set DOCKER_PLATFORM --body linux/arm64
# Only if the repo is not at /home/ec2-user/Vaari or the user is not ec2-user:
# gh variable set EC2_REPO_DIR --body /home/ec2-user/Vaari
# gh variable set EC2_USER --body ec2-user
```

The deploy job runs in the `production` environment, which GitHub creates on the first run. To approve each deploy by hand, add required reviewers to it under Settings > Environments.

### 3. On the EC2 host (once)

```bash
uname -m                                    # x86_64: nothing to do; aarch64: set DOCKER_PLATFORM above
sudo systemctl enable --now docker          # containers come back after the instance stops overnight
docker compose version                      # the compose plugin is there
sudo systemctl restart amazon-ssm-agent     # picks up the SSM policy from step 1b
cd ~/Vaari && git checkout main && git status   # on main and clean: the pipeline fast-forwards it
# The repo is public, so fetch over HTTPS and SSM needs no SSH key:
git remote set-url origin https://github.com/amanraj069/Vaari.git
```

From your laptop, check that SSM sees the instance (`PingStatus` should be `Online`; it can take a minute):

```bash
aws ssm describe-instance-information --filters Key=InstanceIds,Values=$INSTANCE_ID \
  --query 'InstanceInformationList[0].PingStatus'
```

`backend/.env` on the host stays as it is. `ENGINE_MODE`, `ENGINE_URL`, `ENGINE_PYTHON` and `DATA_DIR` in it are ignored in Docker.

### 4. First deploy (switches from the old systemd service)

Merge to `main`, or run the workflow by hand (Actions > backend > Run workflow). After all its checks pass, `deploy.sh` stops and disables the old `vaari-backend` systemd service, so the API is down for seconds, not minutes. If the containers do not become healthy, it brings that service back.

To do the same on the host without the pipeline (it builds the images there, about 5 minutes):

```bash
cd ~/Vaari/backend && ./deploy/deploy.sh
```

## Everyday

| Task | Command (on the host, in `~/Vaari/backend`) |
|---|---|
| Deploy | push to `main`, or Actions > backend > Run workflow |
| What is running | `docker compose ps` and `cat deploy/.deployed-release` |
| Logs | `docker compose logs -f api` (or `engine`, `worker`) |
| Changed `.env` | `./deploy/deploy.sh current` (checks it, then recreates the containers) |
| Roll back | `./deploy/deploy.sh <older commit sha>` (any of the last 10 in ECR) |
| Restart without changes | `docker compose restart api` |
| Build from this checkout, no registry | `./deploy/deploy.sh` |

Do not run `docker compose up` by hand after a pipeline deploy: without `IMAGE_TAG` it builds a `local` image instead of using the release. Use `./deploy/deploy.sh current`.

Container logs to CloudWatch (`/vaari/backend`, one stream per container): add `COMPOSE_FILE=docker-compose.yml:docker-compose.cloudwatch.yml` to `backend/.env`, then run `./deploy/deploy.sh current`.

## When a deploy fails

`deploy.sh` stops before touching the running containers and names the problem:

| Message | Cause | Fix |
|---|---|---|
| `docker compose cannot read the setup: … line N` | a malformed line in `.env` | fix line N (a comment must start with `#`) |
| `Refusing to start in production: X is missing` | a required setting is missing | add X to `.env`, then `./deploy/deploy.sh current` |
| `Could not load credentials from any providers` | containers cannot reach the instance role | step 1a (hop limit 2) |
| `ResourceNotFoundException` | no tables for `TABLE_PREFIX` in `AWS_REGION` | check both in `.env`, or create the tables (`npm run db:create` from a laptop) |
| `could not sign in to ECR` | instance role lacks ECR read | step 1b |
| `did not become healthy` | the app crashed at start | the log lines printed above it; the previous release is running again |

In the Actions log, `InvalidInstanceId` from SSM means the instance is not registered with SSM. Do step 1b, then restart the agent (step 3).
