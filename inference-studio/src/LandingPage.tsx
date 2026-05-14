import { useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Github, ArrowRight, Terminal, ShieldCheck, Box, TrendingUp, GitMerge, Network } from 'lucide-react';
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

/** A single wireframe ring that slowly rotates and pulses opacity. */
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

/** Chaotic particle cloud at the top of the funnel representing raw data. */
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

/** Structured icosahedron wireframe at the bottom representing organised output. */
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

/** Vertical beam connecting top chaos to bottom structure. */
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

/** Orbiting data node. */
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

/** Full TensorGrid scene composition. */
function TensorGrid() {
    return (
        <Float speed={1.2} rotationIntensity={0.4} floatIntensity={0.6}>
            <group>
                {/* Chaotic data cloud at top */}
                <ChaoticCloud count={300} />

                {/* Funnel rings – wide at top, narrow at bottom */}
                <DataRing radius={2.2} y={2.0} speed={0.3} color="#7c3aed" />
                <DataRing radius={1.7} y={1.2} speed={-0.25} color="#6366f1" />
                <DataRing radius={1.2} y={0.4} speed={0.2} color="#818cf8" />
                <DataRing radius={0.8} y={-0.4} speed={-0.35} color="#3b82f6" />
                <DataRing radius={0.5} y={-1.2} speed={0.4} color="#60a5fa" />

                {/* Central beam */}
                <FunnelBeam />

                {/* Structured output at bottom */}
                <StructuredCore />

                {/* Orbiting data nodes */}
                <OrbitNode orbitRadius={2.5} speed={0.4} y={1.8} size={0.06} color="#a78bfa" />
                <OrbitNode orbitRadius={1.9} speed={-0.55} y={0.8} size={0.05} color="#818cf8" />
                <OrbitNode orbitRadius={1.1} speed={0.7} y={-0.5} size={0.04} color="#60a5fa" />
                <OrbitNode orbitRadius={0.7} speed={-0.9} y={-1.8} size={0.05} color="#93c5fd" />
            </group>
        </Float>
    );
}

/* ═══════════════════════════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   GROUND TRUTH MICROSERVICE MAP – Types & Config
   ═══════════════════════════════════════════════════════════════════ */

type RouteKey = 'auth' | 'models' | 'predictions';

interface LogEntry { text: string; color: string }

const ROUTE_CONFIG: Record<RouteKey, { label: string; method: string; path: string[]; logs: LogEntry[] }> = {
    auth: {
        label: 'POST /auth/login',
        method: 'POST',
        path: ['client', 'auth', 'postgres'],
        logs: [
            { text: '> Initiating fetch to ml-auth-service.onrender.com...', color: '#60a5fa' },
            { text: '> Validating credentials against Postgres users table.', color: '#a78bfa' },
            { text: '> Credentials valid. Issuing JWT access token.', color: '#34d399' },
            { text: '✓ 200 OK — Token issued.', color: '#22c55e' },
        ],
    },
    models: {
        label: 'GET /models',
        method: 'GET',
        path: ['client', 'models', 'postgres'],
        logs: [
            { text: '> Initiating fetch to scalable-ml-inference-platform.onrender.com...', color: '#60a5fa' },
            { text: '> Querying Postgres ml_models table.', color: '#a78bfa' },
            { text: '> Serializing model artifacts from Supabase storage.', color: '#facc15' },
            { text: '✓ 200 OK — Returning model artifacts.', color: '#22c55e' },
        ],
    },
    predictions: {
        label: 'POST /predictions',
        method: 'POST',
        path: ['client', 'prediction', 'redis', 'postgres'],
        logs: [
            { text: '> Initiating fetch to ml-prediction-service-m7xo.onrender.com...', color: '#60a5fa' },
            { text: '> Checking Redis cache for payload hash.', color: '#f87171' },
            { text: '> Cache Miss. Executing inference pipeline.', color: '#facc15' },
            { text: '> Persisting prediction output to Postgres.', color: '#a78bfa' },
            { text: '✓ 201 Created — Prediction stored.', color: '#22c55e' },
        ],
    },
};

interface MapState {
    active: RouteKey | null;
    phase: number; // index into the path array
    logs: LogEntry[];
    animating: boolean;
}

