#!/bin/sh
# usage: ndemo-reset.sh <web-dir> <port>  - restart the mock dev server (fresh in-memory data) and warm the judge routes.
# <web-dir> may be relative (the playbooks pass "web", relative to the directory ndemo runs in): it is made absolute here,
# because the server is started after a cd and the log path is built from it.
WEB=$(cd "$1" && pwd) || exit 1; PORT=$2; LOG=$WEB/../dev-$PORT.log
P=$(lsof -ti tcp:$PORT -sTCP:LISTEN); [ -n "$P" ] && kill $P && sleep 1.5
cd "$WEB" && WATCHPACK_POLLING=true GAVIL_MOCK=1 GAVIL_MOCK_DEMO=1 GAVIL_MOCK_TALK=1 nohup npx next dev --turbopack -p $PORT > "$LOG" 2>&1 &
for i in $(seq 1 60); do grep -q 'Ready' "$LOG" 2>/dev/null && break; sleep 0.5; done
J=$(mktemp); H=$(mktemp)
curl -s -o /dev/null --max-time 120 -c $J "http://localhost:$PORT/auth/mock?role=judge"
# warm <path>: the page's HTML (compiles the route), then the script and style files that page asks for. A fresh dev
# server compiles those on the browser's first request, so a screen first opened in the recording would be HTML that
# does not react to a tap yet, for seconds on a busy machine.
warm() {
  curl -s --max-time 120 -b $J -o "$H" "http://localhost:$PORT$1"
  grep -oE '(src|href)="/_next/static/[^"]+\.(js|css)[^"]*"' "$H" | sed -E 's/^(src|href)="//; s/"$//; s/&amp;/\&/g' | sort -u |
    while read -r f; do curl -s -o /dev/null --max-time 120 "http://localhost:$PORT$f"; done
}
for u in /login /judge /judge/countdown /judge/evaluate /judge/compare /judge/notes /judge/done; do warm $u; done
# the talk API routes compile on their first call (about 2 s under load, visible as a long "Pulling out highlights"): an empty POST compiles each one and is refused before it does any work
for u in /api/talk/recordings /api/talk/highlights; do curl -s -o /dev/null --max-time 120 -b $J -X POST -H "Origin: http://localhost:$PORT" -H "Content-Type: application/json" -d '{}' "http://localhost:$PORT$u"; done
rm -f $J $H; echo "reset ok :$PORT"
