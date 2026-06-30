# HTTP fetching and HTML parsing

For static / server-rendered pages, a plain HTTP request plus an HTML parse is
the fastest, cheapest approach. Reach for a browser only when JS is essential
(`dynamic-playwright.md`).

## Fetching with httpx

`httpx` supports HTTP/2, connection pooling and async. Reuse a client, set a
timeout and an honest User-Agent, and handle status codes.

```python
import httpx

HEADERS = {"User-Agent": "MyScraper/1.0 (+https://example.com/bot-info)"}

with httpx.Client(headers=HEADERS, timeout=10.0, http2=True) as client:
    resp = client.get("https://example.com/products")
    resp.raise_for_status()
    html = resp.text
```

For volume, go async (`httpx.AsyncClient`) with a bounded semaphore so you
don't open unlimited connections — politeness and stability both demand a cap.

## Prefer the underlying JSON endpoint

If the page loads data via XHR/fetch, request that endpoint directly — no HTML
parsing, far less fragility:

```python
data = client.get("https://example.com/api/products?page=1").json()
```

Find it in dev tools → Network → Fetch/XHR. This is often the single biggest
robustness win.

## Parsing HTML

- **BeautifulSoup** — forgiving, readable; good default for one-off and
  moderate jobs (use the `lxml` parser for speed).
- **parsel** (Scrapy's selector lib) / **lxml** — CSS *and* XPath, fast; ideal
  in Scrapy or when you need XPath.
- **selectolax** — fastest for large-volume simple extraction.

```python
from bs4 import BeautifulSoup

soup = BeautifulSoup(html, "lxml")
for card in soup.select("article.product"):
    name = card.select_one("h2").get_text(strip=True)
    price = card.select_one(".price")
    yield {"name": name, "price": price.get_text(strip=True) if price else None}
```

```python
from parsel import Selector

sel = Selector(text=html)
names = sel.css("article.product h2::text").getall()
links = sel.xpath('//a[@class="next"]/@href').get()
```

## Resilient selectors

Sites change; brittle selectors are the main maintenance cost.

- Anchor on **stable attributes** (`data-*`, `id`, semantic class) or **text**,
  not deep positional chains (`div > div:nth-child(3) > span`).
- Guard every extraction — a missing element returns `None`, don't crash on
  `.text` of nothing.
- **Validate** extracted records (types, required fields) and treat a sudden
  rise in nulls/empties as **schema drift** — alert, don't silently store junk.

## Encodings and pagination

- Trust declared encoding but verify; let httpx/bs4 handle it, normalise to
  UTF-8, and beware mojibake from wrong charset assumptions.
- **Pagination**: prefer the site's "next" link or a page/cursor parameter;
  track visited URLs to avoid loops; define a clear termination (no next link,
  empty page, max pages). For infinite-scroll, find the backing API (it
  paginates) rather than scrolling a browser.
