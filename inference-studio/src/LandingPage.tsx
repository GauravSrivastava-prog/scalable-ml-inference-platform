import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Github, ArrowRight, Terminal, ShieldCheck, TrendingUp, GitMerge, Network, Box, FileDown, Cpu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from './routes';
import { usePrewarmCluster } from './hooks/usePrewarmCluster';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { SceneCleanup } from './components/SceneCleanup';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════
   3D COMPONENTS – rendered inside <Canvas>
   ═══════════════════════════════════════════════════════════════════ */

function DataRing({ radius, y, speed, color }: { radius: number; y: number; speed: number; color: string }) {
    const ref = useRef<THREE.Mesh>(null!);
    useFrame((_, delta) => {
        ref.current.rotation.y += delta * speed;
        ref.current.rotation.x += delta * speed * 0.3;
    });
    return (
        <mesh ref={ref} position={[0, y, 0]}>
            <torusGeometry args={[radius, 0.02, 16, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.35} wireframe />
        </mesh>
    );
}

function ChaoticCloud({ count }: { count: number }) {
    const ref = useRef<THREE.Points>(null!);
    const positions = useMemo(() => {
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 1.8 + Math.random() * 1.2;
            arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            arr[i * 3 + 1] = 2.0 + Math.random() * 1.5;
            arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        return arr;
    }, [count]);

    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const pos = ref.current.geometry.attributes.position;
        for (let i = 0; i < count; i++) {
            const ix = i * 3;
            pos.array[ix] += Math.sin(t + i) * 0.001;
            pos.array[ix + 2] += Math.cos(t + i * 0.7) * 0.001;
        }
        pos.needsUpdate = true;
    });

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial size={0.03} color="#7c3aed" transparent opacity={0.7} sizeAttenuation />
        </points>
    );
}

function StructuredCore() {
    const ref = useRef<THREE.Mesh>(null!);
    useFrame((state) => {
        ref.current.rotation.y = state.clock.elapsedTime * 0.15;
        ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.2;
    });
    return (
        <mesh ref={ref} position={[0, -2.2, 0]} scale={1.1}>
            <icosahedronGeometry args={[1, 1]} />
            <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.45} />
        </mesh>
    );
}

function FunnelBeam() {
    const ref = useRef<THREE.Mesh>(null!);
    useFrame((state) => {
        const s = 0.85 + Math.sin(state.clock.elapsedTime * 2) * 0.15;
        ref.current.scale.set(s, 1, s);
    });
    return (
        <mesh ref={ref} position={[0, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 5, 8]} />
            <meshBasicMaterial color="#6366f1" transparent opacity={0.2} />
        </mesh>
    );
}

