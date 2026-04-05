export interface RunSummary {
  run_id: string;
  name: string;
  entity: string;
  project: string;
  status: "running" | "finished" | "failed";
  config: Record<string, unknown>;
  start_time: number;
  end_time?: number;
  summary_metrics: Record<string, number>;
}

export interface Project {
  entity: string;
  project: string;
  run_count: number;
  last_activity: number;
}

export interface MetricSeries {
  steps: number[];
  values: number[];
}

export interface MetricsResponse {
  keys: string[];
  [metricKey: string]: MetricSeries | string[];
}

export interface LogEntry {
  timestamp: number;
  stream: "stdout" | "stderr";
  line: string;
}

export interface SystemMetricSeries {
  timestamps: number[];
  values: number[];
}

export interface SystemMetricsResponse {
  keys: string[];
  [metricKey: string]: SystemMetricSeries | string[];
}

export interface MediaItem {
  id: number;
  step: number;
  key: string;
  media_type: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
}
