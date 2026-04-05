import { useState, useEffect } from "preact/hooks";
import { api } from "../api";
import { NavBar } from "../components/NavBar";
import { navigate } from "../hooks/useRoute";
import { formatRelativeTime } from "../format";
import type { Project } from "../types";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    api<Project[]>("/api/projects").then(setProjects);
  }, []);

  if (!projects) return <div class="loading">Loading projects...</div>;

  if (projects.length === 0) {
    return (
      <div class="container">
        <NavBar />
        <div class="loading">No projects found. Start logging runs to see them here.</div>
      </div>
    );
  }

  return (
    <div class="container">
      <NavBar />
      <div class="projects-grid">
        {projects.map((p) => (
          <div
            key={`${p.entity}/${p.project}`}
            class="project-card"
            onClick={() => navigate(`/${p.entity}/${p.project}`)}
          >
            <div class="project-name">
              {p.entity} / {p.project}
            </div>
            <div class="project-meta">
              <span>{p.run_count} runs</span>
              <span>{formatRelativeTime(p.last_activity)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
