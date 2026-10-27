#!/bin/sh
# Rewrite the games: section of config.example.yaml from the games under src/games/.
set -e
tmp=$(mktemp)
npx tsx src/core/tools/gen-config-example.ts > "$tmp"
python3 - "$tmp" <<'PY'
import sys
lines=open('config.example.yaml').read().split('\n')
i=next(k for k,l in enumerate(lines) if l.startswith('games:'))
open('config.example.yaml','w').write('\n'.join(lines[:i])+'\n'+open(sys.argv[1]).read())
PY
rm -f "$tmp"
