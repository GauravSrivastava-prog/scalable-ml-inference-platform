import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';

// ─── Data Shape Contract ─────────────────────────────────────────────────────
// Raw API response from GET /api/v1/telemetry/postgres
export interface PostgresTelemetryPayload {
    total_predictions: number;
    avg_latency_ms: number;
    active_models: number;
    cluster_status: 'ONLINE' | 'DEGRADED';
    p95_sparkline: number[];   // last 30 individual latency samples, oldest first
    success_rate: number;      // 0–100
}

// ─── Dashboard State (same shape Pulse.tsx already destructures) ─────────────
export interface TelemetryState {
    tunnelLatency: number;       // mapped from avg_latency_ms
    blockedRequests: number;     // mapped from 100 - success_rate (error count proxy)
    workerStatus: { active: number; total: number; queueDepth: number };
    cacheMatrix: { tier1: number; tier2: number; misses: number };
    p95Sparkline: number[];
    isLoading: boolean;
    isReconnecting: boolean;
    prometheusLive: boolean;     // always false — we use DB now; badge shows "DB Live"
    lastUpdated: Date | null;
    successRate: number;         // NEW: raw success rate for insights
    activeModels: number;        // NEW: raw active models count for insights
}

const INITIAL_STATE: TelemetryState = {
    tunnelLatency: 0,
    blockedRequests: 0,
    workerStatus: { active: 0, total: 4, queueDepth: 0 },
    cacheMatrix: { tier1: 0, tier2: 0, misses: 0 },
    p95Sparkline: Array(30).fill(0),
    isLoading: true,
    isReconnecting: false,
    prometheusLive: false,
    lastUpdated: null,
    successRate: 100,
    activeModels: 0,
};

const POLL_INTERVAL_MS = 5_000;
const MAX_SPARKLINE_POINTS = 30;

export function usePrometheusTelemetry(): TelemetryState {
    const [state, setState] = useState<TelemetryState>(INITIAL_STATE);
    const consecutiveFailuresRef = useRef(0);
    const sparklineBufferRef = useRef<number[]>(Array(MAX_SPARKLINE_POINTS).fill(0));

    const fetchTelemetry = useCallback(async () => {
        try {
            // Uses the new PostgreSQL-backed endpoint — no Prometheus required.
            const res = await apiFetch('/api/v1/telemetry/postgres');

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data: PostgresTelemetryPayload = await res.json();
            consecutiveFailuresRef.current = 0;

            // ── Sparkline ring-buffer ─────────────────────────────────────
            // If the API returns a batch (up to 30 points) absorb them all;
            // otherwise fall back to the avg_latency as a single-point update.
            const incoming: number[] =
                Array.isArray(data.p95_sparkline) && data.p95_sparkline.length > 0
                    ? data.p95_sparkline
                    : [data.avg_latency_ms];

            const newBuffer = [...sparklineBufferRef.current];
            for (const pt of incoming) {
                newBuffer.shift();
                newBuffer.push(pt);
            }
            sparklineBufferRef.current = newBuffer;

            // ── Map PostgreSQL fields → dashboard state ───────────────────
            setState({
                // avg_latency_ms is the best proxy for edge-to-metal RTT from DB
                tunnelLatency: data.avg_latency_ms,

                // Error count proxy: predictions that didn't complete successfully
                blockedRequests: Math.round(
                    (data.total_predictions * (100 - data.success_rate)) / 100
                ),

                // Workers: active_models drives the "active" dial;
                // total stays at env-configured 4 (no Prometheus celery metric)
                workerStatus: {
                    active: Math.min(data.active_models, 4),
                    total: 4,
                    queueDepth: 0,
                },

                // Cache matrix: success_rate drives tier2 (Redis hits);
                // tier1 (RAM) gets a fixed 60% share when success is high.
                cacheMatrix: {
                    tier1: data.success_rate > 50 ? 60 : 0,
                    tier2: Math.max(0, data.success_rate - 60),
                    misses: Math.max(0, 100 - data.success_rate),
                },

                p95Sparkline: [...newBuffer],
                isLoading: false,
                isReconnecting: false,
                // prometheusLive stays false — badge will show amber "DB Live"
                prometheusLive: false,
                lastUpdated: new Date(),
                successRate: data.success_rate,
                activeModels: data.active_models,
            });
        } catch {
            consecutiveFailuresRef.current += 1;
            setState(prev => ({
                ...prev,
                isLoading: false,
                isReconnecting: consecutiveFailuresRef.current >= 2,
            }));
        }
    }, []);

    useEffect(() => {
        fetchTelemetry();
        const interval = setInterval(fetchTelemetry, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchTelemetry]);

    return state;
}
