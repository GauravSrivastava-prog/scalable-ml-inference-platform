/**
 * Mission Control — Real-Time Observability Dashboard
 *
 * Consumes usePrometheusTelemetry (polls /api/v1/predictions/telemetry/mission-control
 * every 5 s) and renders four Bento Box cards:
 *   Zone 1 — Ingress & Security (Cloudflare)
 *   Zone 2 — Worker Pool Saturation (Celery)
 *   Zone 3 — Tiered Cache Matrix
 *   Zone 4 — P95 Inference Sparkline (EKG)
 */

import { useEffect } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { ArrowLeft, Shield, Cpu, Database, Activity, WifiOff, Radio, Book, Info } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { usePrometheusTelemetry } from './hooks/usePrometheusTelemetry';

// ─── Animated Number ──────────────────────────────────────────────────────────
function AnimatedNumber({
    value,
    decimals = 0,
    className = '',
}: {
    value: number;
    decimals?: number;
    className?: string;
}) {
    const spring = useSpring(value, { stiffness: 90, damping: 20 });
    const display = useTransform(spring, (v) => v.toFixed(decimals));

    useEffect(() => {
        spring.set(value);
    }, [value, spring]);

    return <motion.span className={className}>{display}</motion.span>;
}

// ─── SVG Circular Dial ────────────────────────────────────────────────────────
function CircularDial({
    value,
    label,
    color,
    size = 80,
}: {
    value: number;           // 0–100
    label: string;
    color: string;           // Tailwind stroke class (passed as inline style instead)
    size?: number;
}) {
    const radius = (size - 12) / 2;
    const circumference = 2 * Math.PI * radius;
    const clampedValue = Math.min(100, Math.max(0, value));
    const dashOffset = circumference - (clampedValue / 100) * circumference;

    return (
        <div className="flex flex-col items-center gap-1.5">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
                {/* Track */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth={6}
                />
                {/* Glow filter */}
                <defs>
                    <filter id={`dial-glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                {/* Progress arc */}
                <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: dashOffset }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    filter={`url(#dial-glow-${label})`}
                />
                {/* Center value */}
                <text
                    x={size / 2}
                    y={size / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize="13"
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                    fontWeight="600"
                >
                    {clampedValue.toFixed(0)}%
                </text>
            </svg>
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest text-center leading-tight">
                {label}
            </span>
        </div>
    );
}

// ─── P95 EKG Sparkline ────────────────────────────────────────────────────────
function EkgSparkline({ data }: { data: number[] }) {
    const formattedChartData = data?.map((value, index) => ({ 
        time: `-${30 - index}s`, 
        latency: value 
    })) || [];

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedChartData} margin={{ top: 10, right: 10, left: -20, bottom: -10 }}>
                <defs>
                    <filter id="ekg-glow" x="-20%" y="-50%" width="140%" height="200%">
                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <linearGradient id="ekg-area-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" strokeOpacity={0.1} vertical={false} />
                <XAxis 
                    dataKey="time" 
                    hide={false}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                />
                <YAxis 
                    hide={false}
                    tickFormatter={(value) => `${value}ms`}
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                />
                <Area 
                    type="monotone" 
                    dataKey="latency" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#ekg-area-fill)" 
                    isAnimationActive={false}
                    style={{ filter: 'url(#ekg-glow)' }}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}

// ─── Worker Capacity Bar ──────────────────────────────────────────────────────
function WorkerCapacityBar({ active, total }: { active: number; total: number }) {
    const pct = total > 0 ? (active / total) * 100 : 0;
    const segments = Array.from({ length: total }, (_, i) => i < active);

    return (
        <div className="flex gap-1.5 w-full mt-1">
            {segments.map((isActive, i) => (
                <motion.div
                    key={i}
                    className="flex-1 h-5 rounded-sm"
                    style={{
                        background: isActive
                            ? 'linear-gradient(135deg, #10b981, #059669)'
                            : 'rgba(255,255,255,0.06)',
                        boxShadow: isActive ? '0 0 8px rgba(16,185,129,0.5)' : 'none',
                    }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                />
            ))}
        </div>
    );
}

// ─── Bento Card Shell ─────────────────────────────────────────────────────────
function BentoCard({
    children,
    className = '',
    glowColor,
    warningGlow = false,
}: {
    children: React.ReactNode;
    className?: string;
    glowColor?: string;
    warningGlow?: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface/20 backdrop-blur-md p-6 flex flex-col ${className}`}
            style={{
                boxShadow: warningGlow
                    ? '0 0 30px rgba(245,158,11,0.12), inset 0 0 1px rgba(245,158,11,0.15)'
                    : glowColor
                    ? `0 0 30px ${glowColor}14, inset 0 0 1px ${glowColor}20`
                    : '0 0 0 rgba(0,0,0,0)',
            }}
        >
            {/* Ambient top-edge highlight */}
            <div
                className="absolute top-0 left-0 right-0 h-px opacity-50"
                style={{
                    background: warningGlow
                        ? 'linear-gradient(90deg, transparent, #f59e0b44, transparent)'
                        : glowColor
                        ? `linear-gradient(90deg, transparent, ${glowColor}44, transparent)`
                        : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
                }}
            />
            {children}
        </motion.div>
    );
}

// ─── Reconnecting Overlay ─────────────────────────────────────────────────────
function ReconnectingOverlay() {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
            <div className="flex flex-col items-center gap-4 text-center">
                <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                    className="p-4 rounded-full"
                    style={{ boxShadow: '0 0 40px rgba(239,68,68,0.4)' }}
                >
                    <WifiOff className="h-8 w-8 text-red-400" />
                </motion.div>
                <div>
                    <p className="font-mono text-sm text-red-400 uppercase tracking-widest">
                        Reconnecting to Cluster...
                    </p>
                    <p className="text-xs text-white/30 mt-1 font-mono">
                        Prometheus scrape failed. Retrying in 5s.
                    </p>
                </div>
                <div className="flex gap-1.5">
                    {[0, 0.2, 0.4].map((delay) => (
                        <motion.div
                            key={delay}
                            className="h-1.5 w-1.5 rounded-full bg-red-400"
                            animate={{ opacity: [0.2, 1, 0.2] }}
                            transition={{ repeat: Infinity, duration: 1.2, delay }}
                        />
                    ))}
                </div>
            </div>
        </motion.div>
    );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function SkeletonCard({ className = '' }: { className?: string }) {
    return (
        <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 overflow-hidden relative ${className}`}>
            <motion.div
                className="absolute inset-0"
                style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
                    backgroundSize: '200% 100%',
                }}
                animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'linear' }}
            />
            <div className="h-3 w-24 bg-white/5 rounded mb-4" />
            <div className="h-8 w-16 bg-white/5 rounded mb-2" />
            <div className="h-2 w-32 bg-white/5 rounded" />
        </div>
    );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Pulse() {
    const navigate = useNavigate();
    const telemetry = usePrometheusTelemetry();

    const {
        tunnelLatency,
        blockedRequests,
        workerStatus,
        cacheMatrix,
        p95Sparkline,
        isLoading,
        isReconnecting,
        prometheusLive,
        lastUpdated,
        successRate,
        activeModels,
    } = telemetry;

    // ── Dynamic Insight Engine ──
    const renderLatencyInsight = () => {
        if (tunnelLatency < 50) {
            return <span className="text-[#34d399]/80">Optimal. Low-overhead processing executed out of thread-pooled memory.</span>;
        } else if (tunnelLatency <= 200) {
            return <span className="text-[#fbbf24]/80">Moderate. Traffic spike or cold-start binary initialization active.</span>;
        } else {
            return <span className="text-[#f87171]/80 animate-pulse">Degraded. Thread contention or blocking storage fallback loop detected.</span>;
        }
    };

    const renderModelInsight = () => {
        if (activeModels > 0) {
            return <span className="text-[#34d399]/80">Cluster online. Worker instances synchronized with stateful localized caches.</span>;
        } else {
            return <span className="text-white/50">Awaiting topology. No active binaries deployed to shared worker mounts.</span>;
        }
    };

    const renderSuccessInsight = () => {
        if (successRate >= 99) {
            return <span className="text-[#34d399]/80">Healthy. All execution lanes resolving inside worker loops without exceptions.</span>;
        } else {
            return <span className="text-[#fbbf24]/80">Anomalous. Elevated exception rate; review dead-letter queue logs immediately.</span>;
        }
    };

    const queueWarning = workerStatus.queueDepth > 0;

    const p95Current = p95Sparkline[p95Sparkline.length - 1] ?? 0;
    const p95Avg = p95Sparkline.reduce((a, b) => a + b, 0) / p95Sparkline.length;
    const p95Peak = Math.max(...p95Sparkline);

    return (
        <div className="min-h-screen bg-transparent relative z-10 font-sans text-white flex flex-col">

            {/* ── Reconnecting overlay ── */}
            <AnimatePresence>
                {isReconnecting && <ReconnectingOverlay />}
            </AnimatePresence>

            {/* ── Top nav bar ── */}
            <nav className="h-16 flex items-center gap-4 px-4 sm:px-8 border-b border-white/[0.06] bg-black/30 backdrop-blur-md shrink-0">
                <button
                    onClick={() => navigate('/studio')}
                    aria-label="Back to Studio"
                    className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Radio className="h-4 w-4 text-blue-400 shrink-0" />
                        <h1 className="text-sm font-medium tracking-wide truncate">
                            Mission Control
                        </h1>
                    </div>
                    <span className="hidden sm:inline text-[10px] font-mono text-white/20 uppercase tracking-widest">
                        / Observability Dashboard
                    </span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    {/* Prometheus source badge */}
                    <div
                        className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-md border"
                        style={
                            prometheusLive
                                ? { color: '#34d399', background: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)' }
                                : { color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }
                        }
                    >
                        <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                                background: prometheusLive ? '#34d399' : '#f59e0b',
                                boxShadow: prometheusLive
                                    ? '0 0 6px rgba(52,211,153,0.8)'
                                    : '0 0 6px rgba(245,158,11,0.8)',
                                animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
                            }}
                        />
                        {prometheusLive ? 'Prometheus' : 'DB Fallback'}
                    </div>

                    {lastUpdated && (
                        <span className="hidden md:block text-[10px] font-mono text-white/20">
                            Updated {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </nav>

            {/* ── Bento Grid ── */}
            <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full overflow-y-auto">

                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                        <SkeletonCard className="min-h-[250px]" />
                        <SkeletonCard className="min-h-[250px]" />
                        <SkeletonCard className="min-h-[250px]" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 w-full">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">

                        {/* ══════════════════════════════════════════════
                            ZONE 1 — Ingress & Security (Cloudflare)
                        ══════════════════════════════════════════════ */}
                        <BentoCard glowColor="#3b82f6" className="min-h-[200px] flex flex-col justify-between">
                            {/* Card header */}
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="p-1.5 rounded-lg"
                                        style={{ background: 'rgba(59,130,246,0.12)' }}
                                    >
                                        <Shield className="h-3.5 w-3.5 text-blue-400" />
                                    </div>
                                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                        Ingress &amp; Security
                                    </span>
                                </div>
                                <span className="text-[9px] font-mono text-white/20 tracking-widest uppercase">
                                    Cloudflare
                                </span>
                            </div>

                            {/* Edge-to-Metal Latency */}
                            <div className="mb-5">
                                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1.5">
                                    Edge-to-Metal Latency
                                </p>
                                <div className="flex items-center gap-3">
                                    {/* Pulsing green status dot */}
                                    <span
                                        className="h-2.5 w-2.5 rounded-full shrink-0"
                                        style={{
                                            background: '#34d399',
                                            boxShadow: '0 0 0 0 rgba(52,211,153,0.7)',
                                            animation: 'ping-green 2s cubic-bezier(0,0,0.2,1) infinite',
                                        }}
                                    />
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-4xl font-mono font-light text-white tabular-nums">
                                            <AnimatedNumber value={tunnelLatency} decimals={0} />
                                        </span>
                                        <span className="text-base font-mono text-white/30">ms</span>
                                    </div>
                                </div>
                            </div>

                            {/* Divider */}
                            <div className="h-px bg-white/[0.06] mb-5" />

                            {/* Zero-Trust Packets Dropped */}
                            <div>
                                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">
                                    Zero-Trust Packets Dropped
                                </p>
                                <div className="flex items-center gap-3">
                                    <div
                                        className="text-3xl font-mono font-semibold tabular-nums"
                                        style={{
                                            color: blockedRequests > 0 ? '#f87171' : '#4ade80',
                                            textShadow: blockedRequests > 0
                                                ? '0 0 20px rgba(248,113,113,0.6)'
                                                : '0 0 12px rgba(74,222,128,0.4)',
                                        }}
                                    >
                                        <AnimatedNumber value={blockedRequests} decimals={0} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
                                            packets
                                        </span>
                                        <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
                                            {blockedRequests > 0 ? 'blocked' : 'all clear'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs text-muted/70 tracking-normal mt-3 block pt-3 border-t border-white/[0.04]">
                                {renderLatencyInsight()}
                            </div>
                        </BentoCard>

                        {/* ══════════════════════════════════════════════
                            ZONE 2 — Worker Pool Saturation (Celery)
                        ══════════════════════════════════════════════ */}
                        <BentoCard
                            glowColor="#10b981"
                            warningGlow={queueWarning}
                            className="min-h-[200px] flex flex-col justify-between"
                        >
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="p-1.5 rounded-lg"
                                        style={{
                                            background: queueWarning
                                                ? 'rgba(245,158,11,0.12)'
                                                : 'rgba(16,185,129,0.12)',
                                        }}
                                    >
                                        <Cpu
                                            className="h-3.5 w-3.5"
                                            style={{ color: queueWarning ? '#f59e0b' : '#10b981' }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                        Worker Pool
                                    </span>
                                </div>
                                {/* Amber warning glow badge if queue > 0 */}
                                <AnimatePresence>
                                    {queueWarning && (
                                        <motion.span
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full"
                                            style={{
                                                color: '#f59e0b',
                                                background: 'rgba(245,158,11,0.12)',
                                                border: '1px solid rgba(245,158,11,0.3)',
                                                boxShadow: '0 0 10px rgba(245,158,11,0.2)',
                                                animation: 'pulse 2s infinite',
                                            }}
                                        >
                                            Queue Pressure
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                                <span className="text-[9px] font-mono text-white/20 tracking-widest uppercase">
                                    Celery
                                </span>
                            </div>

                            {/* Active Workers */}
                            <div className="mb-4">
                                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">
                                    Active Workers
                                </p>
                                <div className="flex items-baseline gap-1 mb-2">
                                    <span
                                        className="text-4xl font-mono font-light tabular-nums"
                                        style={{ color: queueWarning ? '#f59e0b' : '#10b981' }}
                                    >
                                        <AnimatedNumber value={workerStatus.active} decimals={0} />
                                    </span>
                                    <span className="text-xl font-mono text-white/20">
                                        / {workerStatus.total}
                                    </span>
                                </div>
                                <WorkerCapacityBar
                                    active={workerStatus.active}
                                    total={workerStatus.total}
                                />
                            </div>

                            {/* Queue depth */}
                            <div className="mt-auto pt-4 border-t border-white/[0.06]">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
                                        Pending Tasks
                                    </span>
                                    <span className="text-[10px] font-mono text-white/20 tracking-widest">
                                        queue:ml_training
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1.5">
                                    <span
                                        className="text-2xl font-mono font-semibold tabular-nums"
                                        style={{
                                            color: workerStatus.queueDepth > 0 ? '#fbbf24' : '#34d399',
                                            textShadow: workerStatus.queueDepth > 0
                                                ? '0 0 16px rgba(251,191,36,0.5)'
                                                : '0 0 10px rgba(52,211,153,0.4)',
                                        }}
                                    >
                                        <AnimatedNumber value={workerStatus.queueDepth} decimals={0} />
                                    </span>
                                    <span className="text-[10px] font-mono text-white/20">
                                        {workerStatus.queueDepth === 1 ? 'task' : 'tasks'}
                                    </span>
                                </div>
                            </div>
                            <div className="text-xs text-muted/70 tracking-normal mt-3 block pt-3 border-t border-white/[0.04]">
                                {renderModelInsight()}
                            </div>
                        </BentoCard>

                        {/* ══════════════════════════════════════════════
                            ZONE 3 — Tiered Cache Matrix
                        ══════════════════════════════════════════════ */}
                        <BentoCard glowColor="#8b5cf6" className="min-h-[200px] flex flex-col justify-between">
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="p-1.5 rounded-lg"
                                        style={{ background: 'rgba(139,92,246,0.12)' }}
                                    >
                                        <Database className="h-3.5 w-3.5 text-violet-400" />
                                    </div>
                                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                        Cache Matrix
                                    </span>
                                </div>
                                <span className="text-[9px] font-mono text-white/20 tracking-widest uppercase">
                                    Tiered
                                </span>
                            </div>

                            {/* Three dials */}
                            <div className="flex items-center justify-around flex-1">
                                <CircularDial
                                    value={cacheMatrix.tier1}
                                    label={"Tier 1\nRAM"}
                                    color="#3b82f6"
                                    size={88}
                                />
                                <CircularDial
                                    value={cacheMatrix.tier2}
                                    label={"Tier 2\nRedis"}
                                    color="#ef4444"
                                    size={88}
                                />
                                <CircularDial
                                    value={cacheMatrix.misses}
                                    label={"Miss\nSupabase"}
                                    color="#6b7280"
                                    size={88}
                                />
                            </div>

                            {/* Legend */}
                            <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-white/[0.06]">
                                {[
                                    { color: '#3b82f6', label: 'RAM Hit' },
                                    { color: '#ef4444', label: 'Redis Hit' },
                                    { color: '#6b7280', label: 'Miss' },
                                ].map(({ color, label }) => (
                                    <div key={label} className="flex items-center gap-1.5">
                                        <div
                                            className="h-1.5 w-3 rounded-full"
                                            style={{ background: color }}
                                        />
                                        <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
                                            {label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="text-xs text-muted/70 tracking-normal mt-3 block pt-3 border-t border-white/[0.04]">
                                {renderSuccessInsight()}
                            </div>
                        </BentoCard>
                        </div> {/* end of 3-col grid */}

                        {/* ══════════════════════════════════════════════
                            ZONE 4 — P95 Inference Sparkline (EKG)
                        ══════════════════════════════════════════════ */}
                        <BentoCard glowColor="#3b82f6" className="w-full min-h-[200px] flex flex-col justify-between">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="p-1.5 rounded-lg"
                                        style={{ background: 'rgba(59,130,246,0.12)' }}
                                    >
                                        <Activity className="h-3.5 w-3.5 text-blue-400" />
                                    </div>
                                    <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                        P95 Latency
                                    </span>
                                </div>

                                {/* Live badge */}
                                <div className="flex items-center gap-1.5">
                                    <motion.span
                                        className="h-1.5 w-1.5 rounded-full bg-blue-400"
                                        animate={{ opacity: [1, 0.2, 1] }}
                                        transition={{ repeat: Infinity, duration: 1.4 }}
                                    />
                                    <span className="text-[9px] font-mono text-blue-400/60 uppercase tracking-widest">
                                        Live
                                    </span>
                                </div>
                            </div>

                            {/* Current value */}
                            <div className="flex items-baseline gap-2 mb-3">
                                <span
                                    className="text-3xl font-mono font-light tabular-nums"
                                    style={{
                                        color: '#3b82f6',
                                        textShadow: '0 0 20px rgba(59,130,246,0.5)',
                                        filter: 'drop-shadow(0 0 8px rgba(59,130,246,0.6))',
                                    }}
                                >
                                    <AnimatedNumber value={p95Current} decimals={1} />
                                </span>
                                <span className="text-sm font-mono text-white/20">ms</span>
                            </div>

                            {/* EKG chart area */}
                            <div
                                className="flex-1 w-full rounded-lg overflow-hidden relative"
                                style={{
                                    background: 'rgba(59,130,246,0.03)',
                                    border: '1px solid rgba(59,130,246,0.08)',
                                    height: '200px',
                                    filter: 'drop-shadow(0 0 6px rgba(59,130,246,0.15))',
                                    paddingTop: '10px'
                                }}
                            >
                                <EkgSparkline data={p95Sparkline} />
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                                {[
                                    { label: 'Current', value: `${p95Current.toFixed(1)}ms` },
                                    { label: 'Avg', value: `${p95Avg.toFixed(1)}ms` },
                                    { label: 'Peak', value: `${p95Peak.toFixed(1)}ms` },
                                ].map(({ label, value }) => (
                                    <div key={label} className="flex flex-col items-center">
                                        <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">
                                            {label}
                                        </span>
                                        <span className="text-xs font-mono text-white/70 mt-0.5">
                                            {value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </BentoCard>
                        
                        {/* ── Telemetry Glossary ── */}
                        <hr className="border-white/[0.04] my-8" />
                        <div>
                            <h2 className="text-sm text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Book className="w-4 h-4" />
                                Telemetry Glossary
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Card 1 */}
                                <div className="bg-black/20 border border-white/[0.04] p-5 rounded-xl">
                                    <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                                        <Info className="w-4 h-4 text-gray-500" />
                                        Total Cluster Volume
                                    </h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">
                                        The absolute sum of all inference requests processed by the platform. This reflects the lifetime historical data throughput successfully evaluated by the model worker nodes.
                                    </p>
                                </div>
                                {/* Card 2 */}
                                <div className="bg-black/20 border border-white/[0.04] p-5 rounded-xl">
                                    <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                                        <Info className="w-4 h-4 text-gray-500" />
                                        P95 Latency
                                    </h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">
                                        The maximum processing time for the fastest 95% of requests. This is a strict enterprise metric that filters out extreme network outliers to show the true performance experienced by the vast majority of users.
                                    </p>
                                </div>
                                {/* Card 3 */}
                                <div className="bg-black/20 border border-white/[0.04] p-5 rounded-xl">
                                    <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                                        <Info className="w-4 h-4 text-gray-500" />
                                        Active Models
                                    </h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">
                                        The total number of compiled Machine Learning binaries currently loaded into the shared memory state, ready for instant, zero-cold-start inference.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </main>

            {/* ── Inline keyframe styles for custom animations ── */}
            <style>{`
                @keyframes ping-green {
                    0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.7); }
                    70%  { box-shadow: 0 0 0 8px rgba(52,211,153,0); }
                    100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
                }
            `}</style>
        </div>
    );
}