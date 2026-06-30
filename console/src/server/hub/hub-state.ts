/**
 * hub-state.ts — the data behind the Hub flyout window (TASK-043, DEC-028)
 *
 * The Hub UI moved from a native systray menu into a small console-served window
 * (`GET /hub`). This module is the systray-free state the window renders: the
 * running consoles, the known-but-stopped projects, and the current settings.
 * Kept out of hub.ts (which imports systray2) so the console server can import it
 * without pulling the tray helper into the server bundle.
 */

import { resolve } from "node:path";
import {
  readRegistry,
  knownProjects,
  projectName,
  type RegistryEntry,
} from "./registry.js";
import { readSettings, type ConsoleSettings } from "./settings.js";

export interface HubConsole {
  project: string;
  port: number;
  rootPath: string;
}
export interface HubStopped {
  project: string;
  rootPath: string;
}
export interface HubState {
  running: HubConsole[];
  stopped: HubStopped[];
  settings: ConsoleSettings;
}

/** Known projects (ports.json) that are NOT currently running → offer Start. */
export function computeStopped(
  running: { rootPath: string }[],
  known: { rootPath: string; pinnedPort: number }[],
): { rootPath: string; pinnedPort: number }[] {
  const runningRoots = new Set(running.map((e) => resolve(e.rootPath)));
  return known.filter((k) => !runningRoots.has(resolve(k.rootPath)));
}

/**
 * The full Hub state for the flyout. Running consoles come straight from the
 * registry (raw — the tray's 5s health-prune deletes dead files, so a phantom
 * self-resolves on the next poll, same as /shell). NO secrets leak: the running
 * list is project/port/rootPath only (the shutdownToken stays on disk).
 */
export function readHubState(): HubState {
  const reg: RegistryEntry[] = readRegistry();
  const running: HubConsole[] = reg
    .map((e) => ({ project: e.project, port: e.port, rootPath: e.rootPath }))
    .sort((a, b) => a.port - b.port);
  const stopped: HubStopped[] = computeStopped(reg, knownProjects())
    .map((s) => ({ project: projectName(s.rootPath), rootPath: s.rootPath }))
    .sort((a, b) => a.project.localeCompare(b.project));
  return { running, stopped, settings: readSettings() };
}
