import { navigate } from "../hooks/useRoute";

interface NavBarProps {
  entity?: string;
  project?: string;
  runName?: string;
  activeTab?: "workspace" | "table";
}

export function NavBar({ entity, project, runName, activeTab }: NavBarProps) {
  const isProject = entity && project && !runName;

  return (
    <div class="header">
      <h1>
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          drifting
        </a>
      </h1>
      {entity && project && (
        <span class="breadcrumb">
          <a
            href={`#/${entity}/${project}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/${entity}/${project}`);
            }}
          >
            {entity} / {project}
          </a>
          {runName && <span> / {runName}</span>}
        </span>
      )}
      {isProject && (
        <div class="nav-tabs" style={{ marginLeft: "auto", marginBottom: 0, borderBottom: "none" }}>
          <button
            class={`nav-tab ${activeTab === "workspace" ? "active" : ""}`}
            onClick={() => navigate(`/${entity}/${project}`)}
          >
            Workspace
          </button>
          <button
            class={`nav-tab ${activeTab === "table" ? "active" : ""}`}
            onClick={() => navigate(`/${entity}/${project}/table`)}
          >
            Table
          </button>
        </div>
      )}
    </div>
  );
}
