# 3D, canvas and non-web UI

The render-and-look loop extends beyond web pages — to canvas/WebGL scenes,
games, and native apps — but with different capture methods and **honest
limits** on what a still image can tell you.

## Canvas and WebGL (three.js, game canvas)

A `<canvas>` renders pixels, so a screenshot captures it like any element — but
timing and readback matter:

- Capture *after* a frame has drawn. For WebGL, the drawing buffer may be empty
  on read unless `preserveDrawingBuffer: true` or you screenshot right after a
  render tick. Playwright's element screenshot of the canvas works once content
  is on screen:

```javascript
await page.goto('/scene');
await page.waitForFunction(() => window.__sceneReady === true);
await page.locator('canvas').screenshot({ path: 'scene.png' });
```

- Assess the still for **composition and readability**: is the subject framed,
  is there enough contrast/lighting to read the scene, is UI legible over the 3D,
  is anything clipped by the camera? (Scene/asset specifics →
  `threejs-development`.)

## Motion needs a sequence, not a frame

A single still can't show whether motion *reads* well. Capture a **short
sequence** — frames at intervals, or a video/GIF — and view them in order to
judge: does the animation arc make sense, is the easing smooth or abrupt, does
the object move the expected distance, is there enough anticipation/follow-
through? Playwright can record video of a context (`recordVideo`); engines can
dump frames. You're approximating motion review from samples — useful, not
complete.

## Native mobile / desktop apps

- **iOS/Android**: capture from the simulator/emulator (`xcrun simctl io …
  screenshot`, `adb exec-out screencap`), or the platform's UI-test screenshot
  APIs. Review layout/states the same way as web.
- **Desktop**: the app's own screenshot tooling or an OS capture.
- Platform-build specifics → `ios-development` / `android-development` / the
  desktop skill; this skill owns the *review*.

## The honest limits

A captured image (or even a clip) **cannot** fully convey:

- **Real-time feel and latency** — whether a control feels responsive or laggy,
  whether a jump feels right (→ `game-feel`).
- **Native gestures and haptics** — swipe physics, momentum, force feedback.
- **Audio-visual sync** and the felt sense of "juice".

For these, the reliable path is **a human in the loop**: have the person play/
use it briefly and report, or hand you a clip to critique against principles.
State this limit plainly rather than implying a screenshot verified the feel —
overclaiming here is worse than admitting the boundary.

## Practical stance

Use the loop wherever you *can* render: web and canvas stills are genuinely
checkable and catch most layout/readability problems. For motion, sample frames.
For real-time feel and native interaction, combine encoded principles
(`game-feel`, `ux-design`) with human playtesting — don't pretend the still did
the job.
