import { useRef } from "react";
import {
  Circle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
} from "lucide-react";
import { type Verdict } from "../api/verify";

interface VerdictOption {
  value: Verdict;
  label: string;
  icon: React.ReactNode;
}

const OPTIONS: VerdictOption[] = [
  { value: "pending", label: "Pending", icon: <Circle size={13} /> },
  { value: "pass", label: "Pass", icon: <CheckCircle2 size={13} /> },
  { value: "fail", label: "Fail", icon: <XCircle size={13} /> },
  { value: "warn", label: "Warn", icon: <AlertTriangle size={13} /> },
  { value: "blocked", label: "Blocked", icon: <Ban size={13} /> },
];

interface VerdictControlProps {
  value: Verdict;
  onChange: (verdict: Verdict) => void;
  /** Used to scope the radiogroup label / disambiguate multiple controls. */
  itemId: string;
}

/**
 * Segmented control for picking a verdict. Implemented as a radiogroup so it is
 * keyboard- and screen-reader-navigable. Each segment carries a verdict-specific
 * colour band from verify.css (vv-seg--<verdict>).
 *
 * CRITICAL fix #2: roving-tabindex pattern — only the selected radio has
 * tabIndex=0 (others -1); ArrowLeft/ArrowUp/ArrowRight/ArrowDown move
 * selection+focus (wrapping); Home/End jump to first/last. Calls onChange on
 * arrow move.
 * WARNING fix #5: aria-label includes itemId to disambiguate across items.
 */
export function VerdictControl({ value, onChange, itemId }: VerdictControlProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number): void {
    let nextIndex: number | null = null;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % OPTIONS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + OPTIONS.length) % OPTIONS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = OPTIONS.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextOption = OPTIONS[nextIndex];
    onChange(nextOption.value);

    // Move focus to the newly selected button.
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]'
    );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <div
      ref={groupRef}
      className="vv-seg"
      role="radiogroup"
      aria-label={`Verdict for ${itemId}`}
      data-testid={`verdict-${itemId}`}
    >
      {OPTIONS.map((opt, index) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: only the selected option is in the tab order.
            tabIndex={selected ? 0 : -1}
            className={`vv-seg-btn vv-seg--${opt.value} ${
              selected ? "is-selected" : ""
            }`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span className="vv-seg-btn-icon">{opt.icon}</span>
            <span className="vv-seg-btn-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
