/**
 * AccentPicker — the header's accent-colour control.
 *
 * A round glass icon-button (palette) beside the theme toggle; clicking it
 * opens a compact glass popover of seven colour swatches. Picking one re-themes
 * the whole app instantly via useAccent (data-accent on <html>) and persists.
 * Mono ("Noir") previews as a half-black/half-white diagonal split circle
 * (data-swatch="mono" in components.css) so it reads in both themes.
 *
 * The popover is rendered in a PORTAL to <body>, positioned `fixed` under the
 * trigger. The header sets `backdrop-filter`, which creates a stacking context
 * that paints BELOW the page content — an in-header absolutely-positioned
 * popover is trapped there, so real clicks land on the content behind it
 * (synthetic .click() works, hit-tested clicks do not). Portalling out of that
 * context is the fix; the outside-click handler checks BOTH the trigger root and
 * the portaled popover.
 *
 * Semantics: trigger button (aria-haspopup="menu" / aria-expanded) + a
 * role="menu" of role="menuitemradio" swatches. Keyboard: ArrowDown on the
 * trigger opens; arrows/Home/End move between swatches; Enter/Space selects;
 * Esc closes and returns focus to the trigger; outside click closes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Palette } from "lucide-react";
import { ACCENTS, useAccent, type Accent } from "../useAccent";

const LABELS: Record<Accent, string> = {
  purple: "Purple",
  mono: "Noir",
  blue: "Blue",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
};

export function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Anchor the fixed popover under the trigger (right-aligned).
  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPos({
      top: Math.round(r.bottom + 8),
      right: Math.round(window.innerWidth - r.right),
    });
  };
  const openMenu = () => {
    place();
    setOpen(true);
  };

  // Reposition while open if the layout shifts; close on scroll (the fixed
  // popover would otherwise detach from the trigger).
  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => place();
    const onScroll = () => setOpen(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Close on outside click (pointerdown so it beats focus shifts). The popover
  // is portaled out of rootRef, so check it explicitly too.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Focus the active swatch when the menu opens.
  useEffect(() => {
    if (open) swatchRefs.current[ACCENTS.indexOf(accent)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on open/close
  }, [open]);

  const close = (refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  };

  const pick = (a: Accent) => {
    setAccent(a);
    close(true);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const count = ACCENTS.length;
    const current = swatchRefs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const focusAt = (i: number) =>
      swatchRefs.current[((i % count) + count) % count]?.focus();
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusAt(current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusAt(current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(count - 1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // Let focus move on naturally, but don't leave the menu hanging open.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="console-accent" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="console-theme-toggle"
        aria-label="Choose accent colour"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Accent colour"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            close(true);
          }
        }}
      >
        <Palette size={16} />
      </button>

      {open &&
        createPortal(
          <div
            role="menu"
            aria-label="Accent colour"
            className="console-accent-pop"
            ref={popRef}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            onKeyDown={onMenuKeyDown}
          >
            {ACCENTS.map((a, i) => (
              <button
                key={a}
                type="button"
                role="menuitemradio"
                aria-checked={accent === a}
                aria-label={`${LABELS[a]} accent`}
                title={LABELS[a]}
                className={`console-accent-swatch ${accent === a ? "is-active" : ""}`}
                data-swatch={a}
                ref={(el) => {
                  swatchRefs.current[i] = el;
                }}
                onClick={() => pick(a)}
              >
                {accent === a && <Check size={12} strokeWidth={3} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