function OrbitNode({ orbitRadius, speed, y, size, color }: { orbitRadius: number; speed: number; y: number; size: number; color: string }) {
    const ref = useRef<THREE.Mesh>(null!);
    useFrame((state) => {
        const t = state.clock.elapsedTime * speed;
        ref.current.position.x = Math.cos(t) * orbitRadius;
        ref.current.position.z = Math.sin(t) * orbitRadius;
        ref.current.position.y = y + Math.sin(t * 1.5) * 0.15;
    });
    return (
        <mesh ref={ref}>
            <sphereGeometry args={[size, 16, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.8} />
        </mesh>
    );
}

function TensorGrid() {
    return (
        <Float speed={1.2} rotationIntensity={0.4} floatIntensity={0.6}>
            <group>
                <ChaoticCloud count={300} />
                <DataRing radius={2.2} y={2.0} speed={0.3} color="#7c3aed" />
                <DataRing radius={1.7} y={1.2} speed={-0.25} color="#6366f1" />
                <DataRing radius={1.2} y={0.4} speed={0.2} color="#818cf8" />
                <DataRing radius={0.8} y={-0.4} speed={-0.35} color="#3b82f6" />
                <DataRing radius={0.5} y={-1.2} speed={0.4} color="#60a5fa" />
                <FunnelBeam />
                <StructuredCore />
                <OrbitNode orbitRadius={2.5} speed={0.4} y={1.8} size={0.06} color="#a78bfa" />
                <OrbitNode orbitRadius={1.9} speed={-0.55} y={0.8} size={0.05} color="#818cf8" />
                <OrbitNode orbitRadius={1.1} speed={0.7} y={-0.5} size={0.04} color="#60a5fa" />
                <OrbitNode orbitRadius={0.7} speed={-0.9} y={-1.8} size={0.05} color="#93c5fd" />
            </group>
        </Float>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   TOPOLOGY MAP – Types, Constants & Configuration
   ═══════════════════════════════════════════════════════════════════ */

type RouteKey = 'auth_login' | 'get_models' | 'train_model' | 'predict_hit' | 'predict_miss' | 'telemetry_live';

interface LogEntry { text: string; color: string }

interface MapState {
    active: RouteKey | null;
    pulsePhase: number;
    logs: LogEntry[];
    animating: boolean;
    rippleActive: boolean;
    runId: number;
}

const ROUTE_CONFIG: Record<RouteKey, {
    label: string; method: string; icon: any;
    color: string;
    path: number[];
    logs: LogEntry[];
}> = {
    auth_login: {
        label: 'POST /auth/login', method: 'POST', icon: ShieldCheck, color: '#facc15',
        path: [0, 1, 2, 3, 7],
        logs: [
            { text: '> POST /auth/login — Entering Cloudflare Zero-Trust Tunnel...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Auth Service /login endpoint reached.', color: '#facc15' },
            { text: '> Checking Valid Credentials... Yes. Generating JWT.', color: '#38bdf8' },
            { text: '✓ 200 OK — JWT access token issued.', color: '#22c55e' },
        ],
    },
    get_models: {
        label: 'GET /models', method: 'GET', icon: Box, color: '#a78bfa',
        path: [0, 1, 2, 4, 7],
        logs: [
            { text: '> GET /models — Entering Cloudflare Zero-Trust Tunnel...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Models Service /models endpoint reached.', color: '#a78bfa' },
            { text: '> Decoding & Validating JWT... Success.', color: '#38bdf8' },
            { text: '✓ 200 OK — Returning model artifact registry.', color: '#22c55e' },
        ],
    },
    train_model: {
        label: 'POST /models/train', method: 'POST', icon: GitMerge, color: '#f87171',
        path: [0, 1, 2, 4, 6, 8, 9],
        logs: [
            { text: '> POST /models/train — Entering Cloudflare Zero-Trust...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Models Service /train endpoint reached.', color: '#a78bfa' },
            { text: '> Dispatching task to Redis broker. Queue: ml_training.', color: '#f87171' },
            { text: '> ◉ RIPPLE — Celery Worker pool activated.', color: '#fb923c' },
            { text: '> Worker executing: fit() + serialize() → artifact pipeline.', color: '#facc15' },
            { text: '✓ 202 Accepted — Background job running. Persisting to Supabase.', color: '#22c55e' },
        ],
    },
    predict_hit: {
        label: 'POST /predict (Cache Hit)', method: 'POST', icon: Zap, color: '#38bdf8',
        path: [0, 1, 2, 5, 6],
        logs: [
            { text: '> POST /predict — Entering Cloudflare Zero-Trust...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Prediction Service /predict endpoint.', color: '#38bdf8' },
            { text: '> Tier-2 Redis Cache? HIT. Returning <1ms.', color: '#f87171' },
            { text: '✓ 200 OK — CACHE HIT. Returning < 1ms.', color: '#22c55e' },
        ],
    },
    predict_miss: {
        label: 'POST /predict (Cache Miss)', method: 'POST', icon: Zap, color: '#fb923c',
        path: [0, 1, 2, 5, 9, 7],
        logs: [
            { text: '> POST /predict — Entering Cloudflare Zero-Trust...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Prediction Service /predict endpoint.', color: '#38bdf8' },
            { text: '> Tier-2 Cache? MISS. Downloading .joblib from Supabase...', color: '#facc15' },
            { text: '> Model loaded into memory. Executing inference...', color: '#a78bfa' },
            { text: '✓ 200 OK — Logging inference to Postgres.', color: '#22c55e' },
        ],
    },
    telemetry_live: {
        label: 'GET /telemetry/live', method: 'GET', icon: Network, color: '#f43f5e',
        path: [0, 1, 2, 5, 10],
        logs: [
            { text: '> GET /telemetry/live — Entering Cloudflare Tunnel...', color: '#60a5fa' },
            { text: '> Tunnel authenticated. Forwarding to Nginx...', color: '#818cf8' },
            { text: '> Nginx → Prediction Service /telemetry endpoint.', color: '#38bdf8' },
            { text: '> Try Prometheus? Success. Querying metrics.', color: '#f43f5e' },
            { text: '✓ 200 OK — Returning time-series scrape data.', color: '#22c55e' },
        ],
    },
};

interface TopoNode { id: number; x: number; y: number; cx: number; cy: number; label: string; emoji: string; color: string; desc: string; }
interface Conn { from: number; to: number; }

const DESCRIPTIONS: Record<number, string> = {
    0: "React Edge UI: Initiates asynchronous fetch operations.",
    1: "Zero-Trust: Encrypts traffic and drops unauthorized packets at the edge.",
    2: "API Gateway: Strips CORS headers and routes traffic to internal microservices.",
    3: "Auth Service: Validates credentials and generates secure JSON Web Tokens.",
    4: "Model Service: Manages model registry CRUD and dispatches background tasks.",
    5: "Prediction Service: Handles low-latency inference with Tier-1/Tier-2 caching.",
    6: "Message Broker: Queues tasks and serves <1ms Tier-2 cache hits.",
    7: "Database: System of record for user sessions, telemetry, and model metadata.",
    8: "Worker Node: Executes heavy CPU/GPU fitting and pipeline serialization.",
    9: "Cloud Storage: Persists serialized .joblib model pipelines.",
    10: "Prometheus: Time-series database for scraping metrics, node health, and model latency.",
};

/* ═══════════════════════════════════════════════════════════════════
   ZERO-CROSS HUB LAYOUT
   ─────────────────────────────────────────────────────────────────
   6 staggered columns, 3 horizontal "swim lanes":
     Top lane    (y≈75):  AuthSvc ──────────────── Postgres
     Middle lane (y≈260): Client → Tunnel → Nginx → ModelSvc → Redis → Celery
     Bottom lane (y≈445): .......................... PredSvc → Prometheus
                                                            → Supabase
   All connections flow left→right within or between adjacent lanes.
   No edge ever crosses another edge.
   ═══════════════════════════════════════════════════════════════════ */

/* Desktop topology (viewBox 1100x520, nodeW=150, nodeH=70) */
const D_NODES: TopoNode[] = [
    { id: 0, x: 10, y: 225, cx: 85, cy: 260, label: 'Client', emoji: '💻', color: '#3b82f6', desc: DESCRIPTIONS[0] },
    { id: 1, x: 185, y: 225, cx: 260, cy: 260, label: 'CF Tunnel', emoji: '🔒', color: '#f97316', desc: DESCRIPTIONS[1] },
    { id: 2, x: 360, y: 225, cx: 435, cy: 260, label: 'Nginx', emoji: '🌐', color: '#22c55e', desc: DESCRIPTIONS[2] },
    { id: 3, x: 535, y: 40, cx: 610, cy: 75, label: 'AuthSvc', emoji: '🔑', color: '#facc15', desc: DESCRIPTIONS[3] },
    { id: 4, x: 535, y: 225, cx: 610, cy: 260, label: 'ModelSvc', emoji: '📦', color: '#a78bfa', desc: DESCRIPTIONS[4] },
    { id: 5, x: 535, y: 410, cx: 610, cy: 445, label: 'PredSvc', emoji: '⚡', color: '#38bdf8', desc: DESCRIPTIONS[5] },
    { id: 6, x: 720, y: 155, cx: 795, cy: 190, label: 'Redis', emoji: '🔴', color: '#f87171', desc: DESCRIPTIONS[6] },
    { id: 7, x: 910, y: 40, cx: 985, cy: 75, label: 'Postgres', emoji: '🗄️', color: '#60a5fa', desc: DESCRIPTIONS[7] },
    { id: 8, x: 910, y: 225, cx: 985, cy: 260, label: 'Celery', emoji: '⚙️', color: '#facc15', desc: DESCRIPTIONS[8] },
    { id: 9, x: 910, y: 410, cx: 985, cy: 445, label: 'Supabase', emoji: '☁️', color: '#10b981', desc: DESCRIPTIONS[9] },
    { id: 10, x: 720, y: 355, cx: 795, cy: 390, label: 'Prometheus', emoji: '📊', color: '#f43f5e', desc: DESCRIPTIONS[10] },
];

/* Mobile topology (viewBox 340x650, nodeW=130, nodeH=65) */
const M_NODES: TopoNode[] = [
    { id: 0, x: 105, y: 10, cx: 170, cy: 42.5, label: 'Client', emoji: '💻', color: '#3b82f6', desc: DESCRIPTIONS[0] },
    { id: 1, x: 105, y: 85, cx: 170, cy: 117.5, label: 'CF Tunnel', emoji: '🔒', color: '#f97316', desc: DESCRIPTIONS[1] },
    { id: 2, x: 105, y: 160, cx: 170, cy: 192.5, label: 'Nginx', emoji: '🌐', color: '#22c55e', desc: DESCRIPTIONS[2] },
    { id: 3, x: 5, y: 255, cx: 70, cy: 287.5, label: 'AuthSvc', emoji: '🔑', color: '#facc15', desc: DESCRIPTIONS[3] },
    { id: 4, x: 105, y: 255, cx: 170, cy: 287.5, label: 'ModelSvc', emoji: '📦', color: '#a78bfa', desc: DESCRIPTIONS[4] },
    { id: 5, x: 205, y: 255, cx: 270, cy: 287.5, label: 'PredSvc', emoji: '⚡', color: '#38bdf8', desc: DESCRIPTIONS[5] },
    { id: 6, x: 105, y: 355, cx: 170, cy: 387.5, label: 'Redis', emoji: '🔴', color: '#f87171', desc: DESCRIPTIONS[6] },
    { id: 7, x: 5, y: 555, cx: 70, cy: 587.5, label: 'Postgres', emoji: '🗄️', color: '#60a5fa', desc: DESCRIPTIONS[7] },
    { id: 8, x: 105, y: 455, cx: 170, cy: 487.5, label: 'Celery', emoji: '⚙️', color: '#facc15', desc: DESCRIPTIONS[8] },
    { id: 9, x: 205, y: 555, cx: 270, cy: 587.5, label: 'Supabase', emoji: '☁️', color: '#10b981', desc: DESCRIPTIONS[9] },
    { id: 10, x: 205, y: 355, cx: 270, cy: 387.5, label: 'Prometheus', emoji: '📊', color: '#f43f5e', desc: DESCRIPTIONS[10] },
];

/* Structural connections — PredSvc→Postgres (5→7) removed since
   no route uses it directly (predict_miss goes 5→9→7 via Supabase) */
const CONNS: Conn[] = [
    { from: 0, to: 1 }, { from: 1, to: 2 },
    { from: 2, to: 3 }, { from: 2, to: 4 }, { from: 2, to: 5 },
    { from: 3, to: 7 }, { from: 4, to: 7 }, { from: 4, to: 6 },
    { from: 5, to: 6 }, { from: 5, to: 9 },
    { from: 6, to: 8 }, { from: 8, to: 7 }, { from: 8, to: 9 },
    { from: 5, to: 10 }, { from: 9, to: 7 },
];

/* Generates responsive, non-crossing cubic bezier curves for edges */
function getBezier(n1: TopoNode, n2: TopoNode) {
    const dx = Math.abs(n2.cx - n1.cx);
    const dy = Math.abs(n2.cy - n1.cy);
    if (dx > dy) {
        return `M ${n1.cx} ${n1.cy} C ${n1.cx + dx / 2} ${n1.cy}, ${n2.cx - dx / 2} ${n2.cy}, ${n2.cx} ${n2.cy}`;
    } else {
        const sign = Math.sign(n2.cy - n1.cy) || 1;
        return `M ${n1.cx} ${n1.cy} C ${n1.cx} ${n1.cy + (dy / 2) * sign}, ${n2.cx} ${n2.cy - (dy / 2) * sign}, ${n2.cx} ${n2.cy}`;
    }
}

function TopoSVG({ nodes, nodeW, nodeH, nodeRx, emojiSize, labelSize, textYOffsets, viewBox, className, prefix, mapState, activePath, onNodeClick, isAnimating }: {
    nodes: TopoNode[]; nodeW: number; nodeH: number; nodeRx: number; emojiSize: number; labelSize: number; textYOffsets: [number, number]; viewBox: string; className: string; prefix: string;
    mapState: MapState; activePath: number[]; onNodeClick: (id: number) => void; isAnimating: boolean;
}) {
    const gId = `${prefix}-glow`;
    const gLgId = `${prefix}-glow-lg`;
    const phaseCapped = Math.max(0, Math.min(mapState.pulsePhase, activePath.length - 2));
    const pulseSrcIdx = activePath[phaseCapped];
    const pulseDstIdx = activePath[phaseCapped + 1];

    const pathConnIndices: number[] = [];
    for (let k = 0; k < activePath.length - 1; k++) {
        const ci = CONNS.findIndex(c => c.from === activePath[k] && c.to === activePath[k + 1]);
        if (ci !== -1) pathConnIndices.push(ci);
    }

    return (
        <svg viewBox={viewBox} className={`w-full h-auto max-w-full ${className}`} xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id={gId}><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id={gLgId}><feGaussianBlur stdDeviation="8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>

            {CONNS.map((c, i) => (
                <path key={`${prefix}-s-${i}`} d={getBezier(nodes[c.from], nodes[c.to])} fill="none" stroke="#1e293b" strokeWidth={2} />
            ))}

            {mapState.active && pathConnIndices.map((ci, k) => {
                const isLit = k <= mapState.pulsePhase;
                return (
                    <motion.path
                        key={`${prefix}-l-${mapState.runId}-${k}`}
                        d={getBezier(nodes[CONNS[ci].from], nodes[CONNS[ci].to])}
                        fill="none" stroke={activePath[k + 1] === 6 ? '#f87171' : activePath[k + 1] === 10 ? '#f43f5e' : '#60a5fa'} strokeWidth={3} filter={`url(#${gId})`}
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: isLit ? 1 : 0, opacity: isLit ? 1 : 0 }}
                        transition={{ duration: 1.2, ease: 'linear' }}
                    />
                );
            })}

            {mapState.active && mapState.pulsePhase >= 0 && mapState.pulsePhase < activePath.length - 1 && (
                <g key={`${prefix}-p-${mapState.runId}-${mapState.pulsePhase}`}>
                    <circle r={9} fill="#60a5fa" filter={`url(#${gLgId})`} />
                    <animateMotion dur="1.2s" fill="freeze" path={getBezier(nodes[pulseSrcIdx], nodes[pulseDstIdx])} />
                </g>
            )}

            {mapState.pulsePhase >= activePath.length - 1 && mapState.active && (
                <motion.circle
                    key={`${prefix}-done-${mapState.runId}`}
                    cx={nodes[activePath[activePath.length - 1]].cx} cy={nodes[activePath[activePath.length - 1]].cy}
                    r={12} fill="#22c55e" filter={`url(#${gId})`}
                    initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.7] }} transition={{ duration: 0.6 }}
                />
            )}

            {mapState.rippleActive && [0, 1, 2].map(i => (
                <motion.circle
                    key={`${prefix}-r-${mapState.runId}-${i}`}
                    cx={nodes[6].cx} cy={nodes[6].cy} fill="none" stroke="#f87171" strokeWidth={1.5}
                    initial={{ r: 24, opacity: 0.8 }} animate={{ r: 75 + i * 25, opacity: 0 }}
                    transition={{ duration: 1.1, delay: i * 0.18, ease: 'easeOut' }}
                />
            ))}

            {nodes.map((node) => {
                const inActivePath = activePath.includes(node.id);
                const lit = mapState.active && inActivePath && mapState.pulsePhase >= activePath.indexOf(node.id);
                return (
                    <g key={`${prefix}-n-${node.id}`}
                        onClick={() => !isAnimating && onNodeClick(node.id)}
                        className={!isAnimating ? "cursor-pointer" : ""}>
                        <rect x={node.x} y={node.y} width={nodeW} height={nodeH} rx={nodeRx}
                            fill="#0d0d0d" stroke={lit ? node.color : '#1e293b'} strokeWidth={lit ? 2 : 1.5} />
                        {lit && (
                            <rect x={node.x} y={node.y} width={nodeW} height={nodeH} rx={nodeRx}
                                fill={`${node.color}12`} stroke={node.color} strokeWidth={2} opacity={0.5} filter={`url(#${gId})`} />
                        )}
                        <text x={node.cx} y={node.cy + textYOffsets[0]} textAnchor="middle" fill={lit ? node.color : '#4b5563'} fontSize={emojiSize}>{node.emoji}</text>
                        <text x={node.cx} y={node.cy + textYOffsets[1]} textAnchor="middle" fill={lit ? '#cbd5e1' : '#475569'}
                            fontSize={labelSize} fontFamily="monospace" fontWeight={lit ? 'bold' : 'normal'}>{node.label}</text>
                    </g>
                );
            })}
        </svg>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   TERMINAL TYPER & MOCK COPILOT
   ═══════════════════════════════════════════════════════════════════ */

