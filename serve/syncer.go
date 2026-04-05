package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/benbjohnson/litestream"
	lss3 "github.com/benbjohnson/litestream/s3"
)

// Syncer discovers runs on S3 and uses Litestream follow-mode restore
// to continuously sync each run's SQLite database to a local directory.
type Syncer struct {
	bucket   string
	region   string
	prefix   string // e.g. "demo/imagenet"
	localDir string

	s3client *s3.Client
	mu       sync.Mutex
	runs     map[string]context.CancelFunc // runID -> cancel
}

func NewSyncer(bucket, region, prefix, localDir string) (*Syncer, error) {
	opts := []func(*awsconfig.LoadOptions) error{}
	if region != "" {
		opts = append(opts, awsconfig.WithRegion(region))
	}
	cfg, err := awsconfig.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	return &Syncer{
		bucket:   bucket,
		region:   region,
		prefix:   prefix,
		localDir: localDir,
		s3client: s3.NewFromConfig(cfg),
		runs:     make(map[string]context.CancelFunc),
	}, nil
}

// Run starts the discovery loop. Blocks until ctx is cancelled.
func (s *Syncer) Run(ctx context.Context) {
	log.Printf("syncer: watching s3://%s/%s/ → %s (every 3s)", s.bucket, s.prefix, s.localDir)

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	// Discover immediately, then on tick
	s.discover(ctx)
	for {
		select {
		case <-ctx.Done():
			s.stopAll()
			return
		case <-ticker.C:
			s.discover(ctx)
		}
	}
}

func (s *Syncer) discover(ctx context.Context) {
	prefix := s.prefix + "/"

	resp, err := s.s3client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:    aws.String(s.bucket),
		Prefix:    aws.String(prefix),
		Delimiter: aws.String("/"),
	})
	if err != nil {
		log.Printf("syncer: list error: %v", err)
		return
	}

	for _, cp := range resp.CommonPrefixes {
		p := aws.ToString(cp.Prefix)
		// p is like "demo/imagenet/<run_id>/"
		runID := strings.TrimSuffix(strings.TrimPrefix(p, prefix), "/")
		if runID == "" {
			continue
		}

		s.mu.Lock()
		_, exists := s.runs[runID]
		s.mu.Unlock()

		if !exists {
			s.startFollow(ctx, runID)
		}
	}
}

func (s *Syncer) startFollow(parentCtx context.Context, runID string) {
	localPath := filepath.Join(s.localDir, runID, "metrics.db")

	// If the local file already exists (e.g. server restart), remove it
	// because Litestream restore requires the output path not to exist.
	os.Remove(localPath)
	os.Remove(localPath + "-wal")
	os.Remove(localPath + "-shm")
	os.MkdirAll(filepath.Dir(localPath), 0755)

	ctx, cancel := context.WithCancel(parentCtx)

	s.mu.Lock()
	s.runs[runID] = cancel
	s.mu.Unlock()

	log.Printf("syncer: starting follow for run %s", runID)

	go func() {
		if err := s.followRun(ctx, runID, localPath); err != nil {
			if ctx.Err() == nil {
				log.Printf("syncer: follow error for run %s: %v", runID, err)
			}
		}
	}()
}

func (s *Syncer) followRun(ctx context.Context, runID, localPath string) error {
	client := lss3.NewReplicaClient()
	client.Bucket = s.bucket
	client.Path = fmt.Sprintf("%s/%s/metrics.db", s.prefix, runID)
	client.Region = s.region

	replica := litestream.NewReplicaWithClient(nil, client)

	opt := litestream.NewRestoreOptions()
	opt.OutputPath = localPath
	opt.Follow = true
	opt.FollowInterval = 2 * time.Second

	return replica.Restore(ctx, opt)
}

func (s *Syncer) stopAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, cancel := range s.runs {
		log.Printf("syncer: stopping follow for run %s", id)
		cancel()
	}
}
