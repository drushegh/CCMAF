import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { Shell } from "../src/app/components/Shell";
import { readStoredTheme } from "../src/app/useTheme";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("theme (dark/light) toggle", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(readStoredTheme()).toBe("dark");
  });

  it("reads a stored light preference", () => {
    localStorage.setItem("console-theme", "light");
    expect(readStoredTheme()).toBe("light");
  });

  it("toggles dark→light→dark, updating <html data-theme> and storage", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    // Default is dark: no attribute is set (dark = the base :root values).
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /switch to light mode/i })
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("console-theme")).toBe("light");

    // The control now offers the inverse action.
    fireEvent.click(
      screen.getByRole("button", { name: /switch to dark mode/i })
    );
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem("console-theme")).toBe("dark");
  });
});
