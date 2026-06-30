import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { FEATURES } from "../featureFlags";
import {
  LayoutDashboard,
  Kanban,
  FileText,
  BookOpen,
  ScrollText,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Activity,
  Terminal,
  Lightbulb,
  ClipboardCheck,
  ListChecks,
  FolderOpen,
  Zap,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "../useTheme";

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    icon: <LayoutDashboard size={18} />,
    label: "Dashboard",
    description: "Project state overview",
  },
  {
    to: "/kanban",
    icon: <Kanban size={18} />,
    label: "Kanban",
    description: "Task board",
  },
  {
    to: "/verify",
    icon: <CheckSquare size={18} />,
    label: "Verify",
    description: "Review handbacks",
  },
  {
    to: "/status",
    icon: <ListChecks size={18} />,
    label: "Status",
    description: "Project status",
  },
  {
    to: "/findings",
    icon: <ClipboardCheck size={18} />,
    label: "Findings",
    description: "Review & test findings",
  },
  {
    to: "/gotchas",
    icon: <Lightbulb size={18} />,
    label: "Gotchas",
    description: "Lessons learned",
  },
  {
    to: "/headroom",
    icon: <Zap size={18} />,
    label: "Headroom",
    description: "Compression savings",
  },
  {
    to: "/contracts",
    icon: <FileText size={18} />,
    label: "Contracts",
    description: "Interface agreements",
  },
  {
    to: "/decisions",
    icon: <BookOpen size={18} />,
    label: "Decisions",
    description: "Decision log",
  },
  {
    to: "/spec",
    icon: <ScrollText size={18} />,
    label: "Spec",
    description: "Project spec",
  },
  {
    to: "/docs",
    icon: <FolderOpen size={18} />,
    label: "Docs",
    description: "Project docs & references",
  },
  {
    to: "/readme",
    icon: <FileText size={18} />,
    label: "README",
    description: "Project README",
  },
];

// Headroom is parked (TASK-029) — it stays defined above but is hidden from the
// rail until FEATURES.headroom is flipped back on. Nothing is deleted.
const VISIBLE_NAV = NAV_ITEMS.filter(
  (item) => item.to !== "/headroom" || FEATURES.headroom
);

export function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();

  const currentPage = VISIBLE_NAV.find((item) =>
    location.pathname.startsWith(item.to)
  );

  return (
    <div className="console-shell">
      {/* ── Header bar ── */}
      <header className="console-header">
        <div className="console-header-brand">
          <span className="console-header-logo">
            <Activity size={16} />
          </span>
          <div className="console-header-titles">
            <span className="console-header-name">Project Console</span>
            <span className="console-header-sub">CCMAF Surface</span>
          </div>
        </div>

        <div className="console-header-breadcrumb">
          {currentPage && (
            <>
              <span className="console-header-breadcrumb-sep">/</span>
              <span className="console-header-breadcrumb-page">
                {currentPage.label}
              </span>
              <span className="console-header-breadcrumb-desc">
                {currentPage.description}
              </span>
            </>
          )}
        </div>

        <div className="console-header-right">
          <button
            type="button"
            className="console-theme-toggle"
            onClick={toggle}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="console-header-status">
            <span className="console-status-dot" />
            <span className="console-status-label">Local</span>
          </div>
        </div>
      </header>

      {/* ── Body: rail + content ── */}
      <div className="console-body">
        {/* ── Nav rail ── */}
        <nav
          className={`console-rail ${collapsed ? "console-rail--collapsed" : ""}`}
          aria-label="Main navigation"
        >
          <ul className="console-rail-list" role="list">
            {VISIBLE_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `console-rail-item ${isActive ? "is-active" : ""}`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <span className="console-rail-item-icon">{item.icon}</span>
                  {!collapsed && (
                    <span className="console-rail-item-label">{item.label}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="console-rail-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && (
              <span className="console-rail-collapse-label">Collapse</span>
            )}
          </button>
        </nav>

        {/* ── Main content ── */}
        <main className="console-content" id="main-content">
          <Outlet />
        </main>
      </div>

      {/* ── Status bar ── */}
      <footer className="console-statusbar">
        <div className="console-statusbar-left">
          <Terminal size={11} />
          <span>Console v0.1</span>
        </div>
      </footer>

    </div>
  );
}
