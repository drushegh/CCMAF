import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { KanbanPage } from "./pages/KanbanPage";
import { ContractsPage } from "./pages/ContractsPage";
import { DecisionsPage } from "./pages/DecisionsPage";
import { SpecPage } from "./pages/SpecPage";
import { ReadmePage } from "./pages/ReadmePage";
import { VerifyPage } from "./pages/VerifyPage";
import { StatusPage } from "./pages/StatusPage";
import { GotchasPage } from "./pages/GotchasPage";
import { FindingsPage } from "./pages/FindingsPage";
import { DocsPage } from "./pages/DocsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="status" element={<StatusPage />} />
          <Route path="gotchas" element={<GotchasPage />} />
          <Route path="findings" element={<FindingsPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="decisions" element={<DecisionsPage />} />
          <Route path="spec" element={<SpecPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="readme" element={<ReadmePage />} />
          <Route path="verify" element={<VerifyPage />} />
          <Route path="verify/:task" element={<VerifyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
