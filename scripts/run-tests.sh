#!/usr/bin/env bash
# Expand test globs in the SHELL, not in node --test.
# Node's built-in runner only learned glob patterns in v21; CI and production both run Node 20
# (see .github/workflows/ci.yml + Dockerfile). Quoted '**' patterns reach Node 20 as literal
# paths and it exits with "Could not find '<path>'". Expanding here keeps one behaviour on
# every runner. See POST-CUTOVER-CLEANUP P0-3.
set -euo pipefail
shopt -s globstar nullglob

files=()
for pattern in "$@"; do
  matches=( $pattern )
  if (( ${#matches[@]} == 0 )); then
    echo "run-tests.sh: pattern matched no files: $pattern" >&2
    exit 1
  fi
  files+=( "${matches[@]}" )
done

# Dedupe: the pattern lists overlap on purpose (e.g. 'tests/unit/crystal/*.test.ts' plus
# 'tests/unit/crystal/**/*.test.ts'), and globstar matches the top level too — without this,
# every top-level crystal suite would run twice.
mapfile -t files < <(printf '%s\n' "${files[@]}" | awk '!seen[$0]++')

exec npx tsx --test "${files[@]}"
