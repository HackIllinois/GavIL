#!/bin/sh
# usage: reset-admin.sh <web-dir> <port>   (<web-dir> may be relative, like "web": it is made absolute below)
# Restarts the mock dev server for the admin demo (fresh in-memory data) and warms its routes.
# Unlike demo/ndemo-reset.sh it does not set GAVIL_MOCK_TALK: Table talk and Claude highlights start off, so
# the Settings screen carries no pre-recorded "confirmed by dev (GAVIL_MOCK_TALK)" line.
# stdin/stdout are detached from the dev server, so a caller that waits for output (ndemo setup) returns.
WEB=$(cd "$1" && pwd) || exit 1; PORT=$2; LOG=$WEB/../dev-$PORT.log
P=$(lsof -ti tcp:$PORT -sTCP:LISTEN); [ -n "$P" ] && kill $P && sleep 1.5
cd "$WEB" || exit 1
WATCHPACK_POLLING=true GAVIL_MOCK=1 GAVIL_MOCK_DEMO=1 nohup npx next dev --turbopack -p $PORT > "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 120); do grep -q 'Ready' "$LOG" 2>/dev/null && break; sleep 0.5; done
J=$(mktemp); A=$(mktemp)
curl -s -o /dev/null -c $J "http://localhost:$PORT/auth/mock?role=judge"; curl -s -o /dev/null -c $A "http://localhost:$PORT/auth/mock?role=admin"
for u in /login /judge /judge/countdown /judge/evaluate /judge/compare /judge/notes /judge/done; do curl -s -o /dev/null -b $J "http://localhost:$PORT$u"; done
for u in /admin /admin/judges /admin/flagged /admin/placards /admin/settings /admin/assignments /admin/deliberations /admin/prizes; do curl -s -o /dev/null -b $A "http://localhost:$PORT$u"; done
rm -f $J $A; echo "reset ok :$PORT"
