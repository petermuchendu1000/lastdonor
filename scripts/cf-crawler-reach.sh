#!/usr/bin/env bash
#
# Did a link-preview crawler actually reach us?
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
#
# `src/lib/crawler-log.ts` (docs/178) logs a crawler that fetches the OG CARD
# route. It structurally cannot see the PAGE fetch: `/campaigns/[slug]` is ISR,
# so its server component does not run per request, and the only per-request
# hook above it is the middleware — which calls `checkRateLimitAsync` as its
# first statement, so widening its matcher would put rate limiting on the
# busiest public route (docs/178 §3.1, docs/169).
#
# Cloudflare sits in front of all of that. Since the apex was proxied again on
# 2026-11-07 (docs/179) its analytics sees every request, page fetches
# included — which is the discriminator the application log cannot reach:
#
#   page + card fetched  -> we are read end to end; the failure is on their side
#   page only            -> they read our HTML and extracted no og:image
#   nothing              -> they never reach us; the problem is upstream of us
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#
#   scripts/cf-crawler-reach.sh                      # last 30 minutes
#   scripts/cf-crawler-reach.sh 2026-11-07T13:35:00Z # explicit UTC start
#
# Needs a Cloudflare API token with Zone Analytics read for this zone. It is
# NEVER passed on the command line: in an agent session the network proxy
# injects it; outside one, export CF_API_TOKEN and it is sent as a bearer
# header.
#
# ⛔ Analytics begins when the proxy was turned on. It cannot answer about a
#    share from before that, and it is not a record of what Meta *rendered* —
#    only of what it asked us for.

set -uo pipefail

ZONE="${CF_ZONE_ID:-aa573b6d32540749f0a59edb26041f31}"   # lastdonor.org; useless without a token
SINCE="${1:-$(date -u -d '-30 min' +%Y-%m-%dT%H:%M:%SZ)}"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# ⛔ TWO dimensions, deliberately. Adding `edgeResponseStatus` as a third
# SILENTLY DROPS GROUPS from this sampled dataset — measured 2026-11-07 at one
# instant on one window: 17 groups / 2 crawlers with two dimensions, 15 / 1
# with three, and the row it dropped was the `facebookexternalhit` PAGE fetch,
# i.e. the single most important row this script exists to find. More
# dimensions returning fewer groups is counterintuitive, which is exactly why
# it is recorded here rather than left to be rediscovered. If you need the
# response status, ask for it in a query of its own.
QUERY="$(ZONE="$ZONE" SINCE="$SINCE" python3 -I - <<'PY'
import json, os
q = ('{viewer{zones(filter:{zoneTag:"%s"}){'
     'httpRequestsAdaptiveGroups(limit:200,filter:{datetime_geq:"%s"},'
     'orderBy:[count_DESC]){count dimensions{clientRequestPath userAgent}}'
     '}}}') % (os.environ['ZONE'], os.environ['SINCE'])
print(json.dumps({'query': q}))
PY
)"

AUTH=()
[ -n "${CF_API_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${CF_API_TOKEN}")

curl -s --max-time 30 -X POST 'https://api.cloudflare.com/client/v4/graphql' \
  -H 'Content-Type: application/json' "${AUTH[@]}" --data "$QUERY" > "$OUT"

RESP="$OUT" SINCE="$SINCE" python3 -I - <<'PY'
import json, os, re, sys

with open(os.environ['RESP'], encoding='utf-8') as fh:
    try:
        d = json.load(fh)
    except json.JSONDecodeError:
        print('query returned no JSON — check the token and network reachability')
        raise SystemExit(2)

if d.get('errors'):
    print('query failed:', [e.get('message') for e in d['errors']][:3])
    raise SystemExit(2)

rows = []
for z in ((d.get('data') or {}).get('viewer') or {}).get('zones') or []:
    rows += z.get('httpRequestsAdaptiveGroups') or []

print("window start %s - %d request groups at the edge" % (os.environ['SINCE'], len(rows)))

# ⛔ ANTI-VACUITY GUARD. "no crawler reached us" and "this query saw nothing at
# all" are different answers that look identical, and conflating them is how a
# broken probe gets reported as a finding. Refuse to answer on an empty read.
if not rows:
    print()
    print('  ⛔ ZERO groups. This is NOT evidence that no crawler came.')
    print('     The window may predate the proxy being enabled, the token may')
    print('     lack Zone Analytics read, or the zone id may be wrong.')
    raise SystemExit(3)

CRAWLERS = re.compile(
    r'whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|'
    r'linkedinbot|slackbot|slack-imgproxy|discordbot|skypeuripreview|'
    r'applebot|redditbot|pinterest|googlebot|bingbot|duckduckbot|yandexbot|'
    r'gptbot|oai-searchbot|chatgpt-user|claudebot|perplexitybot|'
    r'meta-externalagent',
    re.I,
)

hits = [r for r in rows if CRAWLERS.search(r['dimensions'].get('userAgent') or '')]
print('%d of them from a recognised crawler' % len(hits))
print()

for r in sorted(hits, key=lambda x: -x['count']):
    path = r['dimensions'].get('clientRequestPath') or '?'
    agent = (r['dimensions'].get('userAgent') or '?')[:70]
    print('  %5d  %-46s  %s' % (r['count'], path, agent))

if not hits:
    print('  -> no recognised crawler reached the edge in this window')
    print('     (the groups above were real traffic, so this is a genuine negative)')
PY
