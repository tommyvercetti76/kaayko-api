#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CMD=(firebase deploy --config "$ROOT/firebase.json" --only functions:api)

if [[ -n "${FIREBASE_PROJECT:-}" ]]; then
  DEPLOY_CMD+=(--project "$FIREBASE_PROJECT")
fi

if [[ "$#" -gt 0 ]]; then
  DEPLOY_CMD+=("$@")
fi

cd "$ROOT"
npm --prefix functions run predeploy:check
"${DEPLOY_CMD[@]}"
