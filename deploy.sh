#!/usr/bin/env bash
set -euo pipefail

# Deploys on the server from the repository clone (CI runs it over SSH, see .github/workflows/ci.yml).
# Optional, passed by CI: DEPLOY_REF (commit to check out) and IMAGE_TAG (images built from it).
# Without them the default branch and the `latest` images are deployed.
# The server .env sets IMAGE_REPO (ghcr.io/<owner>/<repo>) and COMPOSE_PROFILES=app, see .env.example.

# Bash reads a script as it runs it, so the checkout below would swap this very file under the running shell. The
# block is parsed whole before it runs; after the checkout the checked-out deploy.sh starts over from the top.
if [ -z "${DEPLOY_CHECKED_OUT:-}" ]; then
  DEFAULT_BRANCH=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
  if [ -z "$DEFAULT_BRANCH" ] || [ "$DEFAULT_BRANCH" = "HEAD" ]; then DEFAULT_BRANCH="main"; fi

  # CI passes its short-lived GITHUB_TOKEN as GIT_TOKEN. It goes to git through env-based config
  # (not argv, so it never shows up in the process list) and is never written to .git/config.
  if [ -n "${GIT_TOKEN:-}" ]; then
    export GIT_CONFIG_COUNT=1
    export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
    export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 -w0)"
  fi

  git checkout -- .
  if [ -n "${DEPLOY_REF:-}" ]; then
    echo "⬇️  Checking out $DEPLOY_REF..."
    git fetch origin
    git checkout --detach "$DEPLOY_REF"
  else
    echo "⬇️  Pulling latest code..."
    git checkout "$DEFAULT_BRANCH"
    git pull origin "$DEFAULT_BRANCH"
  fi
  DEPLOY_CHECKED_OUT=1 exec bash ./deploy.sh
fi

export IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_SERVICES="bot worker api"

# The tag the last successful deploy pinned (see the end), which a rollback restores.
PREVIOUS_TAG=$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2- | sed 's/[[:space:]]#.*//; s/[[:space:]]*$//' || true)

echo "⬇️  Pulling images $IMAGE_TAG..."
docker compose pull --quiet $APP_SERVICES migrate

docker compose up -d --wait postgres redis

# Migrations have no down-migrations: keep a dump to restore together with the old images.
# Taken with the app stopped, so no write is lost between the dump and the new images.
umask 077
mkdir -p backups
echo "💾 Backing up the database..."
docker compose stop $APP_SERVICES
rm -f backups/pre-deploy.dump
if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > backups/pre-deploy.dump; then
  echo "❌ Database backup failed, starting the old images again..."
  rm -f backups/pre-deploy.dump
  IMAGE_TAG="${PREVIOUS_TAG:-latest}" docker compose up -d --no-build --no-deps $APP_SERVICES || true
  exit 1
fi

echo "🔄 Migrating and restarting..."
# Migrations run on their own: `--wait` would also wait on the one-off container.
if docker compose run --rm --no-deps migrate \
  && docker compose up -d --no-build --no-deps --remove-orphans --wait --wait-timeout 180 $APP_SERVICES; then
  echo "✅ All containers are healthy!"
  docker compose ps
else
  echo "❌ Containers did not become healthy in time, rolling back..."
  docker compose ps || true
  docker compose logs --tail=50 migrate $APP_SERVICES || true
  if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$IMAGE_TAG" ]; then
    docker compose stop $APP_SERVICES
    docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' \
      < backups/pre-deploy.dump
    IMAGE_TAG="$PREVIOUS_TAG" docker compose up -d --no-build --no-deps --force-recreate $APP_SERVICES
  else
    echo "⚠️ No previous image to roll back to, exiting..."
  fi
  exit 1
fi

# Compose reads ${IMAGE_TAG} from .env too, so a manual `docker compose up -d` starts this build.
echo "📌 Pinning IMAGE_TAG=$IMAGE_TAG in .env..."
if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$IMAGE_TAG|" .env
else
  printf '\nIMAGE_TAG=%s\n' "$IMAGE_TAG" >> .env
fi

echo "🧹 Cleaning up old images..."
docker image prune -f

echo "✅ Done!"
