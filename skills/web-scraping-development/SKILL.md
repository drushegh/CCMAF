---
name: web-scraping-development
description: >-
  Engineering web scrapers and crawlers responsibly: the legal/ethical gate
  (robots.txt, ToS, rate limiting, PII/GDPR), API-first checking, HTTP
  scraping and HTML parsing (httpx, BeautifulSoup, lxml, parsel), dynamic
  JS-rendered sites with Playwright, the Scrapy framework (spiders, items,
  pipelines, middlewares, AutoThrottle), and resilience/anti-bot/operations.
  Use whenever a task involves extracting data from websites: "scrape",
  "crawl", "spider", BeautifulSoup, Scrapy, scrapy-playwright, "parse this
  HTML/page", "extract data from a site", paginating a site, or scheduled
  data collection. Triggers include scrapy.cfg, spiders/ files, and
  "the site has no API". PROACTIVELY activate to check for an official API
  and the legal/rate-limit position BEFORE writing a scraper.
---

# Web Scraping Development

Engineering data extraction from websites — responsibly and robustly. Scraping
is powerful and legally/ethically loaded; treat it as a **last resort after an
API**, and design it to be polite, resilient and maintainable. Default stack is
Python (httpx + BeautifulSoup/parsel for static, Playwright for dynamic,
Scrapy when it's a real crawl).

Tooling context (June 2026 — re-verify): Scrapy 2.11+ (Twisted-based; friction
with the asyncio ecosystem — see `scrapy-framework.md`); scrapy-playwright for
JS rendering inside Scrapy; Playwright (Python) for standalone dynamic scraping;
httpx for async HTTP; selectolax/parsel/lxml for fast parsing.

## Non-negotiables

1. **API first.** Before scraping, check for an official API, data export,
   RSS/sitemap, or a public dataset. An API is more stable, legal and polite
   than scraping HTML. Inspect the page's own XHR/fetch calls — the data often
   comes from a JSON endpoint you can call directly. (API consumption →
   `api-development`.)
2. **Respect robots.txt, ToS and the law.** Read `robots.txt` and the site's
   terms; don't scrape what they forbid. Scraping personal data engages GDPR
   (lawful basis, minimisation) — that's an obligation, not a footnote
   (→ `secure-development`). When in doubt, stop and ask.
3. **Be polite — rate-limit and identify yourself.** Throttle (delays +
   concurrency caps + backoff), honour `Retry-After`/429, scrape off-peak, set
   an honest, contactable `User-Agent`. Hammering a site is both rude and the
   fastest way to get blocked.
4. **Static before dynamic.** Use a plain HTTP request + HTML parse where it
   works; only spin up a headless browser (Playwright) for pages that genuinely
   need JS execution — browsers are 10–100× the cost.
5. **Resilient parsing.** Sites change; selectors break. Prefer stable hooks,
   validate extracted data, fail loudly on schema drift, and don't silently
   ingest garbage.
6. **No secrets/credentials abuse.** Don't bypass auth/paywalls or evade access
   controls; don't store scraped PII you don't have a basis to hold.
7. **Cache and don't re-fetch.** Cache responses during development and respect
   conditional requests in production — re-downloading the same page is waste
   and load.

## Decision tables

| Page type | Tool |
|---|---|
| Static HTML / server-rendered | httpx + **BeautifulSoup** or **parsel/lxml** (selectolax for speed) |
| Data behind a JSON/XHR endpoint | Call that endpoint directly with httpx (skip the HTML entirely) |
| JS-rendered / interaction needed | **Playwright** (Python); render then parse |
| A real crawl (many pages, rules, pipelines) | **Scrapy** (+ scrapy-playwright for the JS pages) |
| Industrial scale / heavy anti-bot | A managed service (Nimble, commercial) — know when to stop rolling your own |

## High-frequency pitfalls

- **Scraping when an API exists** — brittle, slower, often against ToS. Check first.
- **No rate limiting** — gets you blocked and harms the target; always throttle.
- **Browser for everything** — slow and resource-heavy; reserve Playwright for JS.
- **Fragile selectors** (deep CSS/positional XPath) — break on any redesign;
  anchor on stable attributes/text and validate output.
- **Ignoring pagination/dedup** — partial data or infinite loops; track visited
  URLs and termination.
- **Parsing HTML you should have read as JSON** — many "dynamic" sites expose a
  clean API the front-end calls.
- **Storing PII without a basis** — a compliance breach, not a data win.
- **Evasion arms race** — fingerprint/CAPTCHA evasion is brittle and often a
  signal you shouldn't be scraping that source; escalate to a service or stop.
- **One giant `parse()`** — no items/pipelines/validation; unmaintainable.

## Workflow

1. **Check for an API / dataset / sitemap first.** If found, stop scraping and
   use it.
2. Read `robots.txt` + ToS; assess the legal/PII position; decide go/no-go.
3. Inspect the page: is the data in the HTML, or in an XHR/JSON call? Prefer the
   endpoint.
4. Pick the lightest tool that works (static → dynamic → crawl framework).
5. Build polite (throttle, backoff, honest UA), with validated items and
   resilient selectors.
6. Add caching, retries, storage and monitoring; schedule; alert on schema
   drift and block rates.

## Reference index

Load on demand:

- `references/legality-ethics.md` — robots.txt, ToS, rate limiting, GDPR/PII, API-first
- `references/http-parsing.md` — httpx, BeautifulSoup/parsel/lxml, selectors, encodings, pagination
- `references/dynamic-playwright.md` — JS rendering, intercepting APIs, Playwright patterns
- `references/scrapy-framework.md` — spiders, items, pipelines, middlewares, AutoThrottle, scrapy-playwright
- `references/resilience-operations.md` — anti-bot, retries/backoff, caching, storage, scheduling, monitoring

## Boundaries

- **Live web data on demand** (the user's day-to-day fetch/search) → Nimble
  tooling; this skill is for *building* durable scrapers.
- **"Is there an API?" and calling it** → `api-development`.
- **AI enrichment/classification of scraped data** → `llm-development`.
- **Browser automation for test assertions** (not extraction) →
  `testing-development` (e2e-playwright) — shares Playwright, different intent.
- **GDPR/legal framework and PII handling** → `secure-development`;
  **storing/querying the data** → `sql-development`; **scheduled runs in CI** →
  `devops-development`.
