package main

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed static/*
var staticFS embed.FS

func main() {
	dir := flag.String("dir", "", "path to local runs directory (e.g. ./fixtures)")
	port := flag.Int("port", 8080, "port to listen on")
	bucket := flag.String("bucket", "", "S3 bucket to sync from (enables S3 sync mode)")
	region := flag.String("region", "", "AWS region for S3 bucket")
	prefix := flag.String("prefix", "", "S3 prefix for runs (e.g. demo/imagenet)")
	flag.Parse()

	if *dir == "" {
		if *bucket != "" {
			*dir = ".drifting-serve-data"
		} else {
			fmt.Fprintln(os.Stderr, "Usage: drifting-serve --dir <runs_directory> [--port 8080]")
			fmt.Fprintln(os.Stderr, "       drifting-serve --bucket <s3_bucket> --prefix <path> [--dir ./data] [--port 8080]")
			os.Exit(1)
		}
	}

	runsDir, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatalf("Invalid directory: %v", err)
	}
	os.MkdirAll(runsDir, 0755)

	// Start S3 syncer if bucket is configured
	if *bucket != "" {
		syncer, err := NewSyncer(*bucket, *region, *prefix, runsDir)
		if err != nil {
			log.Fatalf("Failed to create syncer: %v", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go syncer.Run(ctx)
	}

	srv := &server{runsDir: runsDir}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/projects", srv.handleProjects)
	mux.HandleFunc("/api/runs", srv.handleRuns)
	mux.HandleFunc("/api/runs/", srv.handleRunDetail)

	staticContent, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", http.FileServer(http.FS(staticContent)))

	addr := fmt.Sprintf(":%d", *port)
	if *bucket != "" {
		log.Printf("drifting serve listening on http://localhost%s (syncing from s3://%s/%s/ → %s)", addr, *bucket, *prefix, runsDir)
	} else {
		log.Printf("drifting serve listening on http://localhost%s (serving %s)", addr, runsDir)
	}
	log.Fatal(http.ListenAndServe(addr, corsMiddleware(mux)))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			return
		}
		next.ServeHTTP(w, r)
	})
}

type server struct {
	runsDir string
}

type RunSummary struct {
	RunID          string            `json:"run_id"`
	Name           string            `json:"name"`
	Entity         string            `json:"entity"`
	Project        string            `json:"project"`
	Status         string            `json:"status"`
	Config         json.RawMessage   `json:"config"`
	StartTime      float64           `json:"start_time"`
	EndTime        float64           `json:"end_time,omitempty"`
	SummaryMetrics map[string]float64 `json:"summary_metrics"`
}

type ProjectSummary struct {
	Entity       string  `json:"entity"`
	Project      string  `json:"project"`
	RunCount     int     `json:"run_count"`
	LastActivity float64 `json:"last_activity"`
}

func (s *server) handleProjects(w http.ResponseWriter, r *http.Request) {
	runs, err := s.listRuns()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	type key struct{ entity, project string }
	groups := make(map[key]*ProjectSummary)
	for _, r := range runs {
		k := key{r.Entity, r.Project}
		if p, ok := groups[k]; ok {
			p.RunCount++
			if r.StartTime > p.LastActivity {
				p.LastActivity = r.StartTime
			}
		} else {
			groups[k] = &ProjectSummary{
				Entity:       r.Entity,
				Project:      r.Project,
				RunCount:     1,
				LastActivity: r.StartTime,
			}
		}
	}

	projects := make([]ProjectSummary, 0, len(groups))
	for _, p := range groups {
		projects = append(projects, *p)
	}
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].LastActivity > projects[j].LastActivity
	})

	writeJSON(w, projects)
}

func (s *server) handleRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.listRuns()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	entityFilter := r.URL.Query().Get("entity")
	projectFilter := r.URL.Query().Get("project")
	if entityFilter != "" || projectFilter != "" {
		filtered := runs[:0]
		for _, run := range runs {
			if entityFilter != "" && run.Entity != entityFilter {
				continue
			}
			if projectFilter != "" && run.Project != projectFilter {
				continue
			}
			filtered = append(filtered, run)
		}
		runs = filtered
	}

	writeJSON(w, runs)
}

func (s *server) handleRunDetail(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/runs/")
	parts := strings.SplitN(path, "/", 2)
	runID := parts[0]

	if len(parts) == 1 || parts[1] == "" {
		run, err := s.getRun(runID)
		if err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		writeJSON(w, run)
		return
	}

	switch parts[1] {
	case "metrics":
		s.handleMetrics(w, r, runID)
	case "logs":
		s.handleLogs(w, r, runID)
	default:
		http.NotFound(w, r)
	}
}

func (s *server) handleMetrics(w http.ResponseWriter, r *http.Request, runID string) {
	db, err := s.openDB(runID)
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	defer db.Close()

	keysParam := r.URL.Query().Get("keys")

	var rows *sql.Rows
	if keysParam != "" {
		keys := strings.Split(keysParam, ",")
		placeholders := make([]string, len(keys))
		args := make([]interface{}, len(keys))
		for i, k := range keys {
			placeholders[i] = "?"
			args[i] = k
		}
		query := fmt.Sprintf(
			"SELECT step, key, value FROM metrics WHERE key IN (%s) ORDER BY step, key",
			strings.Join(placeholders, ","),
		)
		rows, err = db.Query(query, args...)
	} else {
		rows, err = db.Query("SELECT step, key, value FROM metrics ORDER BY step, key")
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	// Build columnar format: {steps: [...], "key1": [...], "key2": [...]}
	type point struct {
		step  int
		value float64
	}
	keyData := make(map[string][]point)
	var allKeys []string
	keySet := make(map[string]bool)

	for rows.Next() {
		var step int
		var key string
		var value float64
		rows.Scan(&step, &key, &value)
		if !keySet[key] {
			keySet[key] = true
			allKeys = append(allKeys, key)
		}
		keyData[key] = append(keyData[key], point{step, value})
	}
	sort.Strings(allKeys)

	result := make(map[string]interface{})
	result["keys"] = allKeys

	for _, key := range allKeys {
		points := keyData[key]
		steps := make([]int, len(points))
		values := make([]float64, len(points))
		for i, p := range points {
			steps[i] = p.step
			values[i] = p.value
		}
		result[key] = map[string]interface{}{
			"steps":  steps,
			"values": values,
		}
	}

	writeJSON(w, result)
}

func (s *server) handleLogs(w http.ResponseWriter, r *http.Request, runID string) {
	db, err := s.openDB(runID)
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	defer db.Close()

	stream := r.URL.Query().Get("stream")
	limitStr := r.URL.Query().Get("limit")
	limit := 1000
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	var rows *sql.Rows
	if stream != "" && stream != "all" {
		rows, err = db.Query(
			"SELECT timestamp, stream, line FROM logs WHERE stream = ? ORDER BY id LIMIT ?",
			stream, limit,
		)
	} else {
		rows, err = db.Query("SELECT timestamp, stream, line FROM logs ORDER BY id LIMIT ?", limit)
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type LogEntry struct {
		Timestamp float64 `json:"timestamp"`
		Stream    string  `json:"stream"`
		Line      string  `json:"line"`
	}
	var logs []LogEntry
	for rows.Next() {
		var entry LogEntry
		rows.Scan(&entry.Timestamp, &entry.Stream, &entry.Line)
		logs = append(logs, entry)
	}
	if logs == nil {
		logs = []LogEntry{}
	}

	writeJSON(w, logs)
}

func (s *server) listRuns() ([]RunSummary, error) {
	var runs []RunSummary

	err := filepath.WalkDir(s.runsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() != "metrics.db" {
			return nil
		}

		runDir := filepath.Dir(path)
		run, err := s.loadRunSummary(runDir)
		if err != nil {
			log.Printf("Warning: skipping %s: %v", runDir, err)
			return nil
		}
		runs = append(runs, *run)
		return nil
	})

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].StartTime > runs[j].StartTime
	})

	return runs, err
}

func (s *server) loadRunSummary(runDir string) (*RunSummary, error) {
	dbPath := filepath.Join(runDir, "metrics.db")
	db, err := sql.Open("sqlite", dbPath+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	defer db.Close()

	info := make(map[string]string)
	rows, err := db.Query("SELECT key, value FROM run_info")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		info[k] = v
	}

	summary := make(map[string]float64)
	metricRows, err := db.Query(`
		SELECT m.key, m.value FROM metrics m
		INNER JOIN (SELECT key, MAX(step) as max_step FROM metrics GROUP BY key) latest
		ON m.key = latest.key AND m.step = latest.max_step
	`)
	if err == nil {
		defer metricRows.Close()
		for metricRows.Next() {
			var k string
			var v float64
			metricRows.Scan(&k, &v)
			summary[k] = v
		}
	}

	run := &RunSummary{
		RunID:          info["run_id"],
		Name:           info["name"],
		Entity:         info["entity"],
		Project:        info["project"],
		Status:         info["status"],
		SummaryMetrics: summary,
	}

	if t, err := strconv.ParseFloat(info["start_time"], 64); err == nil {
		run.StartTime = t
	}
	if t, err := strconv.ParseFloat(info["end_time"], 64); err == nil {
		run.EndTime = t
	}

	configStr := info["config"]
	if configStr != "" {
		run.Config = json.RawMessage(configStr)
	}

	return run, nil
}

func (s *server) getRun(runID string) (*RunSummary, error) {
	var runDir string
	filepath.WalkDir(s.runsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if d.Name() == runID {
			runDir = path
			return filepath.SkipAll
		}
		return nil
	})
	if runDir == "" {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	return s.loadRunSummary(runDir)
}

func (s *server) openDB(runID string) (*sql.DB, error) {
	var dbPath string
	filepath.WalkDir(s.runsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() != "metrics.db" {
			return nil
		}
		if strings.Contains(filepath.Dir(path), runID) {
			dbPath = path
			return filepath.SkipAll
		}
		return nil
	})
	if dbPath == "" {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	return sql.Open("sqlite", dbPath+"?_busy_timeout=5000")
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
