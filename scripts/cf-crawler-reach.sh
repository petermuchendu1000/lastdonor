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
# ── TWO INDEPENDENT PASSES, AND WHY ──────────────────────────────────────────
#
# ⛔ The first version of this script asked for ALL request groups at
# `limit: 200` with `orderBy: count_DESC` and filtered them in Python. On
# 2026-11-09 that returned exactly 200 groups and reported **0 Meta fetches**,
# and the real figure over the same window was **982 groups containing 4**.
# A single crawler fetch has `count: 1`, so descending order puts it LAST and
# the limit cuts it off first. The result read as a confident negative
# (docs/179 §6.3), and the only tell was that the group count equalled the
# limit I had chosen.
#
# So this now runs TWO passes that must agree:
#
#   BROAD    every group, high limit, filtered here. Refuses to answer if the
#            count equals the limit, because that means truncation.
#   TARGETED one server-side `userAgent_like` query per preview crawler, so a
#            match CANNOT be crowded out however much other traffic there is.
#            [VERIFIED 2026-11-09: `userAgent_like` works, and a fabricated
#            token returns 0 groups, so it discriminates.]
#
# A disagreement between them is reported loudly rather than resolved
# silently — it means one of the two mechanisms has changed behaviour.
#
# ⛔ `userAgent_like` IS CASE-SENSITIVE, and that cost a second false negative
# in this same file on the same day. The first draft of the targeted pass used
# an all-lowercase token list; [VERIFIED by paired query] `%whatsapp%` returns
# 0 groups while `%WhatsApp%` returns 2, and `%googlebot%` returns 0 while
# `%Googlebot%` returns 5. Eleven of the twelve tokens therefore matched
# nothing, which reads exactly like "no preview crawler came" — and the ONE
# that worked, `facebookexternalhit`, is genuinely lowercase in the real user
# agent, so it masked the cause. The tokens below carry the REAL
# capitalisation, taken from the live agent strings in `crawler-log.test.ts`.
# Only the cross-check against the broad pass caught it: the guard added for
# the previous mistake found the next one.
#
# ⚠️ Group counts depend on which dimensions you ask for. The same two
# WhatsApp requests are 2 groups with `{clientRequestPath userAgent}` and 1
# with `{userAgent}` alone, because the paths differ and the agent does not.
# That is aggregation, not a discrepancy — compare like with like.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#
#   scripts/cf-crawler-reach.sh                      # last 30 minutes
#   scripts/cf-crawler-reach.sh 2026-11-07T13:41:48Z # explicit UTC start
#
# Needs a Cloudflare API token with Zone Analytics read for this zone. It is
# NEVER passed on the command line: in an agent session the network proxy
# injects it; outside one, export CF_API_TOKEN and it is sent as a bearer
# header.
#
# ⛔ Analytics begins when the proxy was turned on, and the retention window is
#    finite. It cannot answer about a share from before either bound, and it is
#    not a record of what Meta *rendered* — only of what it asked us for.
#
# ⚠️ Mind whose traffic you are reading. A synthetic probe with a crawler user
#    agent is indistinguishable from a real one except by version string and
#    timing: `WhatsApp/2.23.20.0 A` is the fixture string in
#    `crawler-log.test.ts`, while a real client looked like
#    `WhatsApp/2.2642.101 W`. Set the window to start after your own probes.

set -uo pipefail

ZONE="${CF_ZONE_ID:-aa573b6d32540749f0a59edb26041f31}"   # lastdonor.org; useless without a token
SINCE="${1:-$(date -u -d '-30 min' +%Y-%m-%dT%H:%M:%SZ)}"
# Overridable so the truncation guard below can be PROVEN to fire — a guard
# that cannot be made to trigger is not a guard (docs/179 §6.3).
BROAD_LIMIT="${CF_BROAD_LIMIT:-10000}"
OUT="$(mktemp)"; TARGETED="$(mktemp)"
trap 'rm -f "$OUT" "$TARGETED"' EXIT

