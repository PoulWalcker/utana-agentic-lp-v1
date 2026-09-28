#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$repository_root"

./scripts/build-public.sh
python3 scripts/verify-public.py public public-files.txt
python3 scripts/verify-seo.py public public-files.txt
git diff --check
node scripts/browser-smoke.mjs public "${SCREENSHOT_DIR:-/tmp/utana-launch-screenshots}"

printf 'Launch validation passed.\n'
