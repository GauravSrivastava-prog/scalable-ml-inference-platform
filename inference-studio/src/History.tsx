import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, Clock, CheckCircle2, XCircle, ChevronDown, Code, Box, ArrowLeft } from 'lucide-react';
import { apiFetch } from './api'; // Adjust this import based on your actual api utility

export default function History() {
    const [predictions, setPredictions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // NEW: A cache to store the heavy JSON payloads as we fetch them
    const [payloadCache, setPayloadCache] = useState<Record<string, any>>({});
    const [isFetchingPayload, setIsFetchingPayload] = useState(false);

    useEffect(() => {
        const fetchLedger = async () => {
            try {
                const res = await apiFetch('/api/v1/predictions/');
                if (res.ok) {
                    const data = await res.json();
                    setPredictions(data);
                }
            } catch (error) {
                console.error("Failed to load history:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchLedger();
    }, []);

    // --- Derived KPIs ---
    const totalRuns = predictions.length;
    const successfulRuns = predictions.filter(p => p.status === 'completed').length;
    const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;
    const avgLatency = totalRuns > 0
        ? (predictions.reduce((acc, p) => acc + (p.latency_ms || 0), 0) / totalRuns).toFixed(1)
        : 0;

    // NEW: The Lazy-Fetch mechanism
    const toggleExpand = async (id: string) => {
        // If clicking the already open row, just close it
        if (expandedId === id) {
            setExpandedId(null);
            return;
        }

        // Open the row
        setExpandedId(id);

        // If we haven't downloaded this payload yet, go get it!
        if (!payloadCache[id]) {
            setIsFetchingPayload(true);
            try {
                const res = await apiFetch(`/api/v1/predictions/${id}`);
                if (res.ok) {
                    const detailData = await res.json();
                    setPayloadCache(prev => ({
                        ...prev,
                        [id]: detailData.input_data // Store the heavy data
                    }));
                }
            } catch (error) {
                console.error("Failed to fetch payload details:", error);
            } finally {
                setIsFetchingPayload(false);
            }
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col space-y-6 p-6 sm:p-12 text-primary font-sans">
            {/* Header */}
            <div className="flex items-center space-x-3 border-b border-white/10 pb-6 shrink-0">
                {/* --- NEW BACK BUTTON --- */}
                <button
                    onClick={() => window.history.back()} // (Or use React Router's useNavigate() if you prefer)
                    className="p-2 -ml-2 mr-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-muted hover:text-white"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                {/* ----------------------- */}

                <Database className="h-6 w-6 text-accent" />
                <div>
                    <h1 className="text-xl font-medium tracking-wide">Execution History</h1>
                    <p className="text-sm text-muted">Immutable audit log of all model inferences</p>
                </div>
            </div>

            {/* KPI Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
                <div className="bg-surface/30 border border-white/10 rounded-xl p-5 flex items-center space-x-4">
                    <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
                        <Activity className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Inferences</p>
                        <p className="text-2xl font-semibold">{totalRuns}</p>
                    </div>
                </div>
                <div className="bg-surface/30 border border-white/10 rounded-xl p-5 flex items-center space-x-4">
                    <div className="p-3 bg-green-500/10 text-green-400 rounded-lg">
                        <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Success Rate</p>
                        <p className="text-2xl font-semibold">{successRate}%</p>
                    </div>
                </div>
                <div className="bg-surface/30 border border-white/10 rounded-xl p-5 flex items-center space-x-4">
                    <div className="p-3 bg-purple-500/10 text-purple-400 rounded-lg">
                        <Clock className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Avg Latency</p>
                        <p className="text-2xl font-semibold font-mono">{avgLatency}<span className="text-sm text-muted ml-1">ms</span></p>
                    </div>
                </div>
            </div>

            {/* Interactive Activity Feed */}
            <div className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl">
                <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                    <h2 className="text-sm font-medium text-white tracking-wide">Recent Activity</h2>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                    <AnimatePresence>
                        {predictions.length === 0 ? (
                            <div className="p-12 text-center text-muted">
                                <Box className="h-8 w-8 mx-auto mb-3 opacity-20" />
                                <p>No inferences recorded yet.</p>
                            </div>
                        ) : (
                            predictions.map((record) => (
                                <motion.div
                                    key={record.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`border rounded-lg transition-colors overflow-hidden ${expandedId === record.id ? 'bg-white/[0.04] border-white/20' : 'bg-transparent border-white/5 hover:border-white/10 hover:bg-white/[0.02]'}`}
                                >
                                    {/* Clickable Header Row */}
                                    <div
                                        onClick={() => toggleExpand(record.id)}
                                        className="flex items-center justify-between p-4 cursor-pointer select-none"
                                    >
                                        <div className="flex items-center space-x-4 w-1/3">
                                            {record.status === 'completed' ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                                            ) : (
                                                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                                            )}
                                            <div className="truncate">
                                                <p className="text-sm font-medium text-white/90 truncate">{record.result !== null ? String(record.result) : 'Error'}</p>
                                                <p className="text-[10px] text-muted font-mono mt-0.5 truncate">{record.model_id}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-end space-x-8 w-2/3">
                                            <div className="hidden sm:block text-right">
                                                <p className="text-[10px] text-muted uppercase tracking-wider">Latency</p>
                                                <p className="text-xs font-mono text-white/70">{record.latency_ms}ms</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-muted uppercase tracking-wider">Timestamp</p>
                                                <p className="text-xs text-white/70">{new Date(record.created_at).toLocaleString()}</p>
                                            </div>
                                            <ChevronDown className={`h-4 w-4 text-muted transition-transform duration-200 ${expandedId === record.id ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>

                                    {/* Expandable JSON Payload Section */}
                                    <AnimatePresence>
                                        {expandedId === record.id && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="border-t border-white/5 bg-[#050505]"
                                            >
                                                <div className="p-4 flex flex-col sm:flex-row gap-4">
                                                    <div className="flex-1">
                                                        <div className="flex items-center space-x-2 mb-2">
                                                            <Code className="h-3 w-3 text-accent" />
                                                            <span className="text-xs font-medium text-muted uppercase">Input Payload</span>
                                                        </div>
                                                        <pre className="bg-[#111] border border-white/5 p-3 rounded-lg text-xs font-mono text-green-400/80 overflow-x-auto min-h-[60px]">
                                                            {(() => {
                                                                if (isFetchingPayload && !payloadCache[record.id]) return <span className="text-muted/50 italic animate-pulse">Fetching payload...</span>;

                                                                const payloadData = payloadCache[record.id];
                                                                if (!payloadData) return <span className="text-muted/50 italic">No payload data recorded for this inference.</span>;

                                                                try {
                                                                    const parsedData = typeof payloadData === 'string'
                                                                        ? JSON.parse(payloadData)
                                                                        : payloadData;
                                                                    return JSON.stringify(parsedData, null, 2);
                                                                } catch (e) {
                                                                    return String(payloadData);
                                                                }
                                                            })()}
                                                        </pre>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}