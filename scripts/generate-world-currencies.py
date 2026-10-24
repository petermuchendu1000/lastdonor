#!/usr/bin/env python3
"""
Generate the world currency / country / timezone tables.

    python3 -I scripts/generate-world-currencies.py

Emits three files, each with its provenance in the header:

  src/lib/money/world-currencies.generated.ts   currency -> exponent
  src/lib/geo/country-currency.generated.ts     ISO 3166 alpha-2 -> currency
  src/lib/geo/timezone-country.generated.ts     IANA zone -> ISO 3166 alpha-2

WHY GENERATED AND NOT HAND-WRITTEN

150-odd currencies means 150 exponents, and an exponent that is wrong by one
is a money figure wrong by a factor of ten. KWD, BHD, JOD, OMR and TND are
THREE-decimal; JPY, UGX, RWF, XOF, XAF, CLP, ISK, VND and about 20 others are
ZERO-decimal. A hand-typed table gets some of those wrong, and nothing would
notice until a gateway was wired.

SOURCES, AND WHY EACH

  1. Unicode CLDR `currencyData.json`, pinned at cldr-core@46.
     Country -> currency, keyed by ISO 3166 alpha-2, with `_from` / `_to` /
     `_tender` so the CURRENT legal tender is selectable rather than guessed.

     The obvious alternative - the official ISO 4217 register - keys its
     entries by country NAME, not code. Joining those names against ICU's
     region names was MEASURED at 196 of 280, with 84 misses including the
     United Arab Emirates, United Kingdom, Netherlands, Russia, South Korea,
     Hong Kong and the Philippines. A name join would have assigned the wrong
     currency to major countries silently, so it was rejected.

  2. The official ISO 4217 register, for minor units (`CcyMnrUnts`).
     Authoritative and dated: the file carries its own `Pblshd` attribute.

  3. IANA `zone1970.tab` from the canonical tz repository, for
     timezone -> country. The first code in its country field is the
     zone's primary country.

Every exponent emitted here is cross-checked against this runtime's own ICU
data by `src/lib/money/world-currencies.test.ts`, which fails on any
disagreement. Two independent sources, and the check keeps running rather
than happening once.
"""

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

