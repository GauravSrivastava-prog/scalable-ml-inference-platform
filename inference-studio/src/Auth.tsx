import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Cpu, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { apiFetch } from './api';
import { ROUTES } from './routes';


export default function Auth() {
    const navigate = useNavigate();
    const { login } = useAuth();

    // Toggle between Login and Register
    const [isLogin, setIsLogin] = useState(true);

    // Form State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Back button hover state for the HUD glow effect
    const [backHovered, setBackHovered] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (isLogin) {
                // --- LOGIN FLOW ---
                const success = await login(email, password);
                if (success) {
                    navigate('/studio');
                } else {
                    setError('Invalid credentials');
                }
            } else {
                // --- REGISTRATION FLOW ---
                const response = await apiFetch('/api/v1/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({ email, username, password }),
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.detail || 'Registration failed');
                }

                // Auto-login after successful registration
                const success = await login(email, password);
                if (success) {
                    navigate('/studio');
                } else {
                    setError('Registration successful, but auto-login failed. Please log in manually.');
                }
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        // Root container stays bg-transparent so the global canvas shows through
        <div className="relative flex h-screen w-full bg-transparent overflow-hidden font-sans">

            {/* ── HUD ESCAPE HATCH ─────────────────────────────────────
                 Premium glassmorphic command-line breadcrumb with a
                 pulsing blue border glow and magnetic hover expansion.
                 Positioned top-left as a floating HUD element that
                 feels native to the neural-network auth aesthetic.
                 ─────────────────────────────────────────────────────── */}
            <motion.button
                id="back-to-platform-btn"
                onClick={() => navigate(ROUTES.LANDING)}
                onMouseEnter={() => setBackHovered(true)}
                onMouseLeave={() => setBackHovered(false)}
                initial={{ opacity: 0, y: -20, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, delay: 1.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute top-5 left-5 z-50 cursor-pointer group"
                style={{ WebkitTapHighlightColor: 'transparent' }}
            >
                {/* Outer glow ring — pulses subtly, flares on hover */}
                <motion.div
                    className="absolute -inset-[1px] rounded-lg opacity-0 group-hover:opacity-100"
                    animate={{
                        boxShadow: backHovered
                            ? '0 0 20px rgba(59,130,246,0.3), 0 0 40px rgba(99,102,241,0.15), inset 0 0 12px rgba(59,130,246,0.1)'
                            : '0 0 8px rgba(59,130,246,0.1), 0 0 16px rgba(99,102,241,0.05)',
                    }}
                    transition={{ duration: 0.4 }}
                    style={{
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.1), rgba(59,130,246,0.15))',
                        borderRadius: '0.5rem',
                    }}
                />

                {/* Inner shell — glassmorphic card with monospaced HUD text */}
                <div
                    className="relative flex items-center gap-2 px-3.5 py-2 rounded-lg
                               bg-white/[0.03] backdrop-blur-xl
                               border border-white/[0.07] group-hover:border-blue-500/30
                               transition-all duration-300"
                >
                    {/* Animated chevron — slides left on hover */}
                    <motion.div
                        animate={{ x: backHovered ? -2 : 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    >
                        <ChevronLeft className="w-3.5 h-3.5 text-blue-400/60 group-hover:text-blue-400" />
                    </motion.div>

                    {/* Status dot — pulses like a live system indicator */}
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400/60 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500/80" />
                    </span>

                    {/* Monospaced label — reads like a terminal route */}
                    <span className="font-mono text-[11px] tracking-widest uppercase text-white/30 group-hover:text-white/70 transition-colors duration-300">
                        sys://platform
                    </span>
                </div>
            </motion.button>

            {/* Left Side: The "AI Core" Animation */}
            <div className="relative z-10 hidden lg:flex w-1/2 items-center justify-center border-r border-white/5 bg-transparent backdrop-blur-[2px]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.05)_0%,transparent_50%)]" />

                <motion.div
                    animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[100px]"
                />

                <div className="relative z-10 text-center">
                    <Cpu className="mx-auto h-12 w-12 text-white/20 mb-6" strokeWidth={1} />
                    <h1 className="text-4xl font-light tracking-tight text-white/90">Inference Studio</h1>
                    <p className="mt-4 text-sm font-medium tracking-widest text-muted uppercase">Train. Serve. Scale.</p>
                </div>
            </div>

            {/* Right Side: The Login Pane */}
            <div className="relative z-10 flex w-full lg:w-1/2 items-center justify-center p-8 sm:p-12 lg:p-24">
                <motion.div
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: "easeOut" }}
                    className="w-full max-w-md space-y-10"
                >
                    <div>
                        <h2 className="text-3xl font-light tracking-tight">
                            {isLogin ? 'Access Node' : 'Provision Node'}
                        </h2>
                        <p className="mt-2 text-sm text-muted">
                            {isLogin ? 'Enter your credentials to connect to the cluster.' : 'Create a new operator identity.'}
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">

                            <AnimatePresence mode="wait">
                                {!isLogin && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                        <input
                                            type="text" placeholder="Username (e.g., operator_01)" required={!isLogin}
                                            value={username} onChange={(e) => setUsername(e.target.value)}
                                            className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <input
                                type="email" placeholder="Email address" required
                                value={email} onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg backdrop-blur-md"
                            />
                            <input
                                type="password" placeholder="Password" required
                                value={password} onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg backdrop-blur-md"
                            />
                        </div>

                        <button type="submit" disabled={isLoading} className="group relative flex w-full items-center justify-between overflow-hidden rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:opacity-50">
                            <span className="relative z-10">
                                {isLoading ? 'Processing...' : (isLogin ? 'Initialize Connection' : 'Register Identity')}
                            </span>
                            <ArrowRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button onClick={() => { setIsLogin(!isLogin); setError(''); }} type="button" className="text-sm text-muted hover:text-white transition-colors">
                            {isLogin ? "Don't have an account? Register here." : "Already have clearance? Log in."}
                        </button>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}