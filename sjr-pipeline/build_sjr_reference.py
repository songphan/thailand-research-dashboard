#!/usr/bin/env python3
"""
build_sjr_reference.py

Parse SCImago Journal Rank (SJR) yearly CSV exports into a compact reference
the dashboard can bundle, mapping each journal ISSN to its quartile per year.

Input  : sjr/*.csv  (one Scimago "Download data" export per year, e.g. 2020..2025)
Output : src/data/sjr_ranking.json

Output schema (compact, for the live in-browser bundle):
    {
      "years":  [2020, 2021, 2022, 2023, 2024, 2025],
      "issn":   { "1234-5678": "111223", ... },   # one digit per year, in `years` order
      "meta":   { "source": "...", "rule": "best_quartile", "generated": "...",
                  "perYearCount": {"2020": 28000, ...}, "issnCount": 41000 }
    }

The per-ISSN value is a fixed-length string with one character per year in
`years` order: '1'..'4' = Q1..Q4 (SJR Best Quartile), '0' = the journal was not
ranked / not present that year. This keeps the bundle small and lookup trivial:
quartile = value[ years.indexOf(publication_year) ].

Notes
- Scimago exports are semicolon-delimited. The ISSN column packs one or more
  bare 8-digit ISSNs (no hyphen), comma-separated; we normalise to XXXX-XXXX.
- Quartile is taken from the "SJR Best Quartile" column per the locked decision
  (the journal's strongest Scopus category).
- Year is inferred from the filename (a 4-digit 2015..2026) when possible, else
  from a "Total Docs. (YYYY)" style column header.
- This step needs no network; run it wherever the sjr/ CSVs live.
"""

import csv
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SJR_DIR = os.path.join(PROJECT, "sjr")
OUT_PATH = os.path.join(PROJECT, "src", "data", "sjr_ranking.json")

YEAR_RE = re.compile(r"\b(20(?:1[5-9]|2[0-6]))\b")  # 2015..2026
QUARTILE_RE = re.compile(r"\bQ([1-4])\b", re.IGNORECASE)


def log(*args):
    print(*args, file=sys.stderr)


def norm_issn(token):
    """Return a hyphenated 8-char ISSN (XXXX-XXXX) or None."""
    if not token:
        return None
    s = re.sub(r"[^0-9Xx]", "", token).upper()
    if len(s) != 8:
        return None
    return s[:4] + "-" + s[4:]


def extract_issns(field):
    """Pull every 8-char ISSN out of a Scimago ISSN cell."""
    if not field:
        return []
    out = []
    for tok in re.split(r"[,\s;]+", field):
        n = norm_issn(tok)
        if n:
            out.append(n)
    return out


def year_from_filename(name):
    m = YEAR_RE.search(name)
    return int(m.group(1)) if m else None


def detect_columns(header):
    """Map needed fields to column indices by fuzzy header match."""
    lower = [h.strip().lower() for h in header]
    cols = {"issn": None, "quartile": None, "title": None, "rank": None, "docyear": None}
    for i, h in enumerate(lower):
        if cols["issn"] is None and "issn" in h:
            cols["issn"] = i
        if cols["quartile"] is None and "best quartile" in h:
            cols["quartile"] = i
        if cols["title"] is None and h == "title":
            cols["title"] = i
        if cols["rank"] is None and h == "rank":
            cols["rank"] = i
        # "Total Docs. (2024)" lets us recover the year if the filename lacks it.
        if cols["docyear"] is None and "total docs" in h:
            ym = YEAR_RE.search(h)
            if ym:
                cols["docyear"] = int(ym.group(1))
    return cols


def sniff_delimiter(sample):
    # Scimago uses ';'. Fall back to ',' or tab if a row has more of those.
    counts = {";": sample.count(";"), ",": sample.count(","), "\t": sample.count("\t")}
    return max(counts, key=counts.get)


