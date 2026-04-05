import { useRoute } from "./hooks/useRoute";
import { ProjectsPage } from "./pages/ProjectsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { RunsTablePage } from "./pages/RunsTablePage";
import { RunDetailPage } from "./pages/RunDetailPage";

type TabType = "charts" | "logs" | "config";

export function App() {
  const route = useRoute();
  const path = route.replace(/^#/, "") || "/";

  // #/runs/:id or #/runs/:id/:tab
  const runMatch = path.match(/^\/runs\/([^/]+)(?:\/(charts|logs|config))?$/);
  if (runMatch) {
    const tab = (runMatch[2] as TabType) || "charts";
    return <RunDetailPage runId={runMatch[1]} initialTab={tab} />;
  }

  // #/:entity/:project/table
  const tableMatch = path.match(/^\/([^/]+)\/([^/]+)\/table$/);
  if (tableMatch) {
    return <RunsTablePage entity={tableMatch[1]} project={tableMatch[2]} />;
  }

  // #/:entity/:project
  const workspaceMatch = path.match(/^\/([^/]+)\/([^/]+)$/);
  if (workspaceMatch) {
    return <WorkspacePage entity={workspaceMatch[1]} project={workspaceMatch[2]} />;
  }

  // #/ (root)
  return <ProjectsPage />;
}
