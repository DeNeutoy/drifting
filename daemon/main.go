package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/drifting/driftingd/replicator"
)

type Request struct {
	Action   string `json:"action"`
	RunID    string `json:"run_id,omitempty"`
	DBPath   string `json:"db_path,omitempty"`
	S3Prefix string `json:"s3_prefix,omitempty"`
}

type Response struct {
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
	Version    string `json:"version,omitempty"`
	ActiveRuns int    `json:"active_runs,omitempty"`
}

const version = "0.1.0"

func main() {
	configPath := flag.String("config", filepath.Join(homeDir(), ".drifting", "config.yaml"), "path to config file")
	socketPath := flag.String("socket", filepath.Join(homeDir(), ".drifting", "driftingd.sock"), "path to unix socket")
	logPath := flag.String("log", filepath.Join(homeDir(), ".drifting", "driftingd.log"), "path to log file")
	flag.Parse()

	setupLogging(*logPath)

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Printf("Warning: could not load config (%v), running in local-only mode", err)
		cfg = &Config{}
	}

	log.Printf("Config: type=%q bucket=%q region=%q", cfg.StorageType, cfg.Bucket, cfg.Region)

	mgr := replicator.NewManager(cfg.StorageType, cfg.Bucket, cfg.Region)

	recoverRuns(mgr)

	listener, err := listenSocket(*socketPath)
	if err != nil {
		log.Fatalf("Failed to listen on socket: %v", err)
	}
	defer listener.Close()
	defer os.Remove(*socketPath)

	log.Printf("driftingd %s listening on %s", version, *socketPath)

	go acceptConnections(listener, mgr)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	mgr.StopAll()
}

func homeDir() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return h
}

func setupLogging(logPath string) {
	os.MkdirAll(filepath.Dir(logPath), 0755)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	log.SetOutput(f)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
}

func listenSocket(path string) (net.Listener, error) {
	os.MkdirAll(filepath.Dir(path), 0755)
	os.Remove(path)
	return net.Listen("unix", path)
}

// recoverRuns scans ~/.drifting/runs/ for active (not .done) databases and resumes replication.
func recoverRuns(mgr *replicator.Manager) {
	runsDir := filepath.Join(homeDir(), ".drifting", "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		runDir := filepath.Join(runsDir, entry.Name())
		donePath := filepath.Join(runDir, ".done")
		dbPath := filepath.Join(runDir, "metrics.db")

		if _, err := os.Stat(donePath); err == nil {
			continue
		}
		if _, err := os.Stat(dbPath); err != nil {
			continue
		}

		log.Printf("Recovering run %s", entry.Name())
		if err := mgr.Start(entry.Name(), dbPath, entry.Name()); err != nil {
			log.Printf("Failed to recover run %s: %v", entry.Name(), err)
		}
	}
}

func acceptConnections(listener net.Listener, mgr *replicator.Manager) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go handleConnection(conn, mgr)
	}
}

func handleConnection(conn net.Conn, mgr *replicator.Manager) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	var req Request
	if err := decoder.Decode(&req); err != nil {
		encoder.Encode(Response{OK: false, Error: "invalid request"})
		return
	}

	var resp Response

	switch req.Action {
	case "register":
		if req.RunID == "" || req.DBPath == "" {
			resp = Response{OK: false, Error: "run_id and db_path required"}
		} else {
			s3Prefix := req.S3Prefix
			if s3Prefix == "" {
				s3Prefix = req.RunID
			}
			if err := mgr.Start(req.RunID, req.DBPath, s3Prefix); err != nil {
				resp = Response{OK: false, Error: err.Error()}
			} else {
				log.Printf("Registered run %s (%s) -> %s", req.RunID, req.DBPath, s3Prefix)
				resp = Response{OK: true}
			}
		}

	case "finish":
		if req.RunID == "" {
			resp = Response{OK: false, Error: "run_id required"}
		} else if err := mgr.Stop(req.RunID); err != nil {
			resp = Response{OK: false, Error: err.Error()}
		} else {
			log.Printf("Finished run %s", req.RunID)
			resp = Response{OK: true}
		}

	case "ping":
		resp = Response{OK: true, Version: version, ActiveRuns: mgr.ActiveCount()}

	default:
		resp = Response{OK: false, Error: fmt.Sprintf("unknown action: %s", req.Action)}
	}

	encoder.Encode(resp)
}

// Config holds storage backend configuration.
type Config struct {
	StorageType string `yaml:"type"`
	Bucket      string `yaml:"bucket"`
	Region      string `yaml:"region"`
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	// Minimal YAML parsing for the flat structure we need.
	cfg := &Config{}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return cfg, parseSimpleYAML(string(data), cfg)
	}
	return cfg, nil
}

func parseSimpleYAML(content string, cfg *Config) error {
	// Very minimal key: value parser for our config.
	// A real implementation would use a YAML library.
	lines := splitLines(content)
	for _, line := range lines {
		kv := splitKV(line)
		if kv == nil {
			continue
		}
		switch kv[0] {
		case "type":
			cfg.StorageType = kv[1]
		case "bucket":
			cfg.Bucket = kv[1]
		case "region":
			cfg.Region = kv[1]
		}
	}
	return nil
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func splitKV(line string) []string {
	for i := 0; i < len(line); i++ {
		if line[i] == ':' {
			key := trimSpace(line[:i])
			val := trimSpace(line[i+1:])
			if key != "" && val != "" {
				return []string{key, val}
			}
			return nil
		}
	}
	return nil
}

func trimSpace(s string) string {
	i := 0
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	j := len(s)
	for j > i && (s[j-1] == ' ' || s[j-1] == '\t') {
		j--
	}
	return s[i:j]
}

