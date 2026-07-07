// @vitest-environment node
/**
 * nav-rail-order.test.ts — §4.1 "most-recent agent at top": the orderAgents
 * sibling comparator (live partition pins first; within each partition
 * lastActivity DESC, nulls last, id ASC tiebreak; hierarchy preserved) and
 * the [ / ] cycle order that inherits it.
 */
import { describe, it, expect } from "vitest";
import {
  agentCycleOrder,
  groupSessions,
  orderAgents,
} from "../src/app/sessions/NavRail";
import type {
  AgentNode,
  SessionSummary,
  SessionTree,
} from "../src/app/api/sessions";

function agent(id: string, over: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    parentId: "root",
    agentType: "developer",
    description: null,
    toolUseId: null,
    spawnDepth: 1,
    status: "done",
    startedAt: null,
    lastActivity: null,
    messageCount: 0,
    model: null,
    ...over,
  };
}

function tree(agents: AgentNode[]): SessionTree {
  return {
    sessionId: "s1",
    root: agent("root", {
      parentId: null,
      agentType: "session",
      spawnDepth: 0,
    }),
    agents,
  };
}

const at = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 6, 7, h, m)).toISOString();

describe("orderAgents (§4.1 recency)", () => {
  it("sorts done siblings by lastActivity DESC, not spawn order", () => {
    const t = tree([
      agent("a", { lastActivity: at(10) }),
      agent("b", { lastActivity: at(12) }),
      agent("c", { lastActivity: at(11) }),
    ]);
    expect(orderAgents(t).map((x) => x.node.id)).toEqual(["b", "c", "a"]);
  });

  it("pins live agents first among siblings, each partition recency-ordered", () => {
    const t = tree([
      agent("done-new", { lastActivity: at(14) }),
      agent("live-old", { status: "running", lastActivity: at(9) }),
      agent("live-new", { status: "running", lastActivity: at(10) }),
      agent("done-old", { lastActivity: at(8) }),
    ]);
    expect(orderAgents(t).map((x) => x.node.id)).toEqual([
      "live-new",
      "live-old",
      "done-new",
      "done-old",
    ]);
  });

  it("null lastActivity sorts last; equal timestamps tiebreak by id ASC", () => {
    const t = tree([
      agent("z-null", { lastActivity: null }),
      agent("b-tie", { lastActivity: at(12) }),
      agent("a-tie", { lastActivity: at(12) }),
    ]);
    expect(orderAgents(t).map((x) => x.node.id)).toEqual([
      "a-tie",
      "b-tie",
      "z-null",
    ]);
  });

  it("preserves hierarchy — children stay nested under their spawner", () => {
    const t = tree([
      agent("parent", { lastActivity: at(10) }),
      agent("other", { lastActivity: at(12) }),
      // Newest of all, but a CHILD of parent — must render under it.
      agent("child", { parentId: "parent", lastActivity: at(13) }),
    ]);
    expect(orderAgents(t).map((x) => `${x.node.id}@${x.depth}`)).toEqual([
      "other@1",
      "parent@1",
      "child@2",
    ]);
  });

  it("agentCycleOrder starts at root and follows the recency order", () => {
    const t = tree([
      agent("a", { lastActivity: at(10) }),
      agent("b", { lastActivity: at(12) }),
    ]);
    expect(agentCycleOrder(t)).toEqual(["root", "b", "a"]);
  });
});

describe("groupSessions", () => {
  const summary = (
    id: string,
    lastActivity: string | null,
  ): SessionSummary => ({
    id,
    startedAt: lastActivity,
    lastActivity,
    messageCount: 1,
    agentCount: 0,
    gitBranch: null,
    firstPrompt: null,
    title: null,
  });

  it("splits live (activity within 2min) from day groups", () => {
    const now = Date.now();
    const { live, days } = groupSessions(
      [
        summary("live1", new Date(now - 30_000).toISOString()),
        summary("today1", new Date(now - 4 * 3600_000).toISOString()),
      ],
      now,
    );
    expect(live.map((s) => s.id)).toEqual(["live1"]);
    expect(days.map((d) => d.sessions.map((s) => s.id))).toEqual([["today1"]]);
  });
});
