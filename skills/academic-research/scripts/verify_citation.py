#!/usr/bin/env python3
"""Verify a citation against real scholarly indexes before you cite it.

Queries Crossref, then OpenAlex, by DOI or title, and prints the canonical
record (title / authors / year / venue / DOI) or reports NOT FOUND. The
anti-fabrication guard for the academic-research skill: a reference that will
not resolve here is treated as fabricated until proven otherwise.

Usage:
  python3 verify_citation.py --doi 10.1145/3442188.3445922
  python3 verify_citation.py --title "Attention is all you need"
  python3 verify_citation.py --title "..." --email you@org.example   # polite pool

Exit codes: 0 verified · 1 not found / weak match (suspect) · 2 usage ·
3 network/unavailable (do NOT treat as verified). Stdlib only; needs network.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

TIMEOUT = 20


def _get(url, email):
    ua = "academic-research-skill/1.0 (citation-verifier; mailto:%s)" % (email or "anonymous@example.com")
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def _norm(s):
    return " ".join((s or "").lower().split())


def _ratio(a, b):
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


# ---- Crossref ----
def _cr_item(m):
    if not m:
        return None
    authors = ", ".join(
        " ".join(p for p in (a.get("given"), a.get("family")) if p) for a in m.get("author", [])
    ) or "—"
    year = ""
    dp = (m.get("issued") or {}).get("date-parts") or [[None]]
    if dp and dp[0] and dp[0][0]:
        year = str(dp[0][0])
    return {
        "title": (m.get("title") or ["—"])[0],
        "authors": authors,
        "year": year,
        "venue": (m.get("container-title") or [""])[0] or m.get("publisher", ""),
        "doi": m.get("DOI", ""),
        "source": "Crossref",
    }


def crossref_by_doi(doi, email):
    return _cr_item(_get("https://api.crossref.org/works/" + urllib.parse.quote(doi), email)["message"])


def crossref_by_title(title, email):
    q = urllib.parse.urlencode({"query.bibliographic": title, "rows": 5})
    items = _get("https://api.crossref.org/works?" + q, email).get("message", {}).get("items", [])
    best, score = None, 0.0
    for it in items:
        s = _ratio(title, (it.get("title") or [""])[0])
        if s > score:
            best, score = it, s
    return (_cr_item(best), score) if best else (None, 0.0)


# ---- OpenAlex ----
def _oa_item(w):
    if not w:
        return None
    authors = ", ".join(a.get("author", {}).get("display_name", "") for a in w.get("authorships", [])) or "—"
    src = (w.get("primary_location") or {}).get("source") or {}
    return {
        "title": w.get("title") or w.get("display_name") or "—",
        "authors": authors,
        "year": str(w.get("publication_year") or ""),
        "venue": src.get("display_name", "") or "",
        "doi": (w.get("doi") or "").replace("https://doi.org/", ""),
        "source": "OpenAlex",
    }


def openalex_by_doi(doi, email):
    url = "https://api.openalex.org/works/doi:" + urllib.parse.quote(doi)
    if email:
        url += "?mailto=" + urllib.parse.quote(email)
    return _oa_item(_get(url, email))


def openalex_by_title(title, email):
    q = urllib.parse.urlencode({"search": title, "per-page": 5})
    if email:
        q += "&mailto=" + urllib.parse.quote(email)
    results = _get("https://api.openalex.org/works?" + q, email).get("results", [])
    best, score = None, 0.0
    for it in results:
        s = _ratio(title, it.get("title") or it.get("display_name") or "")
        if s > score:
            best, score = it, s
    return (_oa_item(best), score) if best else (None, 0.0)


def _print(rec, confidence=None):
    for k in ("source", "title", "authors", "year", "venue", "doi"):
        print(f"  {k:7}: {rec[k]}")
    if confidence is not None:
        print(f"  match  : {confidence:.2f}")


def main():
    ap = argparse.ArgumentParser(description="Verify a citation exists in Crossref/OpenAlex.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--doi")
    g.add_argument("--title")
    ap.add_argument("--email", help="contact email (polite API pool)")
    ap.add_argument("--threshold", type=float, default=0.80, help="title-match threshold (default 0.80)")
    a = ap.parse_args()
    net_err = False

    if a.doi:
        doi = a.doi.strip().replace("https://doi.org/", "")
        for fn in (crossref_by_doi, openalex_by_doi):
            try:
                rec = fn(doi, a.email)
                if rec:
                    print("VERIFIED — DOI resolves to a real record:")
                    _print(rec)
                    return 0
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    continue
                net_err = True
            except Exception:
                net_err = True
        if net_err:
            print(f"UNKNOWN — could not reach an index to verify DOI {doi}. Do not treat as verified.")
            return 3
        print(f"NOT FOUND — DOI {doi} did not resolve in Crossref or OpenAlex. Treat as suspect/fabricated.")
        return 1

    title = a.title.strip()
    best = None
    for fn in (crossref_by_title, openalex_by_title):
        try:
            rec, score = fn(title, a.email)
            if rec and score >= a.threshold:
                print(f"VERIFIED — a matching record exists (match {score:.2f}):")
                _print(rec, score)
                return 0
            if rec and (best is None or score > best[1]):
                best = (rec, score)
        except Exception:
            net_err = True
    if best and best[0]:
        print(f"WEAK MATCH — closest record (match {best[1]:.2f} < {a.threshold:.2f}); verify by hand or use the DOI:")
        _print(best[0], best[1])
        return 1
    if net_err:
        print("UNKNOWN — could not reach an index. Do not treat as verified.")
        return 3
    print(f"NOT FOUND — no record matched '{title}'. Treat as suspect/fabricated.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
