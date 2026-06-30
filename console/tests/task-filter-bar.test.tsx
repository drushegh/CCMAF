/**
 * task-filter-bar.test.tsx — the shared filter/sort bar (TASK-023).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TaskFilterBar } from "../src/app/components/TaskFilterBar";
import { DEFAULT_FILTER } from "../src/app/lib/taskFilter";

describe("TaskFilterBar", () => {
  it("emits search text changes", () => {
    const onChange = vi.fn();
    render(<TaskFilterBar value={DEFAULT_FILTER} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("task-filter-search"), {
      target: { value: "kanban" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "kanban" }),
    );
  });

  it("toggles showArchived", () => {
    const onChange = vi.fn();
    render(<TaskFilterBar value={DEFAULT_FILTER} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("task-filter-archived"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ showArchived: true }),
    );
  });

  it("hides the archived toggle when showArchivedToggle is false", () => {
    render(
      <TaskFilterBar
        value={DEFAULT_FILTER}
        onChange={vi.fn()}
        showArchivedToggle={false}
      />,
    );
    expect(screen.queryByTestId("task-filter-archived")).toBeNull();
  });

  it("changes the sort key", () => {
    const onChange = vi.fn();
    render(<TaskFilterBar value={DEFAULT_FILTER} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("task-filter-sort"), {
      target: { value: "title" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortKey: "title" }),
    );
  });

  it("flips the sort direction", () => {
    const onChange = vi.fn();
    render(<TaskFilterBar value={DEFAULT_FILTER} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("task-filter-sortdir"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortDir: "desc" }),
    );
  });

  it("renders only the offered sort keys", () => {
    render(
      <TaskFilterBar
        value={DEFAULT_FILTER}
        onChange={vi.fn()}
        sortKeys={["id", "title"]}
      />,
    );
    const select = screen.getByTestId("task-filter-sort") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["id", "title"]);
  });
});
