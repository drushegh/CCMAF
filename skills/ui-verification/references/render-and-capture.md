# Rendering and capturing

The mechanics of turning a UI into an image you can look at. Playwright (Chromium
headless) is the default for anything web/HTML; the principles transfer to other
capture tools.

## Capture a page at a real viewport

```javascript
import { chromium, devices } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // phone
const page = await ctx.newPage();
await page.goto('http://localhost:3000/checkout');
await page.getByRole('button', { name: 'Pay' }).waitFor(); // wait for a real signal
await page.screenshot({ path: 'checkout-mobile.png', fullPage: true });
await browser.close();
```

- **Viewport is the whole point.** Capture at the widths that matter — at
  minimum a phone (~390×844) and a desktop (~1280–1440 wide); add tablet
  (~768) and the project's breakpoints. A desktop-only screenshot hides most
  layout and reach bugs.
- **Device descriptors** set viewport + DPR + user-agent together:
  `browser.newContext({ ...devices['iPhone 15'] })`.
- **`fullPage: true`** captures the entire scroll height (good for reviewing the
  whole screen); omit it to capture just the viewport (good for "above the
  fold" / first impression).

## Capture a single element or region

```javascript
await page.locator('.pricing-card').screenshot({ path: 'card.png' });
await page.screenshot({ path: 'hero.png', clip: { x: 0, y: 0, width: 1280, height: 600 } });
```

Element shots are ideal for reviewing one component in isolation and for tight
visual-regression baselines.

## Wait for the truth before you capture

A screenshot taken too early critiques a lie. Before capturing:

- **Fonts loaded** — `await page.evaluate(() => document.fonts.ready);` (web
  fonts shift layout when they swap in).
- **Content settled** — wait for the real signal: a visible selector
  (`locator.waitFor()`) or a specific response. Avoid `waitUntil: 'networkidle'`
  (Playwright discourages it as unreliable) and never a fixed `sleep`.
- **Animations off** — Playwright's screenshot assertions disable animations
  (`animations: 'disabled'`); for raw `screenshot()`, inject a stylesheet that
  zeroes transitions/animations, or wait for them to finish. Capturing
  mid-transition produces blurry, non-deterministic images.

```javascript
await page.addStyleTag({ content: `*,*::before,*::after{
  animation-duration:0s!important; transition-duration:0s!important; }` });
await page.evaluate(() => document.fonts.ready);
```

## Themes, states and motion

- **Theme**: `browser.newContext({ colorScheme: 'dark' })` to capture dark mode;
  capture both if the app supports them.
- **States**: drive the UI into each state (empty/loading/error/populated) before
  shooting — interact, mock the response, or load the relevant fixture (see
  `state-and-viewport-coverage.md`).
- **Reduced motion / locale / RTL**: `reducedMotion`, `locale`, and a `dir="rtl"`
  pass catch a class of layout bugs.

## In this environment

You can render and **view** directly: drive a headless browser (Playwright, or
the Chrome tools), save the PNG, then open the image to look at it — the capture
is only useful once you actually view it (`the-critique-loop.md`). For a static
HTML file, serve it (or `file://`) and screenshot the same way. Test
infrastructure and CI wiring → `testing-development`.
