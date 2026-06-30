# Dynamic pages with Playwright

When content is rendered by JavaScript (SPAs, lazy-loaded data, content behind
interaction), a plain HTTP fetch returns an empty shell. A headless browser
executes the JS and gives you the rendered DOM — at 10–100× the cost of an HTTP
request, so use it **only** for pages that need it.

## First: can you skip the browser?

A "dynamic" page almost always fetches its data from an **API/XHR endpoint**.
Open dev tools → Network → Fetch/XHR, find the JSON call, and request it
directly with httpx. That's faster, cheaper and more stable than driving a
browser. Reserve Playwright for pages where the data is genuinely only
available post-render or behind interaction.

## Playwright (Python) pattern

```python
from playwright.sync_api import sync_playwright

def scrape(url: str):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="MyScraper/1.0 (+https://example.com/bot-info)")
        page.goto(url, wait_until="domcontentloaded")
        # Wait for real content, not a fixed sleep
        page.wait_for_selector("article.product")
        html = page.content()
        browser.close()
        return html
```

Key practices:

- **Wait for content, never `sleep()`** — `wait_for_selector` /
  `wait_for_load_state`; Playwright auto-waits for elements.
- `wait_until="domcontentloaded"` or `"networkidle"` deliberately;
  `networkidle` is slower and can hang on long-polling sites.
- Reuse a **browser context** across pages; don't launch a browser per URL.
- Block images/fonts/media you don't need to cut bandwidth and time
  (route interception), and cap concurrency — browsers are heavy.
- Run headless in CI with `playwright install --with-deps chromium`.

## Intercept network instead of parsing DOM

Even with Playwright open, you can grab the clean API response rather than
scraping rendered HTML:

```python
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    captured = []
    page.on("response", lambda r: captured.append(r.url) if "/api/" in r.url else None)
    page.goto("https://example.com/products")
    # then fetch/inspect the captured JSON endpoints directly
```

## Interaction

For login, infinite scroll, "load more" or filters, drive the page with
role/text locators (same resilient-locator discipline as
`testing-development`'s e2e-playwright), then read the result. Persist auth via
`storage_state` to avoid re-logging-in — but only where the ToS permits
automated authenticated access.

## When to stop

If a site needs heavy fingerprint evasion or solving CAPTCHAs to proceed,
that's a strong signal you're unwelcome. Escalate to a licensed data provider /
managed service (Nimble, commercial scraping APIs) or reconsider — don't build
a brittle evasion arms race. The Scrapy + scrapy-playwright hybrid
(`scrapy-framework.md`) is the route for crawls that mix static and JS pages.
