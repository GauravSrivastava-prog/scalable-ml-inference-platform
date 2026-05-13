import { useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Server, Zap, Github, ArrowRight, Terminal, Activity } from 'lucide-react';
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
   PAYLOAD HASHING SIMULATOR – State Machine
   ═══════════════════════════════════════════════════════════════════ */

// Deterministic mock hashes for each payload
const MOCK_HASHES: Record<string, string> = {
    Patient_A: '8f4e2a1b9c3d7e6f0a5b4c8d2e1f3a7b',
    Patient_B: 'c7d9e3f2a1b8c4d5e6f0a9b3c2d1e8f4',
};

type SimPhase = 'idle' | 'hashing' | 'to-redis' | 'redis-check' | 'to-fastapi' | 'executing' | 'return' | 'done';

interface SimState {
    phase: SimPhase;
    payload: string | null;
    hash: string | null;
    cacheResult: 'miss' | 'hit' | null;
    latency: string;
    cache: Set<string>; // tracks which hashes are cached
}

const INITIAL_SIM: SimState = {
    phase: 'idle',
    payload: null,
    hash: null,
    cacheResult: null,
    latency: '-',
    cache: new Set(),
};

export default function LandingPage() {
    const navigate = useNavigate();
    usePrewarmCluster();

    // ── Payload Hashing Simulator state ──
    const [sim, setSim] = useState<SimState>(INITIAL_SIM);
    const cacheRef = useRef<Set<string>>(new Set());

    const injectPayload = useCallback((payloadName: string) => {
        if (sim.phase !== 'idle' && sim.phase !== 'done') return;

        const hash = MOCK_HASHES[payloadName];
        const isCached = cacheRef.current.has(hash);

        // Phase 1: Hashing (300ms)
        setSim({ phase: 'hashing', payload: payloadName, hash, cacheResult: null, latency: '-', cache: cacheRef.current });

        setTimeout(() => {
            // Phase 2: Dot traveling to Redis (400ms)
            setSim(s => ({ ...s, phase: 'to-redis' }));

            setTimeout(() => {
                if (isCached) {
                    // CACHE HIT path
                    setSim(s => ({ ...s, phase: 'redis-check', cacheResult: 'hit' }));
                    setTimeout(() => {
                        setSim(s => ({ ...s, phase: 'return' }));
                        setTimeout(() => {
                            setSim(s => ({ ...s, phase: 'done', latency: '2ms' }));
                        }, 200);
                    }, 300);
                } else {
                    // CACHE MISS path
                    setSim(s => ({ ...s, phase: 'redis-check', cacheResult: 'miss' }));
                    setTimeout(() => {
                        setSim(s => ({ ...s, phase: 'to-fastapi' }));
                        setTimeout(() => {
                            setSim(s => ({ ...s, phase: 'executing' }));
                            setTimeout(() => {
                                cacheRef.current.add(hash);
                                setSim(s => ({ ...s, phase: 'return' }));
                                setTimeout(() => {
                                    setSim(s => ({ ...s, phase: 'done', latency: '1.2s', cache: new Set(cacheRef.current) }));
                                }, 300);
                            }, 1200);
                        }, 300);
                    }, 400);
                }
            }, 400);
        }, 300);
    }, [sim.phase]);

    return (
        <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-blue-500/30">

            {/* ── 1. 3D HERO SECTION ─────────────────────────────────── */}
            <section className="relative flex flex-col items-center justify-center min-h-screen px-6 overflow-hidden">

                {/* Three.js Canvas – absolute fill behind the text */}
                <div className="absolute inset-0 z-0">
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
                    className="z-10 text-center max-w-4xl mx-auto mt-20"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 text-sm text-blue-400 border border-blue-900/50 rounded-full bg-blue-950/30 backdrop-blur-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                        Cluster Online
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent drop-shadow-lg">
                        Raw Data to Live API <br /> in 60 Seconds.
                    </h1>

                    <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                        A production-grade, microservice-driven MLOps platform. Upload CSVs, train dynamic models, and deploy instantly with sub-millisecond Redis caching.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            id="launch-studio-btn"
                            onClick={() => navigate(ROUTES.LOGIN)}
                            className="flex items-center gap-2 px-8 py-4 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors shadow-lg shadow-white/10"
                        >
                            Launch Studio <ArrowRight className="w-4 h-4" />
                        </button>
                        <a
                            href="https://github.com/GauravSrivastava-prog/scalable-ml-inference-platform"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-8 py-4 bg-transparent border border-gray-700 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <Github className="w-5 h-5" /> View Architecture
                        </a>
                    </div>
                </motion.div>
            </section>

            {/* ── 2. ARCHITECTURE PIPELINE ────────────────────────────── */}
            <section className="py-24 px-6 border-t border-gray-900 z-10 relative bg-black">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-bold mb-16 text-center">Engineered for Scale</h2>

                    <div className="grid md:grid-cols-3 gap-8">
                        <motion.div
                            whileInView={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 30 }}
                            viewport={{ once: true }}
                            className="p-8 rounded-2xl bg-gray-950 border border-gray-800 hover:border-gray-700 transition-colors"
                        >
                            <Database className="w-10 h-10 text-blue-500 mb-6" />
                            <h3 className="text-xl font-semibold mb-3">Dynamic Ingestion</h3>
                            <p className="text-gray-400">Auto-detects classification vs. regression tasks, applies label encoding, and sanitizes payload sizes seamlessly.</p>
                        </motion.div>

                        <motion.div
                            whileInView={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 30 }}
                            transition={{ delay: 0.1 }}
                            viewport={{ once: true }}
                            className="p-8 rounded-2xl bg-gray-950 border border-gray-800 hover:border-gray-700 transition-colors"
                        >
                            <Server className="w-10 h-10 text-purple-500 mb-6" />
                            <h3 className="text-xl font-semibold mb-3">Serverless Registry</h3>
                            <p className="text-gray-400">Model artifacts serialized to Supabase Object Storage, indexed by a Neon Serverless PostgreSQL backend.</p>
                        </motion.div>

                        <motion.div
                            whileInView={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 30 }}
                            transition={{ delay: 0.2 }}
                            viewport={{ once: true }}
                            className="p-8 rounded-2xl bg-gray-950 border border-gray-800 hover:border-gray-700 transition-colors"
                        >
                            <Zap className="w-10 h-10 text-yellow-500 mb-6" />
                            <h3 className="text-xl font-semibold mb-3">BFF Routing Pattern</h3>
                            <p className="text-gray-400">Client-side routing direct to microservices eliminates the Nginx API gateway single point of failure.</p>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ── 3. INTERACTIVE PAYLOAD HASHING SIMULATOR ──────────── */}
            <section className="py-24 px-6 bg-gray-950 border-t border-gray-900 z-10 relative">
                <div className="max-w-5xl mx-auto">
                    <motion.div
                        whileInView={{ opacity: 1, y: 0 }}
                        initial={{ opacity: 0, y: 30 }}
                        viewport={{ once: true }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl font-bold mb-4">Two-Tier Inference Caching</h2>
                        <p className="text-gray-400 max-w-2xl mx-auto leading-relaxed">
                            Why execute a Random Forest tree traversal twice? Inject identical payloads and watch
                            the SHA-256 hash resolve from Redis in under 2ms.
                        </p>
                    </motion.div>

                    {/* Payload Injector Buttons */}
                    <div className="flex items-center justify-center gap-4 mb-12">
                        <button
                            id="inject-patient-a-btn"
                            onClick={() => injectPayload('Patient_A')}
                            disabled={sim.phase !== 'idle' && sim.phase !== 'done'}
                            className="group flex items-center gap-2.5 px-6 py-3 bg-blue-600/10 border border-blue-500/30
                                       text-blue-400 font-mono text-sm rounded-lg
                                       hover:bg-blue-600/20 hover:border-blue-500/50
                                       disabled:opacity-40 disabled:cursor-not-allowed
                                       transition-all duration-200"
                        >
                            <Activity className="w-4 h-4" />
                            Inject Payload: Patient_A
                        </button>
                        <button
                            id="inject-patient-b-btn"
                            onClick={() => injectPayload('Patient_B')}
                            disabled={sim.phase !== 'idle' && sim.phase !== 'done'}
                            className="group flex items-center gap-2.5 px-6 py-3 bg-purple-600/10 border border-purple-500/30
                                       text-purple-400 font-mono text-sm rounded-lg
                                       hover:bg-purple-600/20 hover:border-purple-500/50
                                       disabled:opacity-40 disabled:cursor-not-allowed
                                       transition-all duration-200"
                        >
                            <Activity className="w-4 h-4" />
                            Inject Payload: Patient_B
                        </button>
                    </div>

                    {/* Hash Display */}
                    <AnimatePresence mode="wait">
                        {sim.hash && (
                            <motion.div
                                key={sim.hash}
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="text-center mb-10 font-mono text-xs"
                            >
                                <span className="text-gray-500">SHA-256 → </span>
                                <span className="text-blue-400/80 tracking-wider">{sim.hash.slice(0, 16)}...</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* ── ANIMATED FLOWCHART ──────────────────────────────── */}
                    <div className="relative flex items-center justify-between max-w-3xl mx-auto px-4 py-8">

                        {/* Connection lines (behind nodes) */}
                        <div className="absolute top-1/2 left-[16.67%] right-[16.67%] h-[1px] bg-gray-800 -translate-y-1/2" />

                        {/* Animated traveling dot */}
                        <AnimatePresence>
                            {(sim.phase === 'to-redis' || sim.phase === 'to-fastapi' || sim.phase === 'return') && (
                                <motion.div
                                    key={sim.phase}
                                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full z-20"
                                    style={{
                                        background: sim.cacheResult === 'hit' ? '#22c55e' : '#3b82f6',
                                        boxShadow: `0 0 12px ${sim.cacheResult === 'hit' ? 'rgba(34,197,94,0.6)' : 'rgba(59,130,246,0.6)'}`,
                                    }}
                                    initial={{
                                        left: sim.phase === 'to-redis' ? '16.67%'
                                            : sim.phase === 'to-fastapi' ? '50%'
                                                : sim.cacheResult === 'hit' ? '50%' : '83.33%',
                                    }}
                                    animate={{
                                        left: sim.phase === 'to-redis' ? '50%'
                                            : sim.phase === 'to-fastapi' ? '83.33%'
                                                : '16.67%',
                                    }}
                                    transition={{ duration: sim.phase === 'return' && sim.cacheResult === 'hit' ? 0.15 : 0.35, ease: 'easeInOut' }}
                                />
                            )}
                        </AnimatePresence>

                        {/* NODE 1: Client */}
                        <div className="relative z-10 flex flex-col items-center gap-2 w-1/3">
                            <div className={`w-16 h-16 rounded-xl border flex items-center justify-center transition-all duration-300 ${sim.phase === 'done' ? 'border-green-500/40 bg-green-500/5 shadow-[0_0_15px_rgba(34,197,94,0.15)]'
                                : 'border-gray-700 bg-gray-900/50'
                                }`}>
                                <Terminal className={`w-6 h-6 transition-colors duration-300 ${sim.phase === 'done' ? 'text-green-400' : 'text-gray-500'
                                    }`} />
                            </div>
                            <span className="text-[11px] font-mono text-gray-500 tracking-wider uppercase">Client</span>
                            {sim.phase === 'done' && (
                                <motion.span
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className={`text-[10px] font-mono font-bold ${sim.latency === '2ms' ? 'text-green-400' : 'text-yellow-400'
                                        }`}
                                >
                                    {sim.latency}
                                </motion.span>
                            )}
                        </div>

                        {/* NODE 2: Redis Tier-2 */}
                        <div className="relative z-10 flex flex-col items-center gap-2 w-1/3">
                            <div className={`w-16 h-16 rounded-xl border flex items-center justify-center transition-all duration-300 ${sim.phase === 'redis-check' && sim.cacheResult === 'hit'
                                ? 'border-green-500/50 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.2)]'
                                : sim.phase === 'redis-check' && sim.cacheResult === 'miss'
                                    ? 'border-yellow-500/50 bg-yellow-500/10 shadow-[0_0_20px_rgba(234,179,8,0.2)]'
                                    : 'border-gray-700 bg-gray-900/50'
                                }`}>
                                <Database className={`w-6 h-6 transition-colors duration-300 ${sim.phase === 'redis-check' && sim.cacheResult === 'hit' ? 'text-green-400'
                                    : sim.phase === 'redis-check' && sim.cacheResult === 'miss' ? 'text-yellow-400'
                                        : 'text-gray-500'
                                    }`} />
                            </div>
                            <span className="text-[11px] font-mono text-gray-500 tracking-wider uppercase">Redis Tier-2</span>
                            {sim.phase === 'redis-check' && (
                                <motion.span
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className={`text-[10px] font-mono font-bold ${sim.cacheResult === 'hit' ? 'text-green-400' : 'text-yellow-400'
                                        }`}
                                >
                                    {sim.cacheResult === 'hit' ? '● HIT' : '○ MISS'}
                                </motion.span>
                            )}
                        </div>

                        {/* NODE 3: FastAPI Worker */}
                        <div className="relative z-10 flex flex-col items-center gap-2 w-1/3">
                            <div className={`w-16 h-16 rounded-xl border flex items-center justify-center transition-all duration-300 ${sim.phase === 'executing'
                                ? 'border-blue-500/50 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                                : 'border-gray-700 bg-gray-900/50'
                                }`}>
                                <Server className={`w-6 h-6 transition-colors duration-300 ${sim.phase === 'executing' ? 'text-blue-400 animate-pulse' : 'text-gray-500'
                                    }`} />
                            </div>
                            <span className="text-[11px] font-mono text-gray-500 tracking-wider uppercase">FastAPI Worker</span>
                            {sim.phase === 'executing' && (
                                <motion.span
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ duration: 1.2, repeat: Infinity }}
                                    className="text-[10px] font-mono text-blue-400 font-bold"
                                >
                                    Executing...
                                </motion.span>
                            )}
                        </div>
                    </div>

                    {/* Terminal Log */}
                    <div className="max-w-3xl mx-auto mt-8">
                        <div className="bg-black border border-gray-800 rounded-xl overflow-hidden font-mono text-sm">
                            <div className="flex items-center px-4 py-3 border-b border-gray-800 bg-gray-900/50">
                                <Terminal className="w-4 h-4 text-gray-500 mr-2" />
                                <span className="text-gray-500">inference_pipeline_logs</span>
                            </div>
                            <div className="p-5 space-y-3 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-500">Payload:</span>
                                    <span className="text-white/70">{sim.payload ?? '—'}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-500">Hash:</span>
                                    <span className="text-blue-400/70 tracking-wider">
                                        {sim.hash ? `${sim.hash.slice(0, 16)}...` : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-500">Cache:</span>
                                    <span className={`font-bold ${sim.cacheResult === 'hit' ? 'text-green-400'
                                        : sim.cacheResult === 'miss' ? 'text-yellow-400'
                                            : 'text-gray-600'
                                        }`}>
                                        {sim.cacheResult ? sim.cacheResult.toUpperCase() : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center border-t border-gray-800 pt-3">
                                    <span className="text-gray-500">Latency:</span>
                                    <span className={`font-bold text-sm ${sim.latency === '2ms' ? 'text-green-400' : sim.latency === '1.2s' ? 'text-yellow-400' : 'text-gray-600'
                                        }`}>
                                        {sim.latency}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── CREATOR SIGNATURE ──────────────────────────────────── */}
            <footer className="py-10 border-t border-gray-900/50 bg-black">
                <p className="text-center text-[11px] font-mono tracking-widest uppercase text-gray-700 select-none">
                    Architected & Engineered by Gaurav Srivastava
                </p>
            </footer>

        </div>
    );
}