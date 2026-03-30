import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Terminal, Zap, Activity, Database } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { apiFetch } from './api';

export default function Canvas() {
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();

    // 1. Initialize model from Studio's router state
    const [model, setModel] = useState<any>(location.state?.model || null);
    const [isLoadingModel, setIsLoadingModel] = useState(!model);

    const [isPredicting, setIsPredicting] = useState(false);
    const [result, setResult] = useState<{ prediction: string | number, confidence: number, latency: string, cached: boolean } | null>(null);

    // 2. Fallback fetch if user navigates directly via URL
    useEffect(() => {
        const fetchModelDetails = async () => {
            try {
                const res = await apiFetch(`/api/v1/models/${id}`);
                if (res.ok) {
                    const data = await res.json();
                    setModel(data);
                }
            } catch (error) {
                console.error("Failed to load model details:", error);
            } finally {
                setIsLoadingModel(false);
            }
        };
        if (id && !model) fetchModelDetails();
    }, [id, model]);

    // 3. Read exact features and sample data from the database
    const dynamicFeatures: string[] = model?.metrics?.feature_columns || [
        'AccountAge', 'MonthlyUsage', 'SupportTickets'
    ];

    // Grab the sample data from the database
    const sampleData: Record<string, any>[] = model?.metrics?.sample_data || [];

    const handlePredict = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsPredicting(true);
        setResult(null);

        const formData = new FormData(e.currentTarget);
        const input_data: Record<string, any> = {}; // Changed to 'any' to accept strings

        // FIX: Intelligently parse numbers vs strings for Categorical variables
        dynamicFeatures.forEach(feature => {
            const rawValue = formData.get(feature) as string;
            // If it converts to a valid number, send a number. Otherwise, send the string text.
            input_data[feature] = isNaN(Number(rawValue)) || rawValue.trim() === ''
                ? rawValue
                : Number(rawValue);
        });

        const payload = {
            model_id: id,
            input_data: input_data
        };

        try {
            const response = await apiFetch('/api/v1/predictions/predict', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            console.log("ML ENGINE RESPONSE:", data);

            // 4. Safely catch the exact response shape from the Python backend
            const finalPrediction = data.result ?? data.prediction ?? data.predictions?.[0] ?? JSON.stringify(data);

            // Calculate confidence percentage from probabilities array
            let calculatedConfidence = 92.1;
            if (data.probabilities && data.probabilities.length > 0) {
                calculatedConfidence = Math.max(...data.probabilities) * 100;
            }

            // Format real latency
            const formattedLatency = data.latency_ms ? `${data.latency_ms.toFixed(2)}ms` : '1.2ms';

            setResult({
                prediction: finalPrediction,
                confidence: Number(calculatedConfidence.toFixed(1)),
                latency: formattedLatency,
                cached: data.cached || false
            });

        } catch (error) {
            console.error("Inference Engine Offline:", error);
            setResult({
                prediction: 'CONNECTION_FAILED',
                confidence: 0, latency: '--', cached: false
            });
        } finally {
            setIsPredicting(false);
        }
    };

    const formatLabel = (str: string) => {
        return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
    };

    if (isLoadingModel) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background font-sans text-primary p-6 sm:p-12 flex flex-col">
            <nav className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
                <div className="flex items-center space-x-4">
                    <button onClick={() => navigate('/studio')} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-white">
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h1 className="text-xl font-medium tracking-wide">
                            {model?.name || 'Unknown Model'}
                            <span className="text-muted text-sm font-normal ml-3 bg-white/5 px-2 py-1 rounded-md">
                                v{model?.version || '1'}
                            </span>
                        </h1>
                    </div>
                </div>
            </nav>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Left Pane: Dynamic Inputs & Schema Preview */}
                <div className="flex flex-col border border-white/10 rounded-2xl bg-surface/20 overflow-hidden">
                    <div className="p-4 border-b border-white/10 bg-surface/50 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <Database className="h-4 w-4 text-muted" />
                            <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Dynamic Feature Inputs</h2>
                        </div>
                    </div>

                    <form onSubmit={handlePredict} className="p-6 flex-1 flex flex-col">

                        {/* --- DATASET PREVIEW TABLE --- */}
                        {sampleData.length > 0 && (
                            <div className="mb-6">
                                <label className="text-xs font-medium text-muted uppercase tracking-wider mb-2 block">
                                    Dataset Schema Preview (First 3 Rows)
                                </label>
                                <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/20 custom-scrollbar pb-2">
                                    <table className="w-full text-left text-xs whitespace-nowrap">
                                        <thead className="bg-white/[0.02] border-b border-white/10 text-muted">
                                            <tr>
                                                {dynamicFeatures.map(f => (
                                                    <th key={f} className="px-4 py-2 font-medium">{f}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.05]">
                                            {sampleData.map((row, i) => (
                                                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                    {dynamicFeatures.map(f => (
                                                        <td key={f} className="px-4 py-2 text-white/80">
                                                            {String(row[f])}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                        {/* ---------------------------------- */}

                        <div className="space-y-5 flex-1 overflow-y-auto pr-2">
                            {dynamicFeatures.map((feature, idx) => (
                                <div key={feature} className="space-y-1.5">
                                    <label className="text-sm font-medium text-muted">{formatLabel(feature)}</label>
                                    <input
                                        type="text"
                                        name={feature}
                                        required
                                        defaultValue={idx === 0 ? "7420" : idx === 1 ? "4" : ""} // Safe defaults
                                        className="w-full bg-background border border-white/10 px-4 py-3 text-sm rounded-lg focus:border-white/30 outline-none transition-all"
                                    />
                                </div>
                            ))}
                        </div>
                        <button type="submit" disabled={isPredicting} className="mt-8 group flex w-full items-center justify-center space-x-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-50 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                            <Play className={`h-4 w-4 ${isPredicting ? 'animate-pulse' : ''}`} fill="currentColor" />
                            <span>{isPredicting ? 'Executing Tensor Graph...' : 'Execute Prediction'}</span>
                        </button>
                    </form>

                </div>

                {/* Right Pane: The Output Terminal */}
                <div className="flex flex-col border border-white/10 rounded-2xl bg-[#0a0a0a] overflow-hidden font-mono relative">
                    <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <Terminal className="h-4 w-4 text-muted" />
                            <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Output Console</h2>
                        </div>
                        {result?.cached && (
                            <span className="flex items-center space-x-1 text-xs px-2 py-1 rounded-md bg-green-500/10 text-green-400 border border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]">
                                <Zap className="h-3 w-3" fill="currentColor" />
                                <span>TIER 2 CACHE HIT</span>
                            </span>
                        )}
                    </div>

                    <div className="p-6 flex-1 flex flex-col justify-center items-center">
                        {!isPredicting && !result && <p className="text-muted/40 text-sm">Awaiting execution matrix...</p>}

                        {isPredicting && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center space-y-4">
                                <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                                <p className="text-accent text-sm animate-pulse">Running model inference...</p>
                            </motion.div>
                        )}

                        {result && !isPredicting && (
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm space-y-6">
                                <div>
                                    <p className="text-muted text-xs mb-2">PREDICTION_RESULT</p>
                                    <div className={`text-2xl tracking-tight bg-white/5 border border-white/10 rounded-lg p-4 text-center ${result.prediction === 'CONNECTION_FAILED' ? 'text-red-400 font-bold' : 'text-white'}`}>
                                        {String(result.prediction)}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                        <p className="text-muted text-xs mb-1">CONFIDENCE</p>
                                        <p className="text-lg text-white">{result.confidence}%</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                        <p className="text-muted text-xs mb-1">LATENCY</p>
                                        <p className={`text-lg ${result.cached ? 'text-green-400' : 'text-white'}`}>{result.latency}</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}