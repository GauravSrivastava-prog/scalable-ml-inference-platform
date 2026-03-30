import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, ArrowRight, Cpu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

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
                const response = await fetch('http://localhost:9000/api/v1/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
        <div className="flex h-screen w-full bg-background overflow-hidden font-sans">

            {/* Left Side: The "AI Core" Animation */}
            <div className="relative hidden lg:flex w-1/2 items-center justify-center border-r border-white/5 bg-background">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.05)_0%,transparent_50%)]" />

                <motion.div
                    animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[100px]"
                />

                <div className="relative z-10 text-center">
                    <Cpu className="mx-auto h-12 w-12 text-white/20 mb-6" strokeWidth={1} />
                    <h1 className="text-4xl font-light tracking-tight text-white/90">Scalable Inference</h1>
                    <p className="mt-4 text-sm font-medium tracking-widest text-muted uppercase">Platform Protocol</p>
                </div>
            </div>

            {/* Right Side: The Login Pane */}
            <div className="flex w-full lg:w-1/2 items-center justify-center p-8 sm:p-12 lg:p-24">
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

                    {/* FIX: Form now uses handleSubmit */}
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">

                            <AnimatePresence mode="wait">
                                {!isLogin && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                        <input
                                            type="text" placeholder="Username (e.g., gaurav_01)" required={!isLogin}
                                            value={username} onChange={(e) => setUsername(e.target.value)}
                                            className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <input
                                type="email" placeholder="Email address" required
                                value={email} onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg"
                            />
                            <input
                                type="password" placeholder="Password" required
                                value={password} onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-surface/50 border border-white/10 px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all rounded-lg"
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