const TYPER_LINES = [
    '{ "variance_score": 0.847, "null_pct": 0.02 }',
    '{ "cardinality": 1247, "dtype": "float64" }',
    '{ "skewness": -0.31, "kurtosis": 2.14 }',
    '> Routing → RandomForestClassifier pipeline...',
];

function TerminalTyper() {
    const [lines, setLines] = useState<string[]>([]);
    const [lineIdx, setLineIdx] = useState(0);
    const [charIdx, setCharIdx] = useState(0);

    useEffect(() => {
        if (lineIdx >= TYPER_LINES.length) {
            const t = setTimeout(() => { setLines([]); setLineIdx(0); setCharIdx(0); }, 2500);
            return () => clearTimeout(t);
        }
        const t = setTimeout(() => {
            const line = TYPER_LINES[lineIdx];
            if (charIdx < line.length) {
                setLines(prev => {
                    const next = [...prev];
                    next[lineIdx] = line.slice(0, charIdx + 1);
                    return next;
                });
                setCharIdx(c => c + 1);
            } else {
                setLineIdx(l => l + 1);
                setCharIdx(0);
            }
        }, 30);
        return () => clearTimeout(t);
    }, [lineIdx, charIdx]);

    return (
        <div className="mt-5 bg-gray-950 rounded-xl border border-gray-800/60 overflow-hidden font-mono text-xs">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800/40 bg-gray-900/50">
                <span className="w-2 h-2 rounded-full bg-red-500/60" />
                <span className="w-2 h-2 rounded-full bg-yellow-500/60" />
                <span className="w-2 h-2 rounded-full bg-green-500/60" />
                <span className="text-gray-600 text-[10px] ml-2 tracking-wide">profiler_output.json</span>
            </div>
            <div className="p-3 min-h-[100px]">
                {lines.map((line, i) => (
                    <div key={i} className="leading-relaxed">
                        <span className={line.startsWith('>') ? 'text-cyan-400/80' : 'text-green-400/70'}>{line}</span>
                        {i === lines.length - 1 && lineIdx < TYPER_LINES.length && <span className="text-green-300 animate-pulse ml-0.5">▋</span>}
                    </div>
                ))}
                {lines.length === 0 && <span className="text-green-400/30 animate-pulse">▋</span>}
            </div>
        </div>
    );
}

