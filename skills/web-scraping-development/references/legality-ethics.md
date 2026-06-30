# Legality, ethics and API-first

This comes **before** any code. Scraping touches contract (ToS), copyright, and
data-protection law, and it loads someone else's infrastructure. Get this right
or don't scrape.

## Check for an API first — always

Before writing a scraper, look for, in order:

1. An **official API** (REST/GraphQL) or developer programme.
2. A **bulk export / public dataset** (open data portals, `data.gov`-style).
3. A **sitemap.xml** / RSS / Atom feed for discovery.
4. The page's own **XHR/fetch calls** — open dev tools → Network; the data is
   frequently a clean JSON endpoint the front-end calls, which you can request
   directly with far less fragility than parsing HTML.

An API is more stable, more legal and more polite. Consuming it →
`api-development`.

## robots.txt and Terms of Service

- Read and honour **`robots.txt`** (`/robots.txt`): it states which paths and
  user-agents are disallowed and may set `Crawl-delay`. It's a standard of
  conduct; ignoring it is bad faith and evidence against you.

```python
import urllib.robotparser

rp = urllib.robotparser.RobotFileParser()
rp.set_url("https://example.com/robots.txt")
rp.read()
if not rp.can_fetch("MyScraper", "https://example.com/products"):
    raise SystemExit("Disallowed by robots.txt")
```

- Read the site's **Terms of Service**. Many prohibit automated access or
  reuse; a ToS prohibition is a real (contractual) constraint, not a
  formality. Public availability does not equal permission to copy or
  redistribute.

## Data protection (GDPR) and copyright

- Scraping **personal data** (names, emails, profiles) engages GDPR: you need a
  **lawful basis**, must minimise what you collect, honour retention limits,
  and be able to justify it. "It was on a public page" is not a lawful basis.
  Framework and obligations → `secure-development`.
- Scraped content is usually **copyrighted**; extracting facts differs from
  republishing content. Don't redistribute substantial copyrighted material.
- Special-category data, children's data, and circumventing access controls are
  hard lines — don't.

(Not legal advice; date-stamped June 2026 — the case law moves. For anything
commercial or large-scale, get a real legal view.)

## Be a good citizen

- **Rate-limit**: delays between requests, capped concurrency, exponential
  backoff, honour `429`/`Retry-After`. Scrape during off-peak hours.
- **Identify honestly**: a descriptive `User-Agent` with a contact URL/email.
  Don't impersonate a browser to deceive, and don't forge identities to evade
  blocks.
- **Take only what you need**, cache so you don't re-fetch, and stop if you're
  clearly unwelcome (hard blocks, CAPTCHAs everywhere) rather than escalating an
  evasion arms race.

## The go/no-go gate

Proceed only if: no suitable API exists, robots.txt/ToS permit it, you have a
lawful basis for any personal data, and you can scrape politely. If any of
those fails, use an API/dataset, seek permission, use a licensed data provider,
or don't do it.