CLDR_VERSION = "46"
CLDR_URL = f"https://cdn.jsdelivr.net/npm/cldr-core@{CLDR_VERSION}/supplemental/currencyData.json"
ISO_URL = "https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml"
TZ_URL = "https://raw.githubusercontent.com/eggert/tz/main/zone.tab"
TZ_LINKS_URL = "https://raw.githubusercontent.com/eggert/tz/main/backward"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> int:
    today = date.today().isoformat()

    # ── 1. ISO 4217: minor units ────────────────────────────────────────────
    iso_xml = get(ISO_URL)
    iso_root = ET.fromstring(iso_xml)
    iso_published = iso_root.attrib.get("Pblshd", "unknown")
    minor_units: dict[str, int] = {}
    for e in iso_root.findall(".//CcyNtry"):
        ccy = e.findtext("Ccy")
        mnr = e.findtext("CcyMnrUnts")
        if not ccy or mnr is None:
            continue
        # "N.A." marks metals and funds codes (XAU, XDR...). Not transactable.
        if not mnr.strip().isdigit():
            continue
        minor_units[ccy.strip()] = int(mnr)

    # ── 2. CLDR: country -> current legal tender ────────────────────────────
    cldr = json.loads(get(CLDR_URL))
    supp = cldr["supplemental"]
    cldr_ver = supp.get("version", {}).get("_cldrVersion", CLDR_VERSION)
    regions = supp["currencyData"]["region"]

    country_currency: dict[str, str] = {}
    for cc, history in sorted(regions.items()):
        if len(cc) != 2 or not cc.isalpha() or not cc.isupper():
            continue  # skip groupings like "ZZ" style or numeric regions
        current = None
        for entry in history:
            for code, meta in entry.items():
                if meta.get("_tender") == "false":
                    continue
                if "_to" in meta:
                    continue  # withdrawn
                if code not in minor_units:
                    continue  # no ISO minor units -> not transactable
                if current is None:
                    current = code
        if current:
            country_currency[cc] = current

    # Currencies we actually reference: those that are some country's tender.
    used = sorted(set(country_currency.values()))

    # ── 2b. CLDR display digits, and where they DISAGREE with ISO ───────────
    #
    # These two sources answer different questions and both are right.
    #
    #   ISO `CcyMnrUnts`  - the LEGAL definition of the minor unit.
    #   CLDR `fractions`  - how many digits are actually WRITTEN in practice.
    #
    # They differ for 13 currencies whose minor unit has fallen out of use:
    # the Iraqi fils, Albanian qindarke, Afghan pul, Somali cent and so on.
    # ISO still defines them; nobody quotes them.
    #
    # This table is for DISPLAY, so CLDR governs it. The ISO figure is
    # emitted alongside, because the day a gateway is wired for one of these
    # the question "which convention does the provider use" has to be
    # answered deliberately - getting it wrong is a figure out by 10x or
    # 100x. A test refuses to let any of them become collectable until then.
    fractions = supp["currencyData"]["fractions"]
    default_digits = int(fractions.get("DEFAULT", {}).get("_digits", 2))

    def display_digits(code: str) -> int:
        entry = fractions.get(code)
        if isinstance(entry, dict) and "_digits" in entry:
            return int(entry["_digits"])
        return default_digits

    divergences = sorted(
        (c, display_digits(c), minor_units[c])
        for c in used
        if display_digits(c) != minor_units[c]
    )

    # ── 3. IANA: timezone -> country ────────────────────────────────────────
    #
    # `zone.tab`, NOT `zone1970.tab`, and the choice is deliberate.
    #
    # IANA marks zone.tab obsolescent and points at zone1970.tab, which is
    # right for timekeeping and wrong for this. zone1970 deliberately MERGES
    # countries whose clocks have agreed since 1970: Uganda and Kenya share
    # `Africa/Nairobi` there, so a phone in Kampala resolves to Kenya and a
    # visitor in Uganda would be shown shillings of the wrong country.
    # zone.tab keeps one zone per country - `UG Africa/Kampala` - which is
    # exactly the question being asked here. It also has 418 entries, the
    # same number ICU knows, where zone1970 has 312.
    tz_text = get(TZ_URL).decode("utf-8")
    tz_country: dict[str, str] = {}
    for line in tz_text.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        code, _coords, zone = parts[0].strip(), parts[1], parts[2].strip()
        if len(code) == 2 and zone:
            tz_country[zone] = code

    # ── 3b. Backward-compatibility LINKS ───────────────────────────────────
    #
    # zone1970.tab lists only CANONICAL zones - 312 of them. ICU knows 418,
    # and the extra 106 are aliases that real systems report: a phone in
    # Uganda says `Africa/Kampala`, not `Africa/Nairobi`, and ICU does NOT
    # canonicalize it (measured: `resolvedOptions().timeZone` returns
    # `Africa/Kampala` unchanged). Without the links, every visitor in those
    # zones would be undetectable.
    #
    # Applied ONLY where zone.tab has not already answered, and the order
    # matters. A link means "the same clock", NOT "the same country":
    # `Africa/Kampala` is a link to `Africa/Nairobi`, so inheriting the
    # target's country would say Kenya. zone.tab supplies Kampala -> UG
    # first, so the links are left filling genuine RENAMES - Asia/Calcutta
    # to Asia/Kolkata, Europe/Kiev to Europe/Kyiv - where the country is the
    # same by construction. The generator's own sanity gate below caught this
    # the first time it was written the other way round.
    links_text = get(TZ_LINKS_URL).decode("utf-8")
    link_count = 0
    for line in links_text.splitlines():
        if not line.startswith("Link"):
            continue
        parts = line.split()
        if len(parts) < 3:
            continue
        target, alias = parts[1], parts[2]
        if alias in tz_country:
            continue  # zone.tab already knows this one, and knows better
        country = tz_country.get(target)
        if country:
            tz_country[alias] = country
            link_count += 1

    # ── sanity gates: refuse to emit a table that is obviously broken ───────
    problems = []
    for must in ("US", "KE", "GB", "AE", "NL", "RU", "KR", "JP", "UG", "KW"):
        if must not in country_currency:
            problems.append(f"country {must} missing")
    for cc, expect in (("US", "USD"), ("KE", "KES"), ("JP", "JPY"), ("UG", "UGX"), ("KW", "KWD"), ("GB", "GBP")):
        if country_currency.get(cc) != expect:
            problems.append(f"{cc} -> {country_currency.get(cc)} (expected {expect})")
    for ccy, expect in (("USD", 2), ("KES", 2), ("JPY", 0), ("UGX", 0), ("KWD", 3), ("BHD", 3)):
        if minor_units.get(ccy) != expect:
            problems.append(f"{ccy} ISO minor units {minor_units.get(ccy)} (expected {expect})")
        if display_digits(ccy) != expect:
            problems.append(f"{ccy} CLDR digits {display_digits(ccy)} (expected {expect})")
    # A currency the platform can already collect must not be one of the
    # ambiguous 13 - that would mean live money in a currency whose minor
    # unit two authorities disagree about.
    for ccy in ("USD", "KES"):
        if any(d[0] == ccy for d in divergences):
            problems.append(f"{ccy} is COLLECTABLE and ISO/CLDR disagree on its exponent")
    for zone, expect in (
        ("Africa/Nairobi", "KE"),
        ("Africa/Kampala", "UG"),   # a LINK, not a canonical zone
        ("Asia/Calcutta", "IN"),    # ditto
        ("Europe/Kiev", "UA"),      # ditto
    ):
        if tz_country.get(zone) != expect:
            problems.append(f"{zone} -> {tz_country.get(zone)} (expected {expect})")
    if len(country_currency) < 180:
        problems.append(f"only {len(country_currency)} countries - source shape changed?")
    if len(tz_country) < 400:
        problems.append(f"only {len(tz_country)} timezones - links not applied?")
    if problems:
        print("REFUSING TO EMIT:", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1

    banner = (
        "/*\n"
        " * GENERATED FILE - DO NOT EDIT BY HAND.\n"
        " *\n"
        f" *   python3 -I scripts/generate-world-currencies.py   (run {today})\n"
        " *\n"
        " * Sources, with their own publication dates:\n"
        f" *   Unicode CLDR {cldr_ver} (cldr-core@{CLDR_VERSION})  country -> currency\n"
        f" *   ISO 4217 register, published {iso_published}         minor units\n"
        " *   IANA zone1970.tab (canonical tz repo)              timezone -> country\n"
        " *\n"
        " * See scripts/generate-world-currencies.py for why each source was\n"
        " * chosen, and why the ISO register could NOT be used for the\n"
        " * country mapping (it keys on country NAME; the join measured\n"
        " * 196/280 with the UK, UAE, Netherlands and Russia among the misses).\n"
        " */\n\n"
    )

    # ── emit: currency -> exponent ─────────────────────────────────────────
    lines = [banner]
    lines.append("/**\n")
    lines.append(" * ISO 4217 code -> digits used when WRITING the amount (CLDR `fractions`).\n")
    lines.append(" *\n")
    lines.append(" * This is the DISPLAY exponent and it is what `Intl.NumberFormat` uses.\n")
    lines.append(" * For 13 currencies it is NOT the ISO legal minor unit - see\n")
    lines.append(" * EXPONENT_DIVERGENCES below.\n")
    lines.append(" */\n")
    lines.append("export const WORLD_CURRENCY_EXPONENTS: Readonly<Record<string, number>> =\n")
    lines.append("  Object.freeze({\n")
    for c in used:
        lines.append(f"    {c}: {display_digits(c)},\n")
    lines.append("  });\n\n")
    lines.append("/** ISO 4217 `CcyMnrUnts` - the LEGAL minor unit, for the divergent cases. */\n")
    lines.append("export const ISO_MINOR_UNITS: Readonly<Record<string, number>> =\n")
    lines.append("  Object.freeze({\n")
    for c in used:
        lines.append(f"    {c}: {minor_units[c]},\n")
    lines.append("  });\n\n")
    lines.append("/**\n")
    lines.append(" * Currencies where CLDR and ISO DISAGREE about the minor unit.\n")
    lines.append(" *\n")
    lines.append(" * Both are correct about different things: ISO defines the subunit,\n")
    lines.append(" * CLDR records that nobody quotes it. Displaying these with the ISO\n")
    lines.append(" * digits would print fils and qindarka that no price ever uses.\n")
    lines.append(" *\n")
    lines.append(" * NONE of these may become a COLLECTABLE currency until somebody has\n")
    lines.append(" * checked which convention the gateway expects. A test enforces that.\n")
    lines.append(" */\n")
    lines.append("export const EXPONENT_DIVERGENCES: ReadonlyArray<\n")
    lines.append("  Readonly<{ code: string; cldrDigits: number; isoMinorUnits: number }>\n")
    lines.append("> = Object.freeze([\n")
    for c, cldr_d, iso_d in divergences:
        lines.append(f"    Object.freeze({{ code: '{c}', cldrDigits: {cldr_d}, isoMinorUnits: {iso_d} }}),\n")
    lines.append("  ]);\n")
    with open("src/lib/money/world-currencies.generated.ts", "w", encoding="utf8") as f:
        f.write("".join(lines))

    # ── emit: country -> currency ─────────────────────────────────────────
    lines = [banner]
    lines.append("/** ISO 3166-1 alpha-2 -> the country's current legal tender (ISO 4217). */\n")
    lines.append("export const COUNTRY_CURRENCY: Readonly<Record<string, string>> =\n")
    lines.append("  Object.freeze({\n")
    for cc in sorted(country_currency):
        lines.append(f"    {cc}: '{country_currency[cc]}',\n")
    lines.append("  });\n")
    with open("src/lib/geo/country-currency.generated.ts", "w", encoding="utf8") as f:
        f.write("".join(lines))

    # ── emit: timezone -> country ────────────────────────────────────────
    lines = [banner]
    lines.append("/**\n")
    lines.append(" * IANA timezone -> ISO 3166-1 alpha-2 of its PRIMARY country.\n")
    lines.append(" *\n")
    lines.append(" * A zone can span several countries (Africa/Abidjan covers a dozen);\n")
    lines.append(" * zone1970.tab lists them and the first is the primary one. So a\n")
    lines.append(" * timezone narrows the country but does not always determine it.\n")
    lines.append(" */\n")
    lines.append("export const TIMEZONE_COUNTRY: Readonly<Record<string, string>> =\n")
    lines.append("  Object.freeze({\n")
    for z in sorted(tz_country):
        lines.append(f"    '{z}': '{tz_country[z]}',\n")
    lines.append("  });\n")
    with open("src/lib/geo/timezone-country.generated.ts", "w", encoding="utf8") as f:
        f.write("".join(lines))

    print(f"currencies: {len(used)}")
    print(f"ISO/CLDR exponent divergences: {len(divergences)} -> " + ", ".join(d[0] for d in divergences))
    print(f"countries:  {len(country_currency)}")
    print(f"timezones:  {len(tz_country)} (incl. {link_count} backward links)")
    print(f"cldr:       {cldr_ver}")
    print(f"iso 4217:   published {iso_published}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
