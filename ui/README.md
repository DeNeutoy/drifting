# drifting ui

Web frontend for drifting. Preact + TypeScript + uPlot, built with Vite.

## Design

The UI is a single-page app with hash routing. Three main views:

- **Projects** (`#/`) — cards for each entity/project pair
- **Workspace** (`#/:entity/:project`) — side panel of runs + chart grid with synced hover, metric regex filtering, collapsible sections
- **Table** (`#/:entity/:project/table`) — sortable/filterable/groupable runs table with column selector and CSV export
- **Run detail** (`#/runs/:id`) — per-run charts, logs, config

Vite builds to `serve/static/`, which the Go server embeds into a single binary via `go:embed`.

## Dev setup

### Local (no Docker)

Requires Go 1.26+ and Node 22+.

```
# terminal 1 — API server on :8080
cd serve && go run . --dir ../fixtures

# terminal 2 — Vite dev server on :5173 (proxies /api to :8080)
cd ui && npm install && npm run dev
```

Open http://localhost:5173.

### Docker

```
make dev
```

This runs `docker compose up` with the Go API and Vite dev server. Same URL.

## Production build

```
make build
```

Builds the frontend, then compiles the Go server with the UI embedded. Output: `bin/drifting-serve`.

Or as a Docker image:

```
make docker
```