export default function LandingPage() {
    const navigate = useNavigate();
    usePrewarmCluster();

    // ── Ground Truth Microservice Map state ──
    const [mapState, setMapState] = useState<MapState>({ active: null, phase: -1, logs: [], animating: false });

    const triggerRoute = useCallback((route: RouteKey) => {
        if (mapState.animating) return;
        const config = ROUTE_CONFIG[route];
        setMapState({ active: route, phase: 0, logs: [], animating: true });

        let step = 0;
        const advance = () => {
            if (step < config.logs.length) {
                const currentStep = step;
                setMapState(s => ({
                    ...s,
                    phase: Math.min(currentStep, config.path.length - 1),
                    logs: [...s.logs, config.logs[currentStep]],
                }));
                step++;
                setTimeout(advance, route === 'predictions' && currentStep === 1 ? 900 : 600);
            } else {
                setMapState(s => ({ ...s, phase: config.path.length - 1, animating: false }));
            }
        };
        setTimeout(advance, 400);
    }, [mapState.animating]);

    return (
        <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-blue-500/30 min-w-0">

            {/* ── 1. 3D HERO SECTION ─────────────────────────────────── */}
            <section className="relative flex flex-col items-center justify-center min-h-screen px-6 overflow-hidden min-w-0">

                {/* Three.js Canvas – absolute fill behind the text */}
                <div className="absolute inset-0 z-0 h-[50vh] md:h-screen" style={{ touchAction: 'none' }}>
                    <Canvas
                        camera={{ position: [0, 0, 7], fov: 50 }}
                        dpr={[1, 1.5]}
                        gl={{ antialias: true, alpha: true }}
                        style={{ background: 'transparent' }}
                    >
                        <SceneCleanup />
                        <ambientLight intensity={0.15} />
                        <pointLight position={[5, 5, 5]} intensity={0.4} color="#818cf8" />
                        <pointLight position={[-5, -3, 3]} intensity={0.3} color="#3b82f6" />
                        <TensorGrid />
                    </Canvas>
                </div>

                {/* Radial vignette overlay */}
                <div
                    className="absolute inset-0 z-[1] pointer-events-none"
                    style={{
                        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 75%)',
                    }}
                />

                {/* Hero copy */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="z-10 text-center max-w-4xl mx-auto mt-20 min-w-0"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 text-sm text-blue-400 border border-blue-900/50 rounded-full bg-blue-950/30 backdrop-blur-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                        Cluster Online
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-extrabold tracking-tight mb-6 bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent drop-shadow-lg">
                        Raw Data to Live API <br /> in 60 Seconds.
                    </h1>

                    <p className="text-base sm:text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed px-4">
                        A production-grade, microservice-driven MLOps platform. Upload CSVs, train dynamic models, and deploy instantly with sub-millisecond Redis caching.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full px-4">
                        <button
                            id="launch-studio-btn"
                            onClick={() => navigate(ROUTES.LOGIN)}
                            className="flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-4 min-h-[44px] bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors shadow-lg shadow-white/10"
                        >
                            Launch Studio <ArrowRight className="w-4 h-4" />
                        </button>
                        <a
                            href="https://github.com/GauravSrivastava-prog/scalable-ml-inference-platform"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-4 min-h-[44px] bg-transparent border border-gray-700 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <Github className="w-5 h-5" /> View Architecture
                        </a>
                    </div>
                </motion.div>
            </section>

            {/* ── 2. GROUND TRUTH MICROSERVICE MAP ──────────────────── */}
            <section className="py-16 sm:py-24 px-4 sm:px-6 border-t border-gray-900 z-10 relative bg-black min-w-0">
                <div className="max-w-7xl mx-auto min-w-0">
                    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} viewport={{ once: true }} className="text-center mb-12 sm:mb-16 min-w-0">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ground Truth Microservice Map</h2>
                        <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto leading-relaxed px-2">
                            Live architectural topology of the Render-deployed inference platform.
                            Trigger real API routes and trace the request path through the service mesh.
                        </p>
                    </motion.div>

                    <div className="grid lg:grid-cols-2 gap-10 items-start min-w-0">

                        {/* ── LEFT: SVG Network Map ── */}
                        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                            className="relative bg-gray-950/80 border border-gray-800 rounded-2xl p-4 sm:p-6 backdrop-blur-sm w-full min-w-0 overflow-hidden">

                            <svg viewBox="0 0 580 450" className="w-full h-auto max-w-full" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <filter id="glow-blue"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                                    <filter id="glow-green"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                                    <filter id="glow-purple"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                                    <filter id="glow-red"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                                </defs>

                                {/* ── DESKTOP VIEW (lg:block) ── */}
                                <g className="hidden lg:block">
                                    {/* Static connection lines */}
                                    <line x1="100" y1="220" x2="230" y2="90" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="100" y1="220" x2="230" y2="220" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="100" y1="220" x2="230" y2="350" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="350" y1="90" x2="470" y2="270" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="350" y1="220" x2="470" y2="270" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="350" y1="350" x2="470" y2="160" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="350" y1="350" x2="470" y2="270" stroke="#1e293b" strokeWidth="1.5" />

                                    {/* Animated path traces */}
                                    {mapState.active === 'auth' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="100" y1="220" x2="230" y2="90" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="350" y1="90" x2="470" y2="270" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}
                                    {mapState.active === 'models' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="100" y1="220" x2="230" y2="220" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="350" y1="220" x2="470" y2="270" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}
                                    {mapState.active === 'predictions' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="100" y1="220" x2="230" y2="350" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="350" y1="350" x2="470" y2="160" stroke="#f87171" strokeWidth="2" filter="url(#glow-red)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                            {mapState.phase >= 3 && (
                                                <motion.line x1="350" y1="350" x2="470" y2="270" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}

                                    {/* NODE: Client (tooltip: bottom) */}
                                    <g>
                                        <rect x="40" y="185" width="120" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.active ? '#3b82f6' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="100" y="215" textAnchor="middle" fill="#94a3b8" fontSize="14" fontFamily="monospace">💻</text>
                                        <text x="100" y="238" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Client App</text>
                                        {mapState.active && (
                                            <foreignObject x="30" y="260" width="140" height="30">
                                                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#e2e8f0', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Request Origin
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* NODE: Auth Service (tooltip: top) */}
                                    <g>
                                        <rect x="230" y="55" width="120" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.active === 'auth' ? '#60a5fa' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'auth' && <rect x="230" y="55" width="120" height="70" rx="14" fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.3" filter="url(#glow-blue)" />}
                                        <text x="290" y="85" textAnchor="middle" fill="#60a5fa" fontSize="14" fontFamily="monospace">🛡️</text>
                                        <text x="290" y="110" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Auth Service</text>
                                        {mapState.active === 'auth' && (
                                            <foreignObject x="225" y="22" width="130" height="30">
                                                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#93c5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    JWT & Routing
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* NODE: Models Service (tooltip: bottom) */}
                                    <g>
                                        <rect x="230" y="185" width="120" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.active === 'models' ? '#a78bfa' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'models' && <rect x="230" y="185" width="120" height="70" rx="14" fill="none" stroke="#a78bfa" strokeWidth="1.5" opacity="0.3" filter="url(#glow-purple)" />}
                                        <text x="290" y="215" textAnchor="middle" fill="#a78bfa" fontSize="14" fontFamily="monospace">📦</text>
                                        <text x="290" y="238" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Models Service</text>
                                        {mapState.active === 'models' && (
                                            <foreignObject x="225" y="260" width="130" height="30">
                                                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#c4b5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Artifact Registry
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* NODE: Prediction Engine (tooltip: bottom) */}
                                    <g>
                                        <rect x="230" y="315" width="120" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.active === 'predictions' ? '#facc15' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'predictions' && <rect x="230" y="315" width="120" height="70" rx="14" fill="none" stroke="#facc15" strokeWidth="1.5" opacity="0.3" filter="url(#glow-blue)" />}
                                        <text x="290" y="345" textAnchor="middle" fill="#facc15" fontSize="14" fontFamily="monospace">⚡</text>
                                        <text x="290" y="370" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Prediction Engine</text>
                                        {mapState.active === 'predictions' && (
                                            <foreignObject x="225" y="390" width="130" height="30">
                                                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#fde68a', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Dynamic Inference
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* NODE: Redis Cache (tooltip: right) */}
                                    <g>
                                        <rect x="420" y="125" width="110" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.active === 'predictions' && mapState.phase >= 2 ? '#f87171' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="475" y="155" textAnchor="middle" fill="#f87171" fontSize="14" fontFamily="monospace">⚡</text>
                                        <text x="475" y="178" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Redis Cache</text>
                                        {mapState.active === 'predictions' && mapState.phase >= 2 && (
                                            <foreignObject x="420" y="198" width="140" height="30">
                                                <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.1 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#fca5a5', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Tier-2 Sub-ms Cache
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* NODE: PostgreSQL (tooltip: right) */}
                                    <g>
                                        <rect x="420" y="235" width="110" height="70" rx="14" fill="#0a0a0a"
                                            stroke={mapState.phase >= 2 && mapState.active ? '#a78bfa' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="475" y="265" textAnchor="middle" fill="#a78bfa" fontSize="14" fontFamily="monospace">🗄️</text>
                                        <text x="475" y="288" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">PostgreSQL</text>
                                        {mapState.phase >= 2 && mapState.active && (
                                            <foreignObject x="420" y="308" width="140" height="30">
                                                <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.2 }}
                                                    style={{ fontSize: '10px', fontFamily: 'monospace', color: '#c4b5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '4px 8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    System of Record
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>
                                </g>

                                {/* ── MOBILE VIEW (block lg:hidden) – Vertical Cascading Pipeline ── */}
                                <g className="block lg:hidden">
                                    {/* Static vertical connection lines */}
                                    <line x1="290" y1="80" x2="210" y2="130" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="290" y1="80" x2="370" y2="130" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="290" y1="80" x2="290" y2="240" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="210" y1="190" x2="370" y2="350" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="370" y1="190" x2="370" y2="350" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="290" y1="300" x2="210" y2="350" stroke="#1e293b" strokeWidth="1.5" />
                                    <line x1="290" y1="300" x2="370" y2="350" stroke="#1e293b" strokeWidth="1.5" />

                                    {/* Animated path traces */}
                                    {mapState.active === 'auth' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="290" y1="80" x2="210" y2="130" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="210" y1="190" x2="370" y2="350" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}
                                    {mapState.active === 'models' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="290" y1="80" x2="370" y2="130" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="370" y1="190" x2="370" y2="350" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}
                                    {mapState.active === 'predictions' && mapState.phase >= 0 && (
                                        <>
                                            <motion.line x1="290" y1="80" x2="290" y2="240" stroke="#60a5fa" strokeWidth="2" filter="url(#glow-blue)"
                                                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            {mapState.phase >= 2 && (
                                                <motion.line x1="290" y1="300" x2="210" y2="350" stroke="#f87171" strokeWidth="2" filter="url(#glow-red)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                            {mapState.phase >= 3 && (
                                                <motion.line x1="290" y1="300" x2="370" y2="350" stroke="#a78bfa" strokeWidth="2" filter="url(#glow-purple)"
                                                    initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.5 }} />
                                            )}
                                        </>
                                    )}

                                    {/* Tier 1: Client */}
                                    <g>
                                        <rect x="230" y="20" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.active ? '#3b82f6' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="290" y="45" textAnchor="middle" fill="#94a3b8" fontSize="14" fontFamily="monospace">💻</text>
                                        <text x="290" y="65" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Client App</text>
                                        {mapState.active && (
                                            <foreignObject x="360" y="30" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#e2e8f0', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Origin
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* Tier 2: Auth Service (left) */}
                                    <g>
                                        <rect x="150" y="130" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.active === 'auth' ? '#60a5fa' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'auth' && <rect x="150" y="130" width="120" height="60" rx="12" fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.3" filter="url(#glow-blue)" />}
                                        <text x="210" y="155" textAnchor="middle" fill="#60a5fa" fontSize="14" fontFamily="monospace">🛡️</text>
                                        <text x="210" y="175" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Auth Service</text>
                                        {mapState.active === 'auth' && (
                                            <foreignObject x="20" y="145" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#93c5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    JWT & Route
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* Tier 2: Models Service (right) */}
                                    <g>
                                        <rect x="310" y="130" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.active === 'models' ? '#a78bfa' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'models' && <rect x="310" y="130" width="120" height="60" rx="12" fill="none" stroke="#a78bfa" strokeWidth="1.5" opacity="0.3" filter="url(#glow-purple)" />}
                                        <text x="370" y="155" textAnchor="middle" fill="#a78bfa" fontSize="14" fontFamily="monospace">📦</text>
                                        <text x="370" y="175" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Models Service</text>
                                        {mapState.active === 'models' && (
                                            <foreignObject x="440" y="145" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#c4b5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Registry
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* Tier 3: Prediction Engine (center) */}
                                    <g>
                                        <rect x="230" y="240" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.active === 'predictions' ? '#facc15' : '#1e293b'} strokeWidth="1.5" />
                                        {mapState.active === 'predictions' && <rect x="230" y="240" width="120" height="60" rx="12" fill="none" stroke="#facc15" strokeWidth="1.5" opacity="0.3" filter="url(#glow-blue)" />}
                                        <text x="290" y="265" textAnchor="middle" fill="#facc15" fontSize="14" fontFamily="monospace">⚡</text>
                                        <text x="290" y="285" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Prediction Eng</text>
                                        {mapState.active === 'predictions' && (
                                            <foreignObject x="360" y="255" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#fde68a', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Inference
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* Tier 4: Redis Cache (left) */}
                                    <g>
                                        <rect x="150" y="350" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.active === 'predictions' && mapState.phase >= 2 ? '#f87171' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="210" y="375" textAnchor="middle" fill="#f87171" fontSize="14" fontFamily="monospace">⚡</text>
                                        <text x="210" y="395" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">Redis Cache</text>
                                        {mapState.active === 'predictions' && mapState.phase >= 2 && (
                                            <foreignObject x="20" y="365" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.1 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#fca5a5', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Sub-ms Cache
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>

                                    {/* Tier 4: PostgreSQL (right) */}
                                    <g>
                                        <rect x="310" y="350" width="120" height="60" rx="12" fill="#0a0a0a"
                                            stroke={mapState.phase >= 2 && mapState.active ? '#a78bfa' : '#1e293b'} strokeWidth="1.5" />
                                        <text x="370" y="375" textAnchor="middle" fill="#a78bfa" fontSize="14" fontFamily="monospace">🗄️</text>
                                        <text x="370" y="395" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">PostgreSQL</text>
                                        {mapState.phase >= 2 && mapState.active && (
                                            <foreignObject x="440" y="365" width="120" height="30">
                                                <motion.div initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.2 }}
                                                    style={{ fontSize: '9px', fontFamily: 'monospace', color: '#c4b5fd', textAlign: 'center', background: 'rgba(0,0,0,0.95)', border: '1px solid #374151', borderRadius: '6px', padding: '2px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                                                    Record DB
                                                </motion.div>
                                            </foreignObject>
                                        )}
                                    </g>
                                </g>
                            </svg>
                        </motion.div>

                        {/* ── RIGHT: HUD & Controls ── */}
                        <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="space-y-6 min-w-0">

                            {/* Action Buttons */}
                            <div className="space-y-3 min-w-0">
                                <h3 className="text-sm font-mono text-gray-500 uppercase tracking-widest mb-4">Trigger API Route</h3>

                                <button id="trigger-auth-btn" onClick={() => triggerRoute('auth')} disabled={mapState.animating}
                                    className="w-full group flex items-center gap-3 px-5 py-3.5 min-h-[44px] bg-blue-600/5 border border-blue-500/20 text-blue-400 font-mono text-sm rounded-xl hover:bg-blue-600/15 hover:border-blue-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200">
                                    <ShieldCheck className="w-4 h-4 shrink-0" />
                                    <span className="flex-1 text-left truncate">POST /auth/login</span>
                                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </button>

                                <button id="trigger-models-btn" onClick={() => triggerRoute('models')} disabled={mapState.animating}
                                    className="w-full group flex items-center gap-3 px-5 py-3.5 min-h-[44px] bg-purple-600/5 border border-purple-500/20 text-purple-400 font-mono text-sm rounded-xl hover:bg-purple-600/15 hover:border-purple-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200">
                                    <Box className="w-4 h-4 shrink-0" />
                                    <span className="flex-1 text-left truncate">GET /models</span>
                                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </button>

                                <button id="trigger-predictions-btn" onClick={() => triggerRoute('predictions')} disabled={mapState.animating}
                                    className="w-full group flex items-center gap-3 px-5 py-3.5 min-h-[44px] bg-yellow-600/5 border border-yellow-500/20 text-yellow-400 font-mono text-sm rounded-xl hover:bg-yellow-600/15 hover:border-yellow-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200">
                                    <Zap className="w-4 h-4 shrink-0" />
                                    <span className="flex-1 text-left truncate">POST /predictions</span>
                                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </button>
                            </div>

                            {/* Network Request Log Terminal */}
                            <div className="bg-black border border-gray-800 rounded-xl overflow-hidden font-mono text-sm min-w-0">
                                <div className="flex items-center px-4 py-3 border-b border-gray-800 bg-gray-900/50 min-w-0">
                                    <Terminal className="w-4 h-4 text-gray-500 mr-2 shrink-0" />
                                    <span className="text-gray-500 text-xs truncate">network_request_log</span>
                                    {mapState.animating && (
                                        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}
                                            className="ml-auto text-[10px] text-green-400 font-bold shrink-0">● LIVE</motion.span>
                                    )}
                                </div>
                                <div className="p-4 min-h-[160px] space-y-2 overflow-x-auto">
                                    {mapState.logs.length === 0 ? (
                                        <p className="text-gray-600 text-xs italic">Awaiting route trigger...</p>
                                    ) : (
                                        <AnimatePresence>
                                            {mapState.logs.map((log, i) => (
                                                <motion.p key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
                                                    className="text-xs leading-relaxed break-all" style={{ color: log.color }}>
                                                    {log.text}
                                                </motion.p>
                                            ))}
                                        </AnimatePresence>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ── 3. SUPPORTED MODEL ARCHITECTURES ─────────────────── */}
            <section className="py-16 sm:py-24 px-4 sm:px-6 border-t border-gray-900 z-10 relative bg-black min-w-0">
                <div className="max-w-6xl mx-auto min-w-0">
                    <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} viewport={{ once: true }} className="text-center mb-12 sm:mb-16 min-w-0">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Supported Model Architectures</h2>
                        <p className="text-sm sm:text-base text-gray-400 max-w-2xl mx-auto leading-relaxed px-2">
                            Train, serialize, and deploy production-grade models across four battle-tested algorithmic families.
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 min-w-0">
                        {/* Random Forest */}
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }}
                            whileHover={{ scale: 1.02, borderColor: '#3b82f6' }} transition={{ duration: 0.25 }}
                            className="group p-6 rounded-2xl border border-gray-800 bg-gray-950/60 backdrop-blur-sm cursor-default min-w-0 flex flex-col">
                            <Network className="w-8 h-8 text-blue-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Random Forest</h3>
                            <p className="text-xs font-mono text-blue-400/70 mb-3 truncate">Ensemble Bagging</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Robust parallel tree execution for high-variance datasets.</p>
                        </motion.div>

                        {/* XGBoost */}
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.05 }}
                            whileHover={{ scale: 1.02, borderColor: '#a855f7' }}
                            className="group p-6 rounded-2xl border border-gray-800 bg-gray-950/60 backdrop-blur-sm cursor-default min-w-0 flex flex-col">
                            <Zap className="w-8 h-8 text-purple-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">XGBoost</h3>
                            <p className="text-xs font-mono text-purple-400/70 mb-3 truncate">Gradient Boosting</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Extreme performance and auto-pruning for tabular data supremacy.</p>
                        </motion.div>

                        {/* Logistic Regression */}
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
                            whileHover={{ scale: 1.02, borderColor: '#22c55e' }}
                            className="group p-6 rounded-2xl border border-gray-800 bg-gray-950/60 backdrop-blur-sm cursor-default min-w-0 flex flex-col">
                            <TrendingUp className="w-8 h-8 text-green-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(34,197,94,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Logistic Regression</h3>
                            <p className="text-xs font-mono text-green-400/70 mb-3 truncate">Linear Baseline</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Lightning-fast, highly interpretable probabilistic classification.</p>
                        </motion.div>

                        {/* Decision Tree */}
                        <motion.div whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 20 }} viewport={{ once: true }} transition={{ delay: 0.15 }}
                            whileHover={{ scale: 1.02, borderColor: '#f59e0b' }}
                            className="group p-6 rounded-2xl border border-gray-800 bg-gray-950/60 backdrop-blur-sm cursor-default min-w-0 flex flex-col">
                            <GitMerge className="w-8 h-8 text-amber-500 mb-4 group-hover:drop-shadow-[0_0_8px_rgba(245,158,11,0.5)] transition-all duration-300 shrink-0" />
                            <h3 className="text-lg font-semibold text-white mb-1 truncate">Decision Tree</h3>
                            <p className="text-xs font-mono text-amber-400/70 mb-3 truncate">Non-linear Splits</p>
                            <p className="text-sm text-gray-400 leading-relaxed mt-auto">Fully explainable, rule-based algorithmic routing.</p>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ── CREATOR SIGNATURE ──────────────────────────────────── */}
            <footer className="py-10 border-t border-gray-900/50 bg-black min-w-0">
                <p className="text-center text-[11px] font-mono tracking-widest uppercase text-gray-700 select-none px-4">
                    Architected & Engineered by Gaurav Srivastava
                </p>
            </footer>

        </div>
    );
}

