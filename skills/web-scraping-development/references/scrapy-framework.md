# Scrapy framework

Scrapy is the tool when scraping becomes a real **crawl** — many pages,
following links, structured output, and cross-cutting concerns (throttling,
retries, dedup, pipelines) you'd otherwise rebuild. For a handful of pages,
httpx + a parser (`http-parsing.md`) is lighter.

## Architecture

- **Spider** — defines start URLs, how to parse responses, and which links to
  follow. Yields **items** (data) and **requests** (more pages).
- **Item / ItemLoader** — the structured record + extraction/cleaning rules.
- **Item pipeline** — post-processing: validation, dedup, storage (DB/file).
- **Middlewares** — downloader/spider hooks: headers, proxies, retries,
  caching.
- **Settings** — throttling, concurrency, retry, cache, pipelines.

```python
import scrapy

class ProductSpider(scrapy.Spider):
    name = "products"
    allowed_domains = ["example.com"]
    start_urls = ["https://example.com/products"]
    custom_settings = {
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_TARGET_CONCURRENCY": 1.0,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 4,
        "ROBOTSTXT_OBEY": True,
        "HTTPCACHE_ENABLED": True,
        "USER_AGENT": "MyScraper/1.0 (+https://example.com/bot-info)",
    }

    def parse(self, response):
        for card in response.css("article.product"):
            yield {
                "name": card.css("h2::text").get(),
                "price": card.css(".price::text").get(),
                "url": response.urljoin(card.css("a::attr(href)").get()),
            }
        next_page = response.css("a.next::attr(href)").get()
        if next_page:
            yield response.follow(next_page, callback=self.parse)
```

## Settings that make you a good citizen

- **`ROBOTSTXT_OBEY = True`** — honour robots.txt (on by default in new
  projects; keep it on).
- **`AUTOTHROTTLE_ENABLED = True`** — adapts delay to server response time;
  the single best politeness setting. Cap `CONCURRENT_REQUESTS_PER_DOMAIN`.
- **`RETRY_ENABLED`** + `RETRY_TIMES` for transient failures; **`HTTPCACHE_ENABLED`**
  so development doesn't re-hammer the site.
- **`DOWNLOAD_DELAY`** for a fixed floor; `DEPTH_LIMIT` to bound crawls.

## Validation and storage in pipelines

Keep parsing thin; validate and persist in an item pipeline (drop invalid
items, dedup on a key, write to DB/file). Feed exports (`-O items.jsonl`) cover
simple cases; a pipeline to a database (→ `sql-development`) for anything
ongoing.

## JS pages: scrapy-playwright

Scrapy's HTTP fetch can't run JS. **scrapy-playwright** lets a spider opt
specific requests into a Playwright-rendered fetch via request meta, while the
rest stay fast HTML requests:

```python
yield scrapy.Request(url, meta={"playwright": True}, callback=self.parse)
```

Only flag the pages that need rendering — rendering every page throws away
Scrapy's speed advantage (see `dynamic-playwright.md`).

## Note: Twisted vs asyncio

Scrapy is built on **Twisted**, which predates and sits awkwardly beside the
modern **asyncio** ecosystem (httpx, Playwright are asyncio-native). Scrapy
supports an asyncio reactor and scrapy-playwright bridges the gap, but expect
some friction. For greenfield async-heavy crawls, weigh Scrapy against
asyncio-native alternatives (e.g. Crawlee) — but Scrapy remains the most
batteries-included crawl framework, and its pipeline/middleware model is hard
to beat for structured crawls.
