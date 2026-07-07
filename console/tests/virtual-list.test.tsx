/**
 * virtual-list.test.tsx — programmatic vs USER scroll attribution.
 *
 * The list's own scrollTop writes (pin re-glue, prepend anchoring, RO height
 * compensation, scrollTo*) echo back as scroll events; before attribution
 * existed, such an echo could read a transient off-bottom position and report
 * atBottom=false — the owner then dropped follow-mode before the pin re-glued
 * (the "agent switch lands above the bottom with follow OFF" bug).
 *
 * jsdom has no layout, so scrollHeight/clientHeight/scrollTop are mocked with
 * defineProperty and scroll events are dispatched for real via fireEvent.
 */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import {
  VirtualList,
  type VirtualListHandle,
} from "../src/app/sessions/VirtualList";

const ITEMS = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}` }));

function renderList(onAtBottomChange: (b: boolean) => void) {
  const ref = createRef<VirtualListHandle>();
  render(
    <VirtualList
      ref={ref}
      items={ITEMS}
      estimateHeight={() => 40}
      renderRow={(it) => <div>{it.key}</div>}
      onAtBottomChange={onAtBottomChange}
      pinToBottom
    />,
  );
  const el = ref.current!.element()!;
  // Fake geometry: 50×40 = 2000 content, 800 viewport → bottom at 1200.
  const geo = { scrollHeight: 2000, scrollTop: 0 };
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => geo.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => geo.scrollTop,
    set: (v: number) => {
      geo.scrollTop = Math.max(0, Math.min(v, geo.scrollHeight - 800));
    },
  });
  return { ref, el, geo };
}

/** Flush the rAF-debounced scroll reader inside act(). */
async function flushFrame() {
  await act(async () => {
    await new Promise((r) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => r(null))
        : setTimeout(() => r(null), 20),
    );
    // The reader itself may schedule state updates; settle one more tick.
    await new Promise((r) => setTimeout(r, 25));
  });
}

describe("VirtualList — scroll attribution", () => {
  it("an ECHO of its own write never reports atBottom=false (follow survives re-measurement)", async () => {
    const spy = vi.fn();
    const { ref, el, geo } = renderList(spy);

    // Programmatic: glue to the bottom (records the expected position).
    act(() => ref.current!.scrollToBottom());
    expect(el.scrollTop).toBe(1200);
    spy.mockClear();

    // Rows re-measure TALLER before the write's echo arrives (the RO
    // correction race): the same position now reads 300px off-bottom.
    geo.scrollHeight = 2300;
    fireEvent.scroll(el);
    await flushFrame();

    // The off-bottom reading is attributed to our own write — follow-mode
    // must NOT be cleared.
    expect(spy).not.toHaveBeenCalledWith(false);
  });

  it("a REAL user scroll away from the bottom still reports atBottom=false", async () => {
    const spy = vi.fn();
    const { ref, el } = renderList(spy);

    act(() => ref.current!.scrollToBottom());
    spy.mockClear();

    // User drags elsewhere: position no longer matches the expected write.
    el.scrollTop = 400;
    fireEvent.scroll(el);
    await flushFrame();

    expect(spy).toHaveBeenCalledWith(false);
  });

  it("returning to the bottom reports atBottom=true again", async () => {
    const spy = vi.fn();
    const { ref, el } = renderList(spy);

    act(() => ref.current!.scrollToBottom());
    spy.mockClear();

    el.scrollTop = 400; // user leaves the bottom…
    fireEvent.scroll(el);
    await flushFrame();
    expect(spy).toHaveBeenLastCalledWith(false);

    el.scrollTop = 1200; // …and scrolls back down
    fireEvent.scroll(el);
    await flushFrame();
    expect(spy).toHaveBeenLastCalledWith(true);
  });
});
