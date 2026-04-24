import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid
} from 'recharts';
import { Zap, Database, Activity, Award, ArrowLeft } from 'lucide-react';
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

    if (loading) return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-accent"></div>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center min-h-screen text-red-400">
            Error loading profile: {error}
        </div>
    );

    // Helper to format raw database strings like "random_forest" into "Random Forest"
    const formatAlgoName = (name: string) => {
        return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    return (
        <div className="min-h-screen bg-transparent relative z-10 font-sans text-primary p-6 sm:p-12 flex flex-col">

            {/* Back Navigation */}
            <nav className="flex items-center space-x-4 mb-12 border-b border-white/10 pb-6">
                <button
                    onClick={() => navigate('/studio')}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-white"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-xl font-medium tracking-wide">Your Profile</h1>
                    <p className="text-sm text-muted">Inference Studio Analytics</p>
                </div>
            </nav>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <StatCard title="Total Predictions" value={stats?.total_predictions} icon={<Activity size={20} className="text-accent" />} />
                <StatCard title="Cache Hits" value={stats?.cache_hits} icon={<Zap size={20} className="text-yellow-500" />} subtitle="Redis Bypasses" />
                <StatCard title="Data Processed" value={stats?.total_data_rows_processed} icon={<Database size={20} className="text-emerald-500" />} subtitle="Total Rows" />
            </div>

            {/* Algorithm Bar Chart Section */}
            <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-surface/20 border border-white/10 rounded-2xl p-8 flex-1 min-h-[400px] flex flex-col"
            >
                <h3 className="text-lg font-medium mb-8 flex items-center gap-2 shrink-0">
                    <Award size={18} className="text-accent" /> Algorithm Utilization Matrix
                </h3>

                {/* FIX: Explicit min-height forces Recharts to actually render */}
                <div className="flex-1 w-full relative min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats?.algorithm_usage} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis
                                dataKey="algorithm"
                                tickFormatter={formatAlgoName}
                                tick={{ fill: '#a3a3a3', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                dy={10}
                            />
                            <YAxis
                                tick={{ fill: '#a3a3a3', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                allowDecimals={false}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                                contentStyle={{ backgroundColor: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                labelFormatter={(label) => formatAlgoName(label as string)}
                            />
                            <Bar dataKey="count" name="Models Trained" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={60} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </motion.div>
        </div>
    );
}

function StatCard({ title, value, icon, subtitle }: any) {
    return (
        <div className="bg-surface/30 border border-white/10 p-6 rounded-2xl shadow-sm">
            <div className="flex justify-between items-start mb-4">
                <span className="text-muted text-sm font-medium">{title}</span>
                {icon}
            </div>
            <div className="text-2xl font-bold font-mono">{value?.toLocaleString() || 0}</div>
            {subtitle && <span className="text-[10px] text-muted uppercase tracking-tighter mt-1">{subtitle}</span>}
        </div>
    );
}