function CopilotAutofill() {
    const [phase, setPhase] = useState<'idle' | 'filling-target' | 'filling-algo' | 'ready'>('idle');
    const [targetVal, setTargetVal] = useState('');
    const [algoVal, setAlgoVal] = useState('');
    const TARGET_TEXT = 'track_genre';
    const ALGO_TEXT = 'Random Forest';

    useEffect(() => {
        let cancelled = false;
        const runSequence = async () => {
            await new Promise(r => setTimeout(r, 1800));
            if (cancelled) return;
            setPhase('filling-target');
            for (let i = 1; i <= TARGET_TEXT.length; i++) {
                await new Promise(r => setTimeout(r, 55));
                if (cancelled) return;
                setTargetVal(TARGET_TEXT.slice(0, i));
            }
            await new Promise(r => setTimeout(r, 500));
            if (cancelled) return;
            setPhase('filling-algo');
            for (let i = 1; i <= ALGO_TEXT.length; i++) {
                await new Promise(r => setTimeout(r, 55));
                if (cancelled) return;
                setAlgoVal(ALGO_TEXT.slice(0, i));
            }
            await new Promise(r => setTimeout(r, 600));
            if (cancelled) return;
            setPhase('ready');
            await new Promise(r => setTimeout(r, 3500));
            if (cancelled) return;
            setPhase('idle'); setTargetVal(''); setAlgoVal('');
            runSequence();
        };
        runSequence();
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="mt-6 w-full max-w-md space-y-3">
            <div>
                <label className="block text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Target Variable</label>
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-black/60 transition-colors duration-300 ${phase === 'filling-target' ? 'border-blue-500/60 shadow-[0_0_12px_rgba(59,130,246,0.2)]' : 'border-gray-800'}`}>
                    <span className="font-mono text-sm text-blue-300 min-h-[1.25rem] flex-1">
                        {targetVal || <span className="text-gray-700">auto-detect...</span>}
                        {phase === 'filling-target' && <span className="animate-pulse">▋</span>}
                    </span>
                    {(phase === 'filling-algo' || phase === 'ready') && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-green-400 text-xs">✓</motion.span>}
                </div>
            </div>
            <div>
                <label className="block text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-1">Algorithm</label>
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-black/60 transition-colors duration-300 ${phase === 'filling-algo' ? 'border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.2)]' : 'border-gray-800'}`}>
                    <span className="font-mono text-sm text-purple-300 min-h-[1.25rem] flex-1">
                        {algoVal || <span className="text-gray-700">auto-select...</span>}
                        {phase === 'filling-algo' && <span className="animate-pulse">▋</span>}
                    </span>
                    {phase === 'ready' && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-green-400 text-xs">✓</motion.span>}
                </div>
            </div>
            <AnimatePresence>
                {phase === 'ready' && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                        <span className="text-green-400 font-mono text-xs font-semibold">Ready to Train</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function LandingPage() {
    const navigate = useNavigate();
    usePrewarmCluster();

    const [clusterOnline, setClusterOnline] = useState<boolean | null>(null);
    useEffect(() => {
        const pingCluster = async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
            try {
                const res = await fetch(`${base}/api/v1/predictions/telemetry/live`, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
                setClusterOnline(res.ok);
            } catch { setClusterOnline(false); }
            finally { clearTimeout(timeoutId); }
        };
        pingCluster();
        const interval = setInterval(pingCluster, 15000);
        return () => clearInterval(interval);
    }, []);

    const [mapState, setMapState] = useState<MapState>({
        active: null, pulsePhase: -1, logs: [], animating: false, rippleActive: false, runId: 0,
    });

    const [inspectedNode, setInspectedNode] = useState<number | null>(null);

    const triggerRoute = useCallback((routeKey: RouteKey) => {
        if (mapState.animating) return;
        setInspectedNode(null);
        const cfg = ROUTE_CONFIG[routeKey];
        const rid = Date.now();
        setMapState({ active: routeKey, pulsePhase: -1, logs: [], animating: true, rippleActive: false, runId: rid });

        let phase = 0;
        const advance = () => {
            if (phase < cfg.logs.length) {
                const p = phase;
                setMapState(s => ({
                    ...s,
                    pulsePhase: p,
                    logs: [...s.logs, cfg.logs[p]],
                    rippleActive: routeKey === 'train_model' && p === 3,
                }));
                phase++;
                const isLast = phase >= cfg.logs.length;
                setTimeout(isLast ? () => setMapState(s => ({ ...s, pulsePhase: cfg.path.length - 1, animating: false })) : advance, routeKey === 'train_model' && p === 3 ? 2200 : 1500);
            }
        };
        setTimeout(advance, 400);
    }, [mapState.animating]);

    const activePathArr = mapState.active ? ROUTE_CONFIG[mapState.active].path : [];
    const currentNodeIdx = mapState.active ? Math.min(Math.max(mapState.pulsePhase, 0), activePathArr.length - 1) : 0;
    const currentNode = mapState.active && activePathArr.length > 0 ? D_NODES.find(n => n.id === activePathArr[currentNodeIdx]) : null;

    let displayNode: TopoNode | null = null;
    if (mapState.animating) {
        displayNode = currentNode || null;
    } else if (inspectedNode !== null) {
        displayNode = D_NODES.find(n => n.id === inspectedNode) || null;
    }

    return (
        <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-blue-500/30 min-w-0 overflow-x-hidden">

            {/* ═══ PHASE 1: HERO ═══════════════════════════════ */}
            <section className="relative flex flex-col items-center justify-center min-h-screen px-6 overflow-hidden min-w-0">
                <div className="absolute inset-0 z-0 h-[50vh] md:h-screen" style={{ touchAction: 'none' }}>
                    <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
                        <SceneCleanup />
                        <ambientLight intensity={0.15} />
                        <pointLight position={[5, 5, 5]} intensity={0.4} color="#818cf8" />
                        <pointLight position={[-5, -3, 3]} intensity={0.3} color="#3b82f6" />
                        <TensorGrid />
                    </Canvas>
                </div>
                <div className="absolute inset-0 z-[1] pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 75%)' }} />
                <div className="absolute inset-0 z-[2] pointer-events-none" style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 52%, rgba(0,0,0,0.72) 0%, transparent 100%)' }} />

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="z-10 text-center max-w-4xl mx-auto mt-20 min-w-0">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 mb-6 text-sm border rounded-full backdrop-blur-sm transition-colors duration-500 ${clusterOnline === null ? 'text-blue-400 border-blue-900/50 bg-blue-950/30' : clusterOnline === true ? 'text-green-400 border-green-900/50 bg-green-950/30' : 'text-red-400 border-red-900/50 bg-red-950/30'}`}>
                        <span className="relative flex h-2 w-2">
                            {clusterOnline !== false && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${clusterOnline === true ? 'bg-green-400' : 'bg-blue-400'}`} />}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${clusterOnline === null ? 'bg-blue-500' : clusterOnline === true ? 'bg-green-500' : 'bg-red-500'}`} />
                        </span>
                        {clusterOnline === null ? 'Checking Cluster Status...' : clusterOnline === true ? 'Cluster Online' : 'Cluster Offline'}
                    </div>

                    <motion.h1 initial={{ opacity: 0, filter: 'blur(12px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 1.2, ease: 'easeOut' }}
                        className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-extrabold tracking-tight mb-6 bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent drop-shadow-lg">
                        Machine Learning, Uncomplicated.
                    </motion.h1>

                    <motion.p initial={{ opacity: 0, filter: 'blur(8px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
                        className="text-base sm:text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed px-4">
                        Enter Inference Studio. An all-in-one workspace designed to automate feature pruning, train algorithms, and generate boardroom-ready analytics instantly.
                    </motion.p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full px-4">
                        <button onClick={() => navigate(ROUTES.LOGIN)} className="flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-4 min-h-[44px] bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors shadow-lg shadow-white/10">
                            Launch Studio <ArrowRight className="w-4 h-4" />
                        </button>
                        <a href="https://github.com/GauravSrivastava-prog/scalable-ml-inference-platform" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-4 min-h-[44px] bg-transparent border border-gray-700 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                            <Github className="w-5 h-5" /> View Architecture
                        </a>
                    </div>
                </motion.div>
            </section>

            {/* ═══ PHASE 2: TREE TOPOLOGY MAP ═════════════════════ */}
            <section className="py-16 sm:py-24 px-4 sm:px-6 border-t border-white/5 z-10 relative bg-black min-w-0">
                <div className="max-w-7xl mx-auto min-w-0">
                    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} viewport={{ once: true }} className="text-center mb-12 sm:mb-16 min-w-0">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Zero-Trust Data-Pulse Topology</h2>
                        <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto leading-relaxed px-2">
                            Factual architectural telemetry of the edge-to-metal inference pipeline.
                            Trigger any API route and trace the request through every microservice node in real time.
                        </p>
                    </motion.div>

                    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-10 items-stretch min-w-0">
                        {/* LEFT: SVG Network Tree */}
                        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                            className="relative bg-gray-950/80 border border-gray-800 rounded-2xl p-4 sm:p-6 backdrop-blur-sm w-full min-w-0 flex flex-col overflow-hidden h-full">

                            <div className="flex-1 w-full relative">
                                <TopoSVG nodes={D_NODES} nodeW={150} nodeH={70} nodeRx={12} emojiSize={24} labelSize={13} textYOffsets={[-8, 16]} viewBox="0 0 1100 520" className="hidden lg:block w-full h-auto" prefix="d" mapState={mapState} activePath={activePathArr} onNodeClick={setInspectedNode} isAnimating={mapState.animating} />
                                <TopoSVG nodes={M_NODES} nodeW={130} nodeH={65} nodeRx={10} emojiSize={22} labelSize={12} textYOffsets={[-6, 14]} viewBox="0 0 340 650" className="block lg:hidden w-full h-auto" prefix="m" mapState={mapState} activePath={activePathArr} onNodeClick={setInspectedNode} isAnimating={mapState.animating} />
                            </div>

                            {/* TELEMETRY READER OVERLAY */}
                            <div className="shrink-0 mt-4 bg-gray-900/90 backdrop-blur-xl border border-gray-700 p-4 rounded-xl shadow-2xl min-h-[100px] flex flex-col justify-center relative z-10 w-full">
                                <AnimatePresence mode="wait">
                                    {displayNode ? (
                                        <motion.div
                                            key={`node-${displayNode.id}`}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -8 }}
                                            transition={{ duration: 0.25 }}
                                            className="flex flex-col gap-1.5"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-2xl">{displayNode.emoji}</span>
                                                <span className="font-bold text-sm tracking-wide" style={{ color: displayNode.color }}>{displayNode.label}</span>
                                            </div>
                                            <p className="text-[13px] text-gray-300 leading-relaxed font-mono">
                                                {displayNode.desc}
                                            </p>
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="idle"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="flex items-center text-gray-400 text-sm font-mono h-full"
                                        >
                                            <span className="animate-pulse mr-3 text-green-500">●</span> Awaiting API Trigger... Select a route to trace the edge-to-metal lifecycle.
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>

                        {/* RIGHT: HUD Controls */}
                        <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="flex flex-col gap-6 min-w-0 h-full">
                            <div className="space-y-3 min-w-0 shrink-0">
                                <h3 className="text-sm font-mono text-gray-500 uppercase tracking-widest mb-4">Trigger API Route</h3>
                                {(Object.keys(ROUTE_CONFIG) as RouteKey[]).map(key => {
                                    const Icon = ROUTE_CONFIG[key].icon;
                                    return (
                                        <button key={key} onClick={() => triggerRoute(key)} disabled={mapState.animating}
                                            className={`w-full group flex items-center gap-3 px-5 py-3.5 min-h-[44px] font-mono text-sm rounded-xl border transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${mapState.active === key ? `bg-white/10 border-[${ROUTE_CONFIG[key].color}] text-[${ROUTE_CONFIG[key].color}]` : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
                                            style={mapState.active === key ? { borderColor: ROUTE_CONFIG[key].color, color: ROUTE_CONFIG[key].color } : {}}>
                                            <Icon className="w-4 h-4 shrink-0" />
                                            <span className="flex-1 text-left truncate">{ROUTE_CONFIG[key].label}</span>
                                            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="bg-black border border-gray-800 rounded-xl overflow-hidden font-mono text-sm min-w-0 flex flex-col flex-1">
                                <div className="flex items-center px-4 py-3 border-b border-gray-800 bg-gray-900/50 min-w-0 shrink-0">
                                    <Terminal className="w-4 h-4 text-gray-500 mr-2 shrink-0" />
                                    <span className="text-gray-500 text-xs truncate">network_telemetry_log</span>
                                    {mapState.animating && <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} className="ml-auto text-[10px] text-green-400 font-bold shrink-0">● LIVE</motion.span>}
                                </div>
                                <div className="p-4 min-h-[220px] space-y-2 overflow-x-auto flex-1 bg-black">
                                    {mapState.logs.length === 0 ? <p className="text-gray-600 text-xs italic">Awaiting route trigger...</p> : (
                                        <AnimatePresence>
                                            {mapState.logs.map((log, i) => (
                                                <motion.p key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="text-xs leading-relaxed break-all" style={{ color: log.color }}>{log.text}</motion.p>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ═══ PHASE 3: LIVING COPILOT BENTO BOX ════════════════════ */}
            <section className="py-16 sm:py-24 px-4 sm:px-6 border-t border-white/5 z-10 relative bg-black min-w-0">
                <div className="max-w-7xl mx-auto min-w-0">
                    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} viewport={{ once: true }} className="text-center mb-12 sm:mb-16 min-w-0">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Intelligent Copilot Engine</h2>
                        <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto leading-relaxed px-2">Context-aware ML orchestration. Zero manual configuration.</p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 min-w-0">
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} className="md:col-span-2 p-6 md:p-8 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
                            <h3 className="text-lg font-semibold text-white mb-2">Algorithmic Matchmaking</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">Bypass manual EDA. The engine calculates feature variances and dataset cardinality in milliseconds, autonomously routing data to optimal classification or regression pipelines.</p>
                            <TerminalTyper />
                        </motion.div>

                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="md:col-span-1 p-6 md:p-8 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
                            <h3 className="text-lg font-semibold text-white mb-2">Surgical Feature Pruning</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">Dynamic tree-bloat prevention. High-cardinality metadata is automatically stripped, keeping serialized artifacts infinitely scalable.</p>
                            <div className="relative mt-5">
                                <motion.div className="absolute inset-0 flex items-center justify-center pointer-events-none" animate={{ opacity: [0.15, 0.35, 0.15] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
                                    <ShieldCheck className="w-20 h-20 text-emerald-500/20" />
                                </motion.div>
                                <div className="relative z-10 bg-gray-950/80 rounded-lg p-4 font-mono text-sm border border-gray-800/40">
                                    <code>
                                        <span className="text-blue-300">X</span><span className="text-gray-500">[</span><span className="text-amber-300">col</span><span className="text-gray-500">].</span><span className="text-cyan-300">nunique</span><span className="text-gray-500">()</span><span className="text-purple-400"> / </span><span className="text-cyan-300">len</span><span className="text-gray-500">(</span><span className="text-blue-300">X</span><span className="text-gray-500">)</span><span className="text-purple-400"> {'>'} </span><span className="text-pink-400">0.95</span>
                                    </code>
                                </div>
                            </div>
                        </motion.div>

                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="md:col-span-3 p-6 md:p-8 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
                            <div className="flex flex-col md:flex-row md:items-start gap-8">
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-white mb-2">One-Click Configuration.</h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">The Copilot automatically selects your target variables and sets the optimal algorithm so you can start training immediately.</p>
                                </div>
                                <CopilotAutofill />
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ═══ PHASE 4: DIAGNOSTICS & PDF SIMULATION (Layout-Shift Fix) ════ */}
            <section className="py-20 sm:py-28 px-4 sm:px-6 border-t border-white/5 z-10 relative bg-black min-w-0 min-h-[650px] flex flex-col justify-center">
                <div className="max-w-6xl mx-auto w-full min-w-0">
                    <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
                        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
                            <p className="text-xs font-mono text-blue-400/70 uppercase tracking-widest mb-4">Analytics Export</p>
                            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-6 leading-tight">
                                Export Your Model's<br />
                                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Brain to PDF.</span>
                            </h2>
                            <p className="text-base text-gray-400 leading-relaxed mb-8 max-w-md">Generate visual feature importance charts, performance metrics, and tuning heuristics instantly.</p>
                            <ul className="space-y-3">
                                {[
                                    { icon: <Cpu className="w-4 h-4 text-blue-400" />, text: 'Mean Decrease in Impurity (MDI) charts' },
                                    { icon: <TrendingUp className="w-4 h-4 text-purple-400" />, text: 'Automated hyper-parameter tuning heuristics' },
                                    { icon: <FileDown className="w-4 h-4 text-emerald-400" />, text: 'Dark-themed PDF via decoupled canvas rendering' },
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-sm text-gray-300"><span className="shrink-0">{item.icon}</span>{item.text}</li>
                                ))}
                            </ul>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }} className="flex items-center justify-center w-full min-h-[480px]">
                            <div className="relative w-full max-w-sm h-[450px] bg-gray-950/80 border border-gray-700/60 rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col p-6 backdrop-blur-xl">
                                <div className="border-b border-gray-800 pb-4 mb-4">
                                    <h4 className="text-white font-semibold text-lg flex items-center gap-2"><FileDown className="w-5 h-5 text-blue-400" /> Diagnostics Report</h4>
                                    <p className="text-gray-500 font-mono text-[10px] mt-1">model_v14_rf.joblib</p>
                                </div>
                                <div className="space-y-4 mb-6">
                                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">MDI Feature Importance</p>
                                    {[
                                        { label: "user_engagement_score", width: "85%", color: "bg-blue-500" },
                                        { label: "session_duration_sec", width: "65%", color: "bg-indigo-500" },
                                        { label: "click_through_rate", width: "45%", color: "bg-purple-500" },
                                        { label: "bounce_rate", width: "25%", color: "bg-pink-500" },
                                    ].map((bar, i) => (
                                        <div key={i} className="flex flex-col gap-1.5">
                                            <div className="flex justify-between text-[10px] font-mono text-gray-500">
                                                <span>{bar.label}</span><span>{bar.width}</span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                                                <motion.div initial={{ width: 0 }} whileInView={{ width: bar.width }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.2 + (i * 0.15), ease: "easeOut" }} className={`h-full ${bar.color} rounded-full`} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 1.0 }} className="grid grid-cols-2 gap-3 mt-auto">
                                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
                                        <p className="text-[10px] font-mono text-gray-500 mb-1">Accuracy</p>
                                        <p className="text-xl font-bold text-green-400">94.2%</p>
                                    </div>
                                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
                                        <p className="text-[10px] font-mono text-gray-500 mb-1">F1-Score</p>
                                        <p className="text-xl font-bold text-emerald-400">0.92</p>
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ═══ PHASE 5: SUPPORTED MODEL ARCHITECTURES ═══ */}
            <section className="py-16 sm:py-24 px-4 sm:px-6 border-t border-white/5 z-10 relative bg-black min-w-0">
                <div className="max-w-6xl mx-auto min-w-0">
                    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} viewport={{ once: true }} className="text-center mb-12 sm:mb-16 min-w-0">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Supported Model Architectures</h2>
                        <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto leading-relaxed px-2">Train, serialize, and deploy production-grade models across four battle-tested algorithmic families.</p>
                    </motion.div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 min-w-0">
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} whileHover={{ scale: 1.02, borderColor: '#3b82f6' }} transition={{ duration: 0.25 }} className="group p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.8)] cursor-default min-w-0 flex flex-col">
                            <Network className="w-8 h-8 text-blue-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Random Forest</h3>
                            <p className="text-xs font-mono text-blue-400/70 mb-3 truncate">Ensemble Bagging</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Robust parallel tree execution for high-variance datasets.</p>
                        </motion.div>
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.05 }} whileHover={{ scale: 1.02, borderColor: '#a855f7' }} className="group p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.8)] cursor-default min-w-0 flex flex-col">
                            <Zap className="w-8 h-8 text-purple-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">XGBoost</h3>
                            <p className="text-xs font-mono text-purple-400/70 mb-3 truncate">Gradient Boosting</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Extreme performance and auto-pruning for tabular data supremacy.</p>
                        </motion.div>
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.1 }} whileHover={{ scale: 1.02, borderColor: '#22c55e' }} className="group p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.8)] cursor-default min-w-0 flex flex-col">
                            <TrendingUp className="w-8 h-8 text-green-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(34,197,94,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Logistic Regression</h3>
                            <p className="text-xs font-mono text-green-400/70 mb-3 truncate">Linear Baseline</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Lightning-fast, highly interpretable probabilistic classification.</p>
                        </motion.div>
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.15 }} whileHover={{ scale: 1.02, borderColor: '#f59e0b' }} className="group p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.8)] cursor-default min-w-0 flex flex-col">
                            <GitMerge className="w-8 h-8 text-amber-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(245,158,11,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Decision Tree</h3>
                            <p className="text-xs font-mono text-amber-400/70 mb-3 truncate">Non-linear Splits</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Fully explainable, rule-based algorithmic routing.</p>
                        </motion.div>
                    </div>
                </div>
            </section>

            <footer className="py-10 border-t border-gray-900/50 bg-black min-w-0">
                <p className="text-center text-[11px] font-mono tracking-widest uppercase text-gray-700 select-none px-4">
                    Architected & Engineered by Gaurav Srivastava
                </p>
            </footer>

        </div>
    );
}
