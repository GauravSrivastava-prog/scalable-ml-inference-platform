import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

// Replace with your actual API fetch utility
// import { api } from '@/utils/api'; 

interface TrackerProps {
    predictionId: string;
}

type TrainingState = 'PENDING' | 'PREPROCESSING' | 'FITTING' | 'READY' | 'FAILED';

const STEPS: { id: TrainingState; label: string }[] = [
    { id: 'PENDING', label: 'Queued' },
    { id: 'PREPROCESSING', label: 'Processing Data' },
    { id: 'FITTING', label: 'Fitting Model' },
    { id: 'READY', label: 'Deployed' },
];

export const LiveTrainingTracker: React.FC<TrackerProps> = ({ predictionId }) => {
    const [status, setStatus] = useState<TrainingState>('PENDING');
    const [logs, setLogs] = useState<string[]>(['> [SYSTEM] Initializing telemetry link...']);

    useEffect(() => {
        let pollInterval: ReturnType<typeof setInterval>;

        const pollStatus = async () => {
            try {
                // Replace this fetch with your actual authenticated API call
                // const response = await api.get(`/api/v1/predictions/${predictionId}`);
                const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/predictions/${predictionId}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } // Add your auth method
                });

                const data = await response.json();

                if (data.status !== status) {
                    setStatus(data.status as TrainingState);
                    setLogs(prev => [...prev, `> [CELERY] State transitioned to ${data.status}...`]);
                }

                if (data.status === 'READY' || data.status === 'FAILED') {
                    clearInterval(pollInterval);
                    if (data.status === 'READY') {
                        setLogs(prev => [...prev, '> [SYSTEM] Model successfully deployed to local volume.']);
                    }
                }
            } catch (error) {
                console.error("Polling failed", error);
            }
        };

        // Poll every 3 seconds
        pollInterval = setInterval(pollStatus, 3000);
        pollStatus(); // Initial fetch

        return () => clearInterval(pollInterval);
    }, [predictionId, status]);

    const activeIndex = STEPS.findIndex(s => s.id === status);

    return (
        <div className="w-full max-w-3xl mx-auto p-6 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl font-mono">
            <h3 className="text-white/80 text-sm mb-6 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE INFERENCE WORKER
            </h3>

            {/* Visual Stepper */}
            <div className="flex items-center justify-between relative mb-8">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[2px] bg-white/10 z-0"></div>

                {STEPS.map((step, index) => {
                    const isPast = index < activeIndex;
                    const isActive = index === activeIndex;

                    return (
                        <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
                            <motion.div
                                initial={false}
                                animate={{
                                    backgroundColor: isPast || isActive ? '#10b981' : '#1f2937',
                                    scale: isActive ? 1.2 : 1,
                                    boxShadow: isActive ? '0 0 15px rgba(16, 185, 129, 0.5)' : 'none'
                                }}
                                className={`w-4 h-4 rounded-full border-2 border-black`}
                            />
                            <span className={`text-xs ${isPast || isActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Terminal Ticker */}
            <div className="bg-gray-950 rounded border border-white/5 p-4 h-32 overflow-y-auto font-mono text-xs text-emerald-500/70">
                {logs.map((log, i) => (
                    <div key={i} className="mb-1">{log}</div>
                ))}
                {status !== 'READY' && status !== 'FAILED' && (
                    <div className="animate-pulse">_</div>
                )}
            </div>
        </div>
    );
};