def parse_file(path):
    """Return (year, {issn: quartile_num}) for one Scimago CSV, or (None, {})."""
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        first = f.readline()
        delim = sniff_delimiter(first)
        f.seek(0)
        reader = csv.reader(f, delimiter=delim)
        try:
            header = next(reader)
        except StopIteration:
            log(f"  ! {os.path.basename(path)}: empty file, skipping")
            return None, {}
        cols = detect_columns(header)
        if cols["issn"] is None or cols["quartile"] is None:
            log(f"  ! {os.path.basename(path)}: could not find ISSN and/or "
                f"'SJR Best Quartile' columns (headers: {header[:8]}...), skipping")
            return None, {}

        year = year_from_filename(os.path.basename(path)) or cols["docyear"]
        if not year:
            log(f"  ! {os.path.basename(path)}: could not determine year from "
                f"filename or columns, skipping")
            return None, {}

        issn_q = {}
        rows = 0
        ranked = 0
        for row in reader:
            if not row or len(row) <= cols["quartile"]:
                continue
            rows += 1
            qm = QUARTILE_RE.search(row[cols["quartile"]] or "")
            if not qm:
                continue
            q = int(qm.group(1))
            for issn in extract_issns(row[cols["issn"]]):
                # keep the strongest (lowest number) quartile if an ISSN repeats
                if issn not in issn_q or q < issn_q[issn]:
                    issn_q[issn] = q
                    ranked += 1
        log(f"  - {os.path.basename(path)}: year {year}, {rows} rows, "
            f"{len(issn_q)} ranked ISSNs")
        return year, issn_q


def main():
    sjr_dir = sys.argv[1] if len(sys.argv) > 1 else SJR_DIR
    out_path = sys.argv[2] if len(sys.argv) > 2 else OUT_PATH

    if not os.path.isdir(sjr_dir):
        log(f"ERROR: SJR folder not found: {sjr_dir}")
        log("Create it and add the Scimago yearly CSV exports "
            "(scimagojr.com -> journalrank.php -> Download data).")
        sys.exit(1)

    files = sorted(
        os.path.join(sjr_dir, f) for f in os.listdir(sjr_dir)
        if f.lower().endswith((".csv", ".txt"))
    )
    if not files:
        log(f"ERROR: no .csv files in {sjr_dir}")
        sys.exit(1)

    log(f"Reading {len(files)} file(s) from {sjr_dir}")
    by_year = {}   # year -> {issn: quartile_num}
    for path in files:
        year, issn_q = parse_file(path)
        if year is None:
            continue
        if year in by_year:
            # merge (e.g. two files for one year): keep strongest quartile
            for issn, q in issn_q.items():
                cur = by_year[year].get(issn)
                if cur is None or q < cur:
                    by_year[year][issn] = q
        else:
            by_year[year] = issn_q

    if not by_year:
        log("ERROR: no parseable Scimago files. Nothing written.")
        sys.exit(1)

    years = sorted(by_year.keys())
    all_issns = set()
    for y in years:
        all_issns.update(by_year[y].keys())

    # Build the compact per-ISSN quartile-per-year string.
    issn_map = {}
    for issn in all_issns:
        chars = []
        for y in years:
            q = by_year[y].get(issn)
            chars.append(str(q) if q else "0")
        s = "".join(chars)
        if s.strip("0"):  # skip ISSNs that are unranked in every year
            issn_map[issn] = s

    out = {
        "years": years,
        "issn": issn_map,
        "meta": {
            "source": "SCImago Journal Rank (SJR), https://www.scimagojr.com",
            "rule": "best_quartile",
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "perYearCount": {str(y): len(by_year[y]) for y in years},
            "issnCount": len(issn_map),
        },
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    log("")
    log(f"Wrote {out_path} ({size_kb:.0f} KB)")
    log(f"  years: {years}")
    log(f"  ranked ISSNs (any year): {len(issn_map)}")
    for y in years:
        log(f"  {y}: {len(by_year[y])} ranked journals")


if __name__ == "__main__":
    main()
