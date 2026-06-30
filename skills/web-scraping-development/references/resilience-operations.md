# Resilience and operations

A scraper that runs once in a demo is easy; one that runs reliably for months
against a changing, defensive target is the real work.

## Retries and backoff

- Retry only **transient** failures (timeouts, 5xx, connection resets) with
  **exponential backoff + jitter**; cap attempts.
- **Honour `429` and `Retry-After`** — back off for the stated time; treat
  repeated 429s as "slow down or stop", not "retry harder".
- Don't retry `4xx` (except 429) — they won't fix themselves; log and move on.

```python
import httpx, time, random

def get_with_retry(client, url, attempts=4):
    for i in range(attempts):
        r = client.get(url)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 2 ** i)))
            continue
        if r.status_code < 500:
            return r
        time.sleep((2 ** i) + random.random())
    r.raise_for_status()
```

## Caching

Cache during development so you don't re-hit the site on every code change
(Scrapy `HTTPCACHE_ENABLED`, or a local cache for httpx). In production, use
conditional requests (`ETag`/`If-Modified-Since`) and only re-fetch what
changed.

## Anti-bot — and knowing when to stop

Sites defend with rate limits, fingerprinting, CAPTCHAs and IP blocks. Polite,
low-rate, honestly-identified scraping avoids most of it. Where you hit serious
defences:

- Rotating proxies and realistic pacing handle mild rate limits.
- **CAPTCHAs / aggressive fingerprinting / Cloudflare-style challenges** are a
  signal you're unwelcome. Building an evasion arms race is brittle, costly and
  often crosses an ethical/legal line. Prefer a **licensed data provider /
  managed scraping API** (Nimble, commercial) — or stop and seek the data
  another way.

## Storage and data quality

- Write structured, validated records (JSONL/Parquet for files; a DB for
  ongoing — `sql-development`). Don't dump raw HTML as your dataset.
- **Dedup** on a stable key; make re-runs idempotent (upsert, not blind
  append).
- Track **provenance**: source URL and fetch timestamp on every record.
- Monitor **data quality**: a spike in null/empty fields means the site changed
  — alert and fix the selectors, don't keep storing garbage.

## Scheduling and monitoring

- Schedule recurring crawls (cron / Azure / GitHub Actions — pipeline wiring →
  `devops-development`); stagger and off-peak where possible.
- Alert on: error/block rate, items-per-run dropping, schema-drift (null
  surge), and runtime blowing out.
- Log enough to debug (URL, status, item counts) without storing PII you don't
  need.

## Boundaries recap

Politeness/legality → `legality-ethics.md`; the actual fetch/parse →
`http-parsing.md` / `dynamic-playwright.md`; AI enrichment of results →
`llm-development`; on-demand live fetch (vs a built scraper) → Nimble tooling.
