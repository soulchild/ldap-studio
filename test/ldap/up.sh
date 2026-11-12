#!/bin/sh
# Starts the test servers, configures 389-DS, and seeds both servers.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
compose="docker compose -f $here/docker-compose.yml"

"$here/gen-certs.sh"
$compose up -d --build --wait

# 389-DS reports healthy before its admin socket is reliably up, and it can restart once
# right after first-time setup. Retry each dsconf call instead of relying on timing.
dsconf_retry() {
  tries=0
  until out=$($compose exec -T dirsrv dsconf localhost "$@" 2>&1); do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo "dsconf $* kept failing: $out" >&2
      exit 1
    fi
    sleep 1
  done
  printf '%s\n' "$out"
}

# 389-DS creates no backend by default.
if ! dsconf_retry backend suffix list | grep -qi "dc=example,dc=com"; then
  dsconf_retry backend create --suffix dc=example,dc=com --be-name userroot --create-suffix
fi

# Same low size limit as OpenLDAP; paged searches may return everything.
dsconf_retry config replace nsslapd-sizelimit=100 nsslapd-pagedsizelimit=-1 >/dev/null

# 389-DS also stops a search after examining 5,000 entries (adminLimitExceeded), which the
# 5,000-child container would hit while paging. Lift it for paged searches only.
dsconf_retry backend config set --pagedlookthroughlimit -1 >/dev/null

node "$here/seed.mjs"
echo "Test servers are up."