post() {  # $1 = JSON body, $2 = output file
  AUTH=()
  [ -n "${CF_API_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${CF_API_TOKEN}")
  curl -s --max-time 45 -X POST 'https://api.cloudflare.com/client/v4/graphql' \
    -H 'Content-Type: application/json' "${AUTH[@]}" --data "$1" > "$2"
}

# ⛔ TWO dimensions on the broad pass, deliberately. Adding `edgeResponseStatus`
# as a third SILENTLY DROPS GROUPS from this sampled dataset — measured
# 2026-11-07 at one instant on one window: 17 groups / 2 crawlers with two
# dimensions, 15 / 1 with three, and the row it dropped was the
# `facebookexternalhit` PAGE fetch. More dimensions returning fewer groups is
# backwards from how a GROUP BY behaves, which is why it is recorded here
# rather than left to be rediscovered. For a response status, ask in a query of
# its own, filtered by `clientRequestPath_like`.
BROAD_Q="$(ZONE="$ZONE" SINCE="$SINCE" LIM="$BROAD_LIMIT" python3 -I - <<'PY'
import json, os
q = ('{viewer{zones(filter:{zoneTag:"%s"}){'
     'httpRequestsAdaptiveGroups(limit:%s,filter:{datetime_geq:"%s"},'
     'orderBy:[count_DESC]){count dimensions{clientRequestPath userAgent}}'
     '}}}') % (os.environ['ZONE'], os.environ['LIM'], os.environ['SINCE'])
print(json.dumps({'query': q}))
PY
)"
post "$BROAD_Q" "$OUT"

# Targeted pass: one aliased sub-query per preview crawler, server-side filter.
TARGETED_Q="$(ZONE="$ZONE" SINCE="$SINCE" python3 -I - <<'PY'
import json, os
# REAL capitalisation - `userAgent_like` is case-sensitive (see header).
tokens = ['WhatsApp', 'facebookexternalhit', 'Facebot', 'TelegramBot',
          'Twitterbot', 'LinkedInBot', 'Slackbot', 'Discordbot',
          'SkypeUriPreview', 'Applebot', 'redditbot', 'Pinterest']
zone, since = os.environ['ZONE'], os.environ['SINCE']
parts = []
for i, t in enumerate(tokens):
    parts.append(
        'a%d: httpRequestsAdaptiveGroups(limit:200,filter:{datetime_geq:"%s",'
        'userAgent_like:"%%%s%%"},orderBy:[count_DESC])'
        '{count dimensions{clientRequestPath userAgent}}' % (i, since, t)
    )
q = '{viewer{zones(filter:{zoneTag:"%s"}){%s}}}' % (zone, ' '.join(parts))
print(json.dumps({'query': q}))
PY
)"
post "$TARGETED_Q" "$TARGETED"

BROAD="$OUT" TARGETED="$TARGETED" SINCE="$SINCE" LIM="$BROAD_LIMIT" python3 -I - <<'PY'
import json, os, re, sys

def load(path):
    with open(path, encoding='utf-8') as fh:
        try:
            return json.load(fh)
        except json.JSONDecodeError:
            print('query returned no JSON — check the token and network reachability')
            raise SystemExit(2)

broad = load(os.environ['BROAD'])
if broad.get('errors'):
    print('broad query failed:', [e.get('message') for e in broad['errors']][:3])
    raise SystemExit(2)

rows = []
for z in ((broad.get('data') or {}).get('viewer') or {}).get('zones') or []:
    rows += z.get('httpRequestsAdaptiveGroups') or []

limit = int(os.environ['LIM'])
print('window start %s - %d request groups at the edge' % (os.environ['SINCE'], len(rows)))

# ⛔ ANTI-VACUITY GUARD. "no crawler reached us" and "this query saw nothing at
# all" are different answers that look identical, and conflating them is how a
# broken probe gets reported as a finding. Refuse to answer on an empty read.
if not rows:
    print()
    print('  ⛔ ZERO groups. This is NOT evidence that no crawler came.')
    print('     The window may predate the proxy being enabled or fall outside')
    print('     the retention window, the token may lack Zone Analytics read,')
    print('     or the zone id may be wrong.')
    raise SystemExit(3)

