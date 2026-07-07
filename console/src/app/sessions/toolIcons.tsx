/**
 * toolIcons.tsx — one icon per tool family for the tool rail + group chips.
 * Falls back to a wrench (the established "tool" glyph in this console).
 */

import type { ReactNode } from "react";
import {
  Bot,
  FilePlus,
  FileText,
  Files,
  Globe,
  ListChecks,
  Pencil,
  SearchCode,
  Terminal,
  Wrench,
} from "lucide-react";

const MAP: Record<string, (size: number) => ReactNode> = {
  Read: (s) => <FileText size={s} aria-hidden="true" />,
  Edit: (s) => <Pencil size={s} aria-hidden="true" />,
  MultiEdit: (s) => <Pencil size={s} aria-hidden="true" />,
  NotebookEdit: (s) => <Pencil size={s} aria-hidden="true" />,
  Write: (s) => <FilePlus size={s} aria-hidden="true" />,
  Bash: (s) => <Terminal size={s} aria-hidden="true" />,
  BashOutput: (s) => <Terminal size={s} aria-hidden="true" />,
  Grep: (s) => <SearchCode size={s} aria-hidden="true" />,
  Glob: (s) => <Files size={s} aria-hidden="true" />,
  Task: (s) => <Bot size={s} aria-hidden="true" />,
  Agent: (s) => <Bot size={s} aria-hidden="true" />,
  WebFetch: (s) => <Globe size={s} aria-hidden="true" />,
  WebSearch: (s) => <Globe size={s} aria-hidden="true" />,
  TodoWrite: (s) => <ListChecks size={s} aria-hidden="true" />,
};

export function toolIcon(name: string, size = 12): ReactNode {
  const f = MAP[name];
  return f ? f(size) : <Wrench size={size} aria-hidden="true" />;
}
