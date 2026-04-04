import React, { useState, useEffect } from 'react';
import { ArrowLeft, Play, Activity, Target, ShieldCheck, Database, LayoutList, X, Filter } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from './api';
import { motion, AnimatePresence } from 'framer-motion';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';

export default function Canvas() {
    const navigate = useNavigate();
    const { id } = useParams();

    const [model, setModel] = useState<any>(null);
    const [isLoadingModel, setIsLoadingModel] = useState(true);
    const [isPredicting, setIsPredicting] = useState(false);

    // Core Lab State
    const [inputs, setInputs] = useState<Record<string, any>>({});
    const [schema, setSchema] = useState<Record<string, any>>({});
    const [predictionResult, setPredictionResult] = useState<any>(null);
    const [topFeatures, setTopFeatures] = useState<any[]>([]);

    // New UI States
    const [showAllFeatures, setShowAllFeatures] = useState(false);
    const [showSchemaModal, setShowSchemaModal] = useState(false);

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

    useEffect(() => {
        const fetchModelDetails = async () => {
            try {
                const res = await apiFetch(`/api/v1/models/${id}`);
                if (res.ok) {
                    const data = await res.json();
                    setModel(data);

                    const sampleData: any[] = data.metrics?.sample_data || [];
                    const inferredSchema: any = {};
                    const initialInputs: any = {};

                    // Robust Schema Inference
                    if (data.metrics?.feature_columns && sampleData.length > 0) {
                        data.metrics.feature_columns.forEach((f: string) => {
                            const values = sampleData.map(row => row[f]).filter(v => v !== null && v !== '');
                            const isNumeric = values.every(v => !isNaN(Number(v)));

                            if (isNumeric) {
                                const numVals = values.map(Number);
                                inferredSchema[f] = {
                                    type: 'continuous',
                                    min: Math.min(...numVals),
                                    max: Math.max(...numVals),
                                    median: numVals.sort((a, b) => a - b)[Math.floor(numVals.length / 2)]
                                };
                                initialInputs[f] = inferredSchema[f].median;
                            } else {
                                const uniqueVals = Array.from(new Set(values));
                                inferredSchema[f] = {
                                    type: 'categorical',
                                    options: uniqueVals,
                                    mode: uniqueVals[0] // Simplified mode
                                };
                                initialInputs[f] = inferredSchema[f].mode;
                            }
                        });
                        setSchema(inferredSchema);
                        setInputs(initialInputs);
                    }

                    // Extract Top 10 Features
                    if (data.metrics?.feature_importances && Object.keys(data.metrics.feature_importances).length > 0) {
                        const importances = Object.entries(data.metrics.feature_importances)
                            .map(([name, value]) => ({ name, value: Number(value) }))
                            .sort((a, b) => b.value - a.value)
                            .slice(0, 10);
                        setTopFeatures(importances);
                    }
                }
            } catch (error) {
                console.error("Failed to load model details:", error);
            } finally {
                setIsLoadingModel(false);
            }
        };
        fetchModelDetails();
    }, [id]);

    const handlePredict = async () => {
        setIsPredicting(true);
        try {
            const response = await apiFetch('/api/v1/predictions/batch', {
                method: 'POST',
                body: JSON.stringify({ model_id: id, input_data: [inputs] })
            });
            if (response.ok) {
                const data = await response.json();
                setPredictionResult(data.predictions[0]);
            }
        } catch (error) {
            console.error("Inference Error:", error);
        } finally {
            setIsPredicting(false);
        }
    };

    const getProbabilityData = () => {
        if (!predictionResult?.probabilities) return [];
        const labels = model?.metrics?.class_labels || [];
        return predictionResult.probabilities.map((prob: number, index: number) => ({
            name: labels[index] ? `Class ${labels[index]}` : `Label ${index}`,
            value: prob * 100
        })).filter((item: any) => item.value > 0);
    };

    if (isLoadingModel) {
        return <div className="min-h-screen bg-transparent flex items-center justify-center"><div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;
    }

    const isClassification = model?.metrics?.task_type === 'classification';
    const probData = getProbabilityData();
    const allFeatureNames = Object.keys(schema);
    const topFeatureNames = topFeatures.map(f => f.name);

    // Fallback: If no top features exist, show all features by default so the sandbox isn't blank
    const activeSandboxFeatures = topFeatures.length > 0
        ? (showAllFeatures ? allFeatureNames : topFeatureNames)
        : allFeatureNames;

    return (
        <div className="min-h-screen bg-transparent relative z-10 font-sans text-primary p-6 sm:p-12 flex flex-col h-screen overflow-hidden">

            {/* Schema Modal */}
            <AnimatePresence>
                {showSchemaModal && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
                        >
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
                                <div className="flex items-center space-x-2">
                                    <ShieldCheck className="h-5 w-5 text-green-400" />
                                    <h2 className="text-lg font-medium text-white">Schema Fingerprint</h2>
                                </div>
                                <button onClick={() => setShowSchemaModal(false)} className="text-muted hover:text-white transition-colors"><X className="h-5 w-5" /></button>
                            </div>
                            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                                <div className="flex flex-wrap gap-2">
                                    {allFeatureNames.map((f: string) => (
                                        <div key={f} className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-md text-xs flex items-center">
                                            <span className="font-medium text-white/80">{f}</span>
                                            <span className="mx-2 text-muted/30">|</span>
                                            <span className="text-muted font-mono">{schema[f]?.type === 'continuous' ? `Num (${schema[f].min} - ${schema[f].max})` : `Cat (${schema[f].options?.length})`}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Top Nav (Fault Tolerant Metrics) */}
            <nav className="flex items-center justify-between mb-6 border-b border-white/10 pb-6 shrink-0">
                <div className="flex items-center space-x-4">
                    <button onClick={() => navigate('/studio')} className="p-2 hover:bg-white/5 rounded-lg text-muted hover:text-white transition-colors"><ArrowLeft className="h-5 w-5" /></button>
                    <div className="flex items-center">
                        <h1 className="text-xl font-medium tracking-wide">{model?.name}</h1>
                        <span className="text-muted text-sm mx-3 bg-white/5 px-2 py-1 rounded-md">v{model?.version}</span>
                        <button onClick={() => setShowSchemaModal(true)} className="flex items-center space-x-1 text-xs text-accent hover:text-accent/80 bg-accent/10 px-2 py-1 rounded transition-colors">
                            <LayoutList className="h-3 w-3" /><span>View Schema</span>
                        </button>
                    </div>
                </div>
                <div className="flex space-x-6 text-sm text-muted">
                    {isClassification ? (
                        <>
                            <span className="flex items-center"><Activity className="h-4 w-4 mr-2 text-green-400" /> Acc: {model?.metrics?.accuracy ? (model.metrics.accuracy * 100).toFixed(1) + '%' : 'N/A'}</span>
                            <span className="flex items-center"><Target className="h-4 w-4 mr-2 text-blue-400" /> F1: {model?.metrics?.f1_score ? (model.metrics.f1_score * 100).toFixed(1) + '%' : 'N/A'}</span>
                        </>
                    ) : (
                        <>
                            <span className="flex items-center"><Activity className="h-4 w-4 mr-2 text-yellow-400" /> R²: {model?.metrics?.r2_score ?? 'N/A'}</span>
                            <span className="flex items-center"><Target className="h-4 w-4 mr-2 text-purple-400" /> MSE: {model?.metrics?.mse ?? 'N/A'}</span>
                        </>
                    )}
                </div>
            </nav>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">

                {/* Panel 1: Top Drivers */}
                <div className="bg-surface/20 border border-white/10 rounded-2xl p-6 flex flex-col min-h-0">
                    <div className="flex items-center space-x-2 mb-6">
                        <ShieldCheck className="h-4 w-4 text-accent" />
                        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Top Drivers</h2>
                    </div>
                    <div className="flex-1 w-full relative">
                        {topFeatures.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topFeatures} layout="vertical" margin={{ left: 10, right: 20 }}>
                                    <XAxis type="number" hide />
                                    {/* ✅ FIX: Added width to prevent label truncation */}
                                    <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                                    <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted/40">
                                <Activity className="h-8 w-8 mb-2 opacity-20" />
                                <span className="text-xs">No importance data found</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Panel 2: Sandbox */}
                <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col relative shadow-2xl min-h-0">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                        <div className="flex items-center space-x-2">
                            <Database className="h-4 w-4 text-muted" />
                            <h2 className="text-sm font-medium text-white tracking-wide">Feature Sandbox</h2>
                        </div>
                        <div className="flex items-center space-x-3">
                            {/* ✅ FIX: Toggle for all features (only show if we have top features to toggle against) */}
                            {topFeatures.length > 0 && (
                                <button onClick={() => setShowAllFeatures(!showAllFeatures)} className="text-xs flex items-center text-muted hover:text-white transition-colors">
                                    <Filter className="h-3 w-3 mr-1" /> {showAllFeatures ? 'Show Core' : `Show All (${allFeatureNames.length})`}
                                </button>
                            )}
                            <button onClick={handlePredict} disabled={isPredicting} className="bg-accent px-4 py-1.5 rounded-md text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 flex items-center">
                                <Play className={`h-3 w-3 mr-1 ${isPredicting ? 'animate-pulse' : ''}`} /> Run
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-3 custom-scrollbar space-y-5">
                        {activeSandboxFeatures.map((featName) => {
                            const featSchema = schema[featName];
                            if (!featSchema) return null;

                            return (
                                <div key={featName} className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[11px] text-muted font-medium truncate pr-2 uppercase tracking-wider">{featName.replace(/_/g, ' ')}</label>
                                        <span className="text-xs text-white bg-white/5 px-2 py-0.5 rounded font-mono border border-white/5">{inputs[featName]}</span>
                                    </div>
                                    {featSchema.type === 'categorical' ? (
                                        <select
                                            value={inputs[featName]}
                                            onChange={(e) => setInputs({ ...inputs, [featName]: e.target.value })}
                                            className="w-full bg-surface border border-white/10 rounded text-xs text-white/90 p-1.5 outline-none"
                                        >
                                            {featSchema.options.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    ) : (
                                        <input
                                            type="range" min={featSchema.min} max={featSchema.max} step="any" value={inputs[featName] || 0}
                                            onChange={(e) => setInputs({ ...inputs, [featName]: parseFloat(e.target.value) })}
                                            className="w-full accent-accent h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Panel 3: Prediction Output (Fault Tolerant) */}
                <div className="bg-surface/20 border border-white/10 rounded-2xl p-6 flex flex-col min-h-0">
                    <div className="flex items-center space-x-2 mb-6">
                        <Target className="h-4 w-4 text-green-400" />
                        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
                            {isClassification ? 'Probability Spread' : 'Inference Result'}
                        </h2>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-center relative w-full h-full">
                        {predictionResult ? (
                            isClassification && probData.length > 0 ? (
                                <div className="relative w-full h-full flex items-center justify-center">
                                    {/* ✅ FIX: Donut Chart Centering perfectly aligns the text and the SVG */}
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={probData} cx="50%" cy="50%" innerRadius="60%" outerRadius="80%" paddingAngle={2} dataKey="value" animationDuration={800}>
                                                {probData.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                            </Pie>
                                            <RechartsTooltip formatter={(value: any) => typeof value === 'number' ? `${value.toFixed(1)}%` : value} contentStyle={{ backgroundColor: '#111', border: 'none', borderRadius: '8px', fontSize: '12px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>

                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none flex flex-col items-center justify-center">
                                        <span className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Class</span>
                                        <span className="text-4xl font-black text-white leading-none">{predictionResult.result}</span>
                                    </div>
                                </div>
                            ) : (
                                /* Fallback for Regression / Numeric outputs */
                                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center bg-white/5 p-8 rounded-full border border-white/10 shadow-[0_0_30px_rgba(59,130,246,0.1)]">
                                    <span className="block text-xs text-muted mb-2 uppercase tracking-widest">Predicted Value</span>
                                    <span className="text-4xl font-mono text-accent">{typeof predictionResult.result === 'number' ? predictionResult.result.toFixed(2) : predictionResult.result}</span>
                                </motion.div>
                            )
                        ) : (
                            <div className="text-center">
                                <Database className="h-8 w-8 text-muted/20 mx-auto mb-3" />
                                <span className="text-xs text-muted/50">Adjust parameters and click Run</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}