# ⛔ TRUNCATION GUARD. This is the bug that produced a false negative on
# 2026-11-09 (docs/179 §6.3): a crawler fetch has count 1, so count_DESC puts
# it last and the limit cuts it off first.
if len(rows) >= limit:
    print()
    print('  ⛔ GROUP COUNT EQUALS THE LIMIT (%d) - the broad pass is TRUNCATED.' % limit)
    print('     A single crawler fetch has count 1 and sorts LAST, so it is the')
    print('     first thing dropped. Raise BROAD_LIMIT and run again.')
    raise SystemExit(4)

CRAWLERS = re.compile(
    r'whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|'
    r'linkedinbot|slackbot|slack-imgproxy|discordbot|skypeuripreview|'
    r'applebot|redditbot|pinterest|googlebot|bingbot|duckduckbot|yandexbot|'
    r'gptbot|oai-searchbot|chatgpt-user|claudebot|perplexitybot|'
    r'meta-externalagent',
    re.I,
)
PREVIEW = re.compile(
    r'whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|'
    r'linkedinbot|slackbot|discordbot|skypeuripreview|applebot|redditbot|'
    r'pinterest',
    re.I,
)

def key(r):
    return (r['dimensions'].get('clientRequestPath'), r['dimensions'].get('userAgent'))

hits = [r for r in rows if CRAWLERS.search(r['dimensions'].get('userAgent') or '')]
print('%d of them from a recognised crawler' % len(hits))
print()
for r in sorted(hits, key=lambda x: -x['count']):
    path = r['dimensions'].get('clientRequestPath') or '?'
    agent = (r['dimensions'].get('userAgent') or '?')[:70]
    mark = '<-- LINK PREVIEW' if PREVIEW.search(agent) else ''
    print('  %5d  %-46s  %-70s %s' % (r['count'], path, agent, mark))

if not hits:
    print('  -> no recognised crawler reached the edge in this window')
    print('     (the groups above were real traffic, so this is a genuine negative)')

# ── reconcile against the targeted pass ──────────────────────────────────────
targeted = load(os.environ['TARGETED'])
if targeted.get('errors'):
    print()
    print('  ⚠ targeted pass failed, so the broad pass is UNCONFIRMED:',
          [e.get('message') for e in targeted['errors']][:2])
    raise SystemExit(0)

t_rows = []
for z in ((targeted.get('data') or {}).get('viewer') or {}).get('zones') or []:
    for v in z.values():
        if isinstance(v, list):
            t_rows += v

broad_preview = {key(r) for r in rows if PREVIEW.search(r['dimensions'].get('userAgent') or '')}
t_preview = {key(r) for r in t_rows}

print()
print('cross-check: broad pass found %d link-preview group(s), server-side filter found %d'
      % (len(broad_preview), len(t_preview)))

# ⛔ The two directions mean DIFFERENT things and must not share an exit code.
#
# targeted \ broad  -> the BROAD pass missed a real fetch. That is the serious
#                      one: it is the failure mode that produced a confident
#                      false negative, so refuse to answer.
# broad \ targeted  -> the TARGETED pass missed it, almost always because this
#                      crawler's token is capitalised differently from the list
#                      above. The broad pass is truncation-guarded, so its
#                      answer still stands - warn and name what to fix.
missed_by_broad = t_preview - broad_preview
if missed_by_broad:
    print('  ⛔ THE BROAD PASS MISSED THESE - treat its answer as unreliable:')
    for path, agent in sorted(missed_by_broad):
        print('     %-46s  %s' % (path, (agent or '?')[:70]))
    raise SystemExit(5)

missed_by_targeted = broad_preview - t_preview
if missed_by_targeted:
    print('  ⚠ the server-side filter missed these, so its token casing is')
    print('     wrong for them (userAgent_like is case-sensitive). The broad')
    print('     pass is truncation-guarded, so the list above still stands:')
    for path, agent in sorted(missed_by_targeted):
        print('     %-46s  %s' % (path, (agent or '?')[:70]))
    raise SystemExit(0)

print('  the two passes agree.')
PY
