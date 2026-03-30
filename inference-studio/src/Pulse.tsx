import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Activity, Zap, Server, Cpu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';

export default function Pulse() {
    const navigate = useNavigate();

    const [telemetry, setTelemetry] = useState({
        cache_hit_rate: 0.0,
        p95_latency_ms: 0.0,
        total_predictions: 0,
        current_rps: 0.0,
        system_healthy: true
    });

    // FIX 1: Store the ACTUAL raw RPS numbers instead of arbitrary percentages
    const [trafficHistory, setTrafficHistory] = useState<number[]>(Array(40).fill(0));

    useEffect(() => {
        const fetchTelemetry = async () => {
            try {
                const res = await apiFetch('/api/v1/predictions/telemetry/live');
                if (res.ok) {
                    const data = await res.json();
                    setTelemetry(data);

                    // Shift the array left, and add the real RPS to the right
                    setTrafficHistory(prevData => {
                        const newData = [...prevData.slice(1)];
                        newData.push(data.current_rps || 0);
                        return newData;
                    });
                }
            } catch (err) {
                console.error("Failed to load telemetry", err);
            }
        };

        fetchTelemetry();
        const interval = setInterval(fetchTelemetry, 2000);
        return () => clearInterval(interval);
    }, []);

    // FIX 2: Dynamically calculate the maximum Y-axis scale based on recent traffic.
    // We use a minimum scale of 5 so the graph doesn't look completely crazy when traffic is at 0.1 RPS
    const maxRps = Math.max(...trafficHistory, 5);

    return (
        <div className="min-h-screen bg-background font-sans text-primary p-6 sm:p-12 flex flex-col">
            {/* Top Nav */}
            <nav className="flex items-center space-x-4 mb-12 border-b border-white/10 pb-6">
                <button
                    onClick={() => navigate('/studio')}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-white"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-xl font-medium tracking-wide">System Pulse</h1>
                    <p className="text-sm text-muted">Global Cluster Telemetry</p>
                </div>
            </nav>

            {/* REAL KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="bg-surface/30 border border-white/10 p-6 rounded-2xl">
                    <div className="flex items-center space-x-2 text-muted mb-4">
                        <Zap className="h-4 w-4" />
                        <h3 className="text-sm font-medium uppercase tracking-wider">Tier 2 Cache Hit Rate</h3>
                    </div>
                    <p className="text-4xl font-light tracking-tight text-green-400">
                        {telemetry.cache_hit_rate}%
                    </p>
                    <p className="text-sm text-muted mt-2">Bypassing ML models efficiently</p>
                </div>

                <div className="bg-surface/30 border border-white/10 p-6 rounded-2xl">
                    <div className="flex items-center space-x-2 text-muted mb-4">
                        <Activity className="h-4 w-4" />
                        <h3 className="text-sm font-medium uppercase tracking-wider">P95 Inference Latency</h3>
                    </div>
                    <p className="text-4xl font-light tracking-tight text-white">
                        {telemetry.p95_latency_ms}<span className="text-xl text-muted ml-1">ms</span>
                    </p>
                    <p className="text-sm text-muted mt-2">Measured across active worker nodes</p>
                </div>

                <div className="bg-surface/30 border border-white/10 p-6 rounded-2xl">
                    <div className="flex items-center space-x-2 text-muted mb-4">
                        <Server className="h-4 w-4" />
                        <h3 className="text-sm font-medium uppercase tracking-wider">Total Predictions</h3>
                    </div>
                    <p className="text-4xl font-light tracking-tight text-white">
                        {telemetry.total_predictions.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted mt-2">All-time cluster volume</p>
                </div>
            </div>

            {/* Live Traffic Visualizer */}
            <div className="bg-surface/20 border border-white/10 rounded-2xl p-8 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                            <Cpu className="h-5 w-5 text-accent" />
                            <h2 className="text-lg font-medium">Live Cluster Traffic</h2>
                        </div>
                        {/* CURRENT RPS DISPLAY */}
                        <div className="bg-white/5 border border-white/10 px-3 py-1 rounded-md flex items-center space-x-2">
                            <span className="text-xs text-muted uppercase tracking-wider">Current:</span>
                            <span className="font-mono text-accent font-medium">{telemetry.current_rps} req/s</span>
                        </div>
                    </div>

                    <span className={`flex items-center space-x-2 text-xs font-medium px-3 py-1 rounded-full border ${telemetry.system_healthy ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'} animate-pulse`}>
                        <div className={`h-2 w-2 rounded-full ${telemetry.system_healthy ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span>{telemetry.system_healthy ? 'SYSTEM HEALTHY' : 'PROMETHEUS OFFLINE'}</span>
                    </span>
                </div>

                {/* FIX 3: Dynamic Grid & Numbered Axes */}
                <div className="relative h-56 mt-4 w-full">

                    {/* Background Grid Lines & Y-Axis Labels */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none z-0">
                        {/* Top Line (Max Scale) */}
                        <div className="border-t border-white/5 w-full flex justify-start relative">
                            <span className="absolute -top-5 left-0 text-xs text-muted/50 font-mono">{maxRps.toFixed(1)}</span>
                        </div>
                        {/* Middle Line (50% Scale) */}
                        <div className="border-t border-white/5 w-full flex justify-start relative">
                            <span className="absolute -top-5 left-0 text-xs text-muted/50 font-mono">{(maxRps / 2).toFixed(1)}</span>
                        </div>
                        {/* Bottom Line (0) */}
                        <div className="border-t border-white/10 w-full flex justify-start relative">
                            <span className="absolute top-2 left-0 text-xs text-muted/50 font-mono">0.0</span>
                            {/* X-Axis time indicators */}
                            <span className="absolute top-2 right-0 text-xs text-muted/50">Now</span>
                            <span className="absolute top-2 right-1/2 text-xs text-muted/50">-40s</span>
                            <span className="absolute top-2 left-8 text-xs text-muted/50">-80s</span>
                        </div>
                    </div>

                    {/* Animated Bar Chart Foreground */}
                    <div className="absolute inset-0 pb-7 pt-1 pl-8 flex items-end space-x-1 sm:space-x-2 w-full overflow-hidden z-10">
                        {trafficHistory.map((rps, i) => {
                            // Calculate height percentage relative to the dynamic max scale (minimum 2% so it's visible)
                            const heightPercent = Math.max((rps / maxRps) * 100, 2);

                            return (
                                <motion.div
                                    key={i}
                                    animate={{
                                        height: `${heightPercent}%`,
                                        opacity: rps > 0.1 ? 1 : 0.25, // Dim the baseline bars
                                    }}
                                    transition={{ duration: 0.5, ease: "easeOut" }}
                                    className="flex-1 bg-accent rounded-t-sm"
                                    style={{ minWidth: '4px' }}
                                />
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}