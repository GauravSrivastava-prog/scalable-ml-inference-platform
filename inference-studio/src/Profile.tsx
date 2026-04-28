import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Database, Activity, Shield, ArrowLeft, Key, Save, Cpu } from 'lucide-react';
import { apiFetch } from './api';
import { motion } from 'framer-motion';

interface AlgorithmUsage { algorithm: string; count: number; }
interface UserStats {
    total_predictions: number; successful_predictions: number; cache_hits: number;
    avg_latency_ms: number; compute_time_saved_ms: number; total_data_rows_processed: number;
    total_models_trained: number; algorithm_usage: AlgorithmUsage[]; member_since: string;
}

export default function Profile() {
    const navigate = useNavigate();
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Security Form States
    const [newUsername, setNewUsername] = useState('');
    const [currentPassword, setCurrentPassword] = useState(''); // NEW STATE
    const [newPassword, setNewPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateMsg, setUpdateMsg] = useState({ text: '', type: '' });

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await apiFetch('/api/v1/auth/me/stats');
                if (!res.ok) throw new Error('Failed to fetch analytics');
                const data = await res.json();
                setStats(data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const handleUpdateSecurity = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsUpdating(true);
        setUpdateMsg({ text: '', type: '' });

        try {
            const payload = {
                current_password: currentPassword, // Mandated for security
                new_username: newUsername || undefined,
                new_password: newPassword || undefined
            };

            const res = await apiFetch('/api/v1/auth/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setUpdateMsg({ text: 'Credentials updated successfully.', type: 'success' });
                setNewUsername('');
                setCurrentPassword('');
                setNewPassword('');
            } else {
                const errData = await res.json();
                throw new Error(errData.detail || 'Update rejected by server.');
            }
        } catch (err: any) {
            setUpdateMsg({ text: err.message || 'Failed to update credentials.', type: 'error' });
        } finally {
            setIsUpdating(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-accent"></div>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center min-h-screen text-red-400">Error loading profile: {error}</div>
    );

    const formatAlgoName = (name: string) => name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    // Calculate maximum count for the LED scales
    // const maxAlgoCount = stats?.algorithm_usage ? Math.max(...stats.algorithm_usage.map(a => a.count)) : 1;
    const THEME_COLORS = ['bg-cyan-400', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-600'];

    return (
        <div className="min-h-screen bg-transparent relative z-10 font-sans text-primary p-6 sm:p-12 flex flex-col">

            <nav className="flex items-center space-x-4 mb-12 border-b border-white/10 pb-6">
                <button onClick={() => navigate('/studio')} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-white">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-xl font-medium tracking-wide">Operator Profile</h1>
                    <p className="text-sm text-muted">Telemetry & Security Operations</p>
                </div>
            </nav>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <StatCard title="Total Predictions" value={stats?.total_predictions} icon={<Activity size={20} className="text-accent" />} />
                <StatCard title="Cache Hits" value={stats?.cache_hits} icon={<Zap size={20} className="text-yellow-500" />} subtitle="Redis Bypasses" />
                <StatCard title="Data Processed" value={stats?.total_data_rows_processed} icon={<Database size={20} className="text-emerald-500" />} subtitle="Total Rows" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Panel 1: Security Operations */}
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="lg:col-span-1 bg-surface/20 border border-white/10 rounded-2xl p-8 flex flex-col">
                    <h3 className="text-lg font-medium mb-6 flex items-center gap-2">
                        <Shield size={18} className="text-accent" /> Account Operations
                    </h3>

                    <form onSubmit={handleUpdateSecurity} className="space-y-5 flex-1">
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">New Username</label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
                                <input
                                    type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="Enter new username"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">
                                Current Password <span className="text-red-400">*</span>
                            </label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    placeholder="Verify current password"
                                    required
                                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider mb-2 block">New Password</label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted/50" />
                                <input
                                    type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                                />
                            </div>
                        </div>

                        <button type="submit" disabled={isUpdating || (!newUsername && !newPassword)} className="w-full mt-4 bg-white/5 border border-white/10 hover:bg-accent/20 hover:border-accent/50 text-white text-sm font-medium py-2.5 rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                            {isUpdating ? <span className="animate-pulse">Authorizing...</span> : <><Save className="h-4 w-4 mr-2" /> Apply Changes</>}
                        </button>

                        {updateMsg.text && (
                            <div className={`mt-4 text-xs p-3 rounded-lg border ${updateMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                {updateMsg.text}
                            </div>
                        )}
                    </form>
                </motion.div>

                {/* Panel 2: The True Node Grid Matrix */}
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="lg:col-span-2 bg-surface/20 border border-white/10 rounded-2xl p-8 flex flex-col">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h3 className="text-lg font-medium flex items-center gap-2 text-white">
                                <Cpu size={18} className="text-accent" /> Cluster Allocation Matrix
                            </h3>
                            <p className="text-xs text-muted mt-1">Physical distribution of active models across computing nodes</p>
                        </div>
                        <div className="px-3 py-1 bg-black/40 border border-white/10 rounded font-mono text-[10px] text-muted tracking-widest uppercase">
                            Total Nodes: {stats?.total_models_trained}
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col lg:flex-row gap-8">
                        {stats?.algorithm_usage && stats.algorithm_usage.length > 0 ? (
                            <>
                                {/* THE MATRIX GRID */}
                                <div className="flex-1">
                                    <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-1.5">
                                        {/* Flatten the counts into individual nodes */}
                                        {stats.algorithm_usage.flatMap((algo, algoIdx) =>
                                            Array.from({ length: algo.count }).map((_, nodeIdx) => {
                                                const themeColor = THEME_COLORS[algoIdx % THEME_COLORS.length];
                                                return (
                                                    <motion.div
                                                        initial={{ scale: 0, opacity: 0 }}
                                                        animate={{ scale: 1, opacity: 1 }}
                                                        transition={{ delay: (algoIdx * 0.1) + (nodeIdx * 0.02) }}
                                                        key={`${algo.algorithm}-${nodeIdx}`}
                                                        title={formatAlgoName(algo.algorithm)}
                                                        className={`aspect-square rounded-sm ${themeColor} opacity-80 hover:opacity-100 hover:scale-110 transition-all cursor-crosshair shadow-[0_0_10px_currentColor]`}
                                                    />
                                                );
                                            })
                                        )}
                                        {/* Fill remaining empty rack space (60 slots total) */}
                                        {Array.from({ length: Math.max(0, 60 - (stats.total_models_trained || 0)) }).map((_, i) => (
                                            <div key={`empty-${i}`} className="aspect-square rounded-sm bg-white/[0.02] border border-white/[0.05]" />
                                        ))}
                                    </div>
                                </div>

                                {/* THE LEGEND */}
                                <div className="w-full lg:w-48 shrink-0 flex flex-col space-y-4 border-t lg:border-t-0 lg:border-l border-white/10 pt-6 lg:pt-0 lg:pl-6">
                                    <h4 className="text-[10px] font-mono text-muted uppercase tracking-widest mb-2">Topology Legend</h4>
                                    {stats.algorithm_usage.sort((a, b) => b.count - a.count).map((algo, idx) => (
                                        <div key={algo.algorithm} className="flex items-center justify-between group">
                                            <div className="flex items-center space-x-2">
                                                <div className={`w-2.5 h-2.5 rounded-sm ${THEME_COLORS[idx % THEME_COLORS.length]} shadow-[0_0_5px_currentColor]`} />
                                                <span className="text-xs text-white/80 group-hover:text-white transition-colors">{formatAlgoName(algo.algorithm)}</span>
                                            </div>
                                            <span className="text-xs font-mono text-muted">{algo.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="w-full h-48 flex items-center justify-center text-muted/50 border border-dashed border-white/10 rounded-xl">
                                Awaiting cluster topology...
                            </div>
                        )}
                    </div>
                </motion.div>            </div>
        </div>
    );
}

function StatCard({ title, value, icon, subtitle }: any) {
    return (
        <div className="bg-surface/30 border border-white/10 p-6 rounded-2xl shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex justify-between items-start mb-4 relative z-10">
                <span className="text-muted text-sm font-medium">{title}</span>
                {icon}
            </div>
            <div className="text-3xl font-light tracking-tight text-white relative z-10">{value?.toLocaleString() || 0}</div>
            {subtitle && <span className="text-[10px] text-muted uppercase tracking-tighter mt-1 block relative z-10">{subtitle}</span>}
        </div>
    );
}