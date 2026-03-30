import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, Activity, CheckCircle, XCircle, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';

interface PredictionLog {
    id: string;
    model_id: string;
    result: any;
    latency_ms: number;
    status: string;
    created_at: string;
}

export default function History() {
    const navigate = useNavigate();
    const [logs, setLogs] = useState<PredictionLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const response = await apiFetch('/api/v1/predictions/');
                if (response.ok) {
                    const data = await response.json();
                    setLogs(data);
                }
            } catch (error) {
                console.error("Failed to load prediction history", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchHistory();
    }, []);

    return (
        <div className="min-h-screen bg-background font-sans text-primary p-6 sm:p-12">
            {/* Top Nav */}
            <nav className="flex items-center space-x-4 mb-12 border-b border-white/10 pb-6">
                <button onClick={() => navigate('/studio')} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-white">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-xl font-medium tracking-wide">Prediction Ledger</h1>
                    <p className="text-sm text-muted">Immutable audit log of all model inferences</p>
                </div>
            </nav>

            <div className="bg-surface/20 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-white/10 bg-white/[0.02] flex items-center space-x-3">
                    <Database className="h-5 w-5 text-accent" />
                    <h2 className="font-medium text-white tracking-wide">Execution History</h2>
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted">
                        <Activity className="h-10 w-10 mb-4 opacity-20" />
                        <p>No predictions recorded in the ledger yet.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-surface/50 border-b border-white/10 text-muted uppercase tracking-wider text-xs">
                                <tr>
                                    <th className="px-6 py-4 font-medium">Timestamp</th>
                                    <th className="px-6 py-4 font-medium">Model ID</th>
                                    <th className="px-6 py-4 font-medium">Result</th>
                                    <th className="px-6 py-4 font-medium">Latency</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.05]">
                                {logs.map((log) => (
                                    <motion.tr
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                        key={log.id}
                                        className="hover:bg-white/[0.02] transition-colors group"
                                    >
                                        <td className="px-6 py-4 text-muted flex items-center space-x-2">
                                            <Clock className="h-4 w-4 opacity-50" />
                                            <span>{new Date(log.created_at).toLocaleString()}</span>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-xs text-white/70">
                                            {log.model_id.split('-')[0]}...
                                        </td>
                                        <td className="px-6 py-4 font-medium text-white">
                                            {String(log.result)}
                                        </td>
                                        <td className="px-6 py-4 text-muted">
                                            {log.latency_ms ? `${log.latency_ms.toFixed(2)}ms` : '--'}
                                        </td>
                                        <td className="px-6 py-4">
                                            {log.status === 'completed' ? (
                                                <span className="flex items-center space-x-1 text-green-400 bg-green-400/10 px-2 py-1 rounded-md w-fit border border-green-400/20">
                                                    <CheckCircle className="h-3 w-3" />
                                                    <span className="text-xs uppercase tracking-wider">Success</span>
                                                </span>
                                            ) : (
                                                <span className="flex items-center space-x-1 text-red-400 bg-red-400/10 px-2 py-1 rounded-md w-fit border border-red-400/20">
                                                    <XCircle className="h-3 w-3" />
                                                    <span className="text-xs uppercase tracking-wider">Failed</span>
                                                </span>
                                            )}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}