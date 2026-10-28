#!/bin/sh
# Writes the TomTom browser key (restricted to ace9x.github.io) into js/keys.js without echoing it.
K=$(tr -d '[:space:]' < /workspace/.rr-secrets/tomtom_key.txt 2>/dev/null)
[ ${#K} -ge 20 ] || { echo "tomtom key missing/empty (len ${#K}) — js/keys.js left keyless"; exit 1; }
printf "// Browser keys (domain-restricted at the provider). Filled by tools/inject-keys.sh; never logged.\nexport const KEYS = { tomtom: '%s' };\n" "$K" > js/keys.js && echo "tomtom key injected (len ${#K})"
