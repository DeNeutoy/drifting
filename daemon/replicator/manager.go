package replicator

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/benbjohnson/litestream"
	lss3 "github.com/benbjohnson/litestream/s3"
)

// Manager tracks active database replications.
type Manager struct {
	mu          sync.Mutex
	dbs         map[string]*litestream.DB
	storageType string
	bucket      string
	region      string
}

func NewManager(storageType, bucket, region string) *Manager {
	return &Manager{
		dbs:         make(map[string]*litestream.DB),
		storageType: storageType,
		bucket:      bucket,
		region:      region,
	}
}

// Start begins replicating a SQLite database for the given run.
// s3Prefix determines the storage path: <bucket>/<s3Prefix>/metrics.db
func (m *Manager) Start(runID, dbPath, s3Prefix string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.dbs[runID]; exists {
		return fmt.Errorf("run %s already registered", runID)
	}

	if m.bucket == "" {
		log.Printf("No storage configured, run %s registered (local only)", runID)
		m.dbs[runID] = nil
		return nil
	}

	db := litestream.NewDB(dbPath)

	client := lss3.NewReplicaClient()
	client.Bucket = m.bucket
	client.Path = fmt.Sprintf("%s/metrics.db", s3Prefix)
	client.Region = m.region

	replica := litestream.NewReplicaWithClient(db, client)
	db.Replica = replica

	if err := db.Open(); err != nil {
		return fmt.Errorf("open db for replication: %w", err)
	}

	m.dbs[runID] = db
	return nil
}

// Stop finalizes replication for a run (checkpoint + final sync).
func (m *Manager) Stop(runID string) error {
	m.mu.Lock()
	db, exists := m.dbs[runID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("run %s not found", runID)
	}
	delete(m.dbs, runID)
	m.mu.Unlock()

	if db == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := db.Sync(ctx); err != nil {
		log.Printf("Warning: final sync for run %s failed: %v", runID, err)
	}

	return db.Close(ctx)
}

// StopAll stops all active replications.
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.dbs))
	for id := range m.dbs {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		if err := m.Stop(id); err != nil {
			log.Printf("Error stopping run %s: %v", id, err)
		}
	}
}

// ActiveCount returns the number of actively replicated databases.
func (m *Manager) ActiveCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.dbs)
}
