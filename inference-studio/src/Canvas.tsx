import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Activity, Target, ShieldCheck, Database, LayoutList, X, Filter, FileText, Download, AlertTriangle, TrendingUp, Settings } from 'lucide-react';
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
    const [showReport, setShowReport] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);
    const reportSectionRef = useRef<HTMLDivElement>(null);

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

    const handleShowReport = () => {
        setShowReport(true);
        setTimeout(() => reportSectionRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    };

    const handleExportPDF = async () => {
        if (!reportRef.current) return;
        const { default: jsPDF } = await import('jspdf');
        const { default: html2canvas } = await import('html2canvas');

        const element = reportRef.current;
        const canvas = await html2canvas(element, {
            backgroundColor: '#0a0a0a',
            scale: 2,
            useCORS: true,
            logging: false,
        });

        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const imgHeight = (canvas.height * pdfWidth) / canvas.width;

        let position = 0;
        let remainingHeight = imgHeight;

        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
        remainingHeight -= pdfHeight;

        while (remainingHeight > 0) {
            position -= pdfHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
            remainingHeight -= pdfHeight;
        }

        pdf.save(`${model?.name}_v${model?.version}_analytics_report.pdf`);
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
        <div className="min-h-screen bg-transparent relative z-10 font-sans text-primary p-6 sm:p-12 flex flex-col overflow-y-auto">

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
                <div className="flex items-center gap-4">
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
                    <button
                        onClick={handleShowReport}
                        className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-accent/20 to-purple-500/20 border border-accent/30 text-accent hover:border-accent/60 px-3 py-1.5 rounded-lg transition-all"
                    >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Analytics Report</span>
                    </button>
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

            {/* ADVANCED ANALYTICS REPORT */}
            <div ref={reportSectionRef}>
                <AnimatePresence>
                    {showReport && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="mt-8"
                        >
                            {/* Report Header */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-accent/10 rounded-lg">
                                        <FileText className="h-5 w-5 text-accent" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-white">Advanced Analytics Report</h2>
                                        <p className="text-xs text-muted">{model?.name} v{model?.version} · {model?.algorithm?.replace(/_/g, ' ')} · {model?.metrics?.task_type}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleExportPDF}
                                    className="flex items-center gap-2 bg-gradient-to-r from-accent to-purple-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Export Technical Report to PDF
                                </button>
                            </div>

                            {/* Report Content — this div is captured by html2canvas */}
                            <div
                                ref={reportRef}
                                className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 space-y-8 font-mono"
                            >
                                {/* Report Title Block */}
                                <div className="border-b border-white/10 pb-6">
                                    <p className="text-[10px] text-accent uppercase tracking-widest mb-1">Inference Studio — Technical Model Report</p>
                                    <h1 className="text-2xl font-bold text-white">{model?.name}</h1>
                                    <p className="text-sm text-muted mt-1">Version {model?.version} · Algorithm: {model?.algorithm?.replace(/_/g, ' ')} · Task: {model?.metrics?.task_type ?? 'N/A'}</p>
                                    <div className="flex gap-6 mt-4 text-sm">
                                        {isClassification ? (
                                            <>
                                                <span className="text-green-400">Accuracy: {model?.metrics?.accuracy ? (model.metrics.accuracy * 100).toFixed(2) + '%' : 'N/A'}</span>
                                                <span className="text-blue-400">F1 Score: {model?.metrics?.f1_score ? (model.metrics.f1_score * 100).toFixed(2) + '%' : 'N/A'}</span>
                                                {model?.metrics?.log_loss && <span className="text-yellow-400">Log Loss: {model.metrics.log_loss}</span>}
                                                {model?.metrics?.ece && <span className="text-purple-400">ECE: {model.metrics.ece}</span>}
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-yellow-400">R² Score: {model?.metrics?.r2_score ?? 'N/A'}</span>
                                                <span className="text-purple-400">MSE: {model?.metrics?.mse ?? 'N/A'}</span>
                                            </>
                                        )}
                                        <span className="text-muted">Train: {model?.metrics?.train_size ?? 'N/A'} rows · Test: {model?.metrics?.test_size ?? 'N/A'} rows</span>
                                    </div>
                                </div>

                                {/* Section 1: Feature Pruning Log */}
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <AlertTriangle className="h-4 w-4 text-yellow-400" />
                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Section 1 — Feature Pruning Log</h3>
                                    </div>
                                    {model?.metrics?.pruned_columns && model.metrics.pruned_columns.length > 0 ? (
                                        <div className="space-y-3">
                                            <p className="text-xs text-muted leading-relaxed">
                                                The following <span className="text-yellow-400 font-bold">{model.metrics.pruned_columns.length} columns</span> were
                                                automatically excluded from the feature matrix before training to prevent data leakage and tree bloat:
                                            </p>
                                            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 space-y-3">
                                                {model.metrics.pruned_columns.map((col: string) => (
                                                    <div key={col} className="flex items-start gap-3">
                                                        <span className="text-yellow-400 mt-0.5">▸</span>
                                                        <div>
                                                            <span className="text-white font-bold">{col}</span>
                                                            <span className="text-muted text-xs ml-2">[HIGH_CARDINALITY / METADATA]</span>
                                                            <p className="text-xs text-muted/70 mt-1">
                                                                Cardinality ratio ≥ 0.95 or blocklist match. In tree-based models, a near-unique
                                                                string column provides near-zero information gain on unseen data. The model would
                                                                learn an ID→label mapping (memorization), producing high training accuracy
                                                                but severely degraded generalization (data leakage).
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-xs text-muted/60 leading-relaxed">
                                                <span className="text-white">Mathematical basis:</span> Information Gain (IG) for a split on column C is
                                                IG(T, C) = H(T) - Σ (|Tv|/|T|)·H(Tv). For a column with near-100% unique values,
                                                each split produces a leaf with ≈1 sample, driving H(Tv) → 0 and IG → H(T).
                                                This maximizes training IG artificially while learning nothing generalizable.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                                            <p className="text-xs text-green-400">✓ No columns were pruned. All features passed cardinality and metadata checks.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Section 2: Feature Importance Breakdown */}
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <TrendingUp className="h-4 w-4 text-blue-400" />
                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Section 2 — Feature Importance Breakdown</h3>
                                    </div>
                                    {topFeatures.length > 0 ? (
                                        <div className="space-y-4">
                                            <p className="text-xs text-muted leading-relaxed">
                                                {model?.algorithm === 'random_forest' || model?.algorithm === 'gradient_boosting' || model?.algorithm === 'decision_tree' ? (
                                                    <>Scores represent <span className="text-white">Mean Decrease in Impurity (MDI)</span>. For each feature, MDI measures the
                                                    total reduction in Gini impurity (or variance for regression) brought by that feature across all
                                                    splits in all trees, normalized to sum to 1.0.</>
                                                ) : model?.algorithm === 'xgboost' ? (
                                                    <>Scores represent <span className="text-white">Gain</span> — the average improvement in loss function
                                                    when a feature is used for a split, averaged across all trees where the feature appears.</>
                                                ) : (
                                                    <>Scores represent <span className="text-white">|coefficient| magnitude</span> from the linear model,
                                                    indicating the expected change in the output per unit change in the feature (after scaling).</>
                                                )}
                                            </p>
                                            <div className="overflow-hidden rounded-lg border border-white/10">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="bg-white/5">
                                                            <th className="text-left px-4 py-2 text-muted font-medium">#</th>
                                                            <th className="text-left px-4 py-2 text-muted font-medium">Feature</th>
                                                            <th className="text-right px-4 py-2 text-muted font-medium">Raw Score</th>
                                                            <th className="text-right px-4 py-2 text-muted font-medium">% of Total</th>
                                                            <th className="text-left px-4 py-2 text-muted font-medium">Relative Importance</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {topFeatures.map((f, i) => {
                                                            const maxVal = topFeatures[0]?.value || 1;
                                                            const totalImportance = topFeatures.reduce((s, x) => s + x.value, 0);
                                                            const pct = totalImportance > 0 ? ((f.value / totalImportance) * 100).toFixed(1) : '0.0';
                                                            const barWidth = ((f.value / maxVal) * 100).toFixed(1);
                                                            return (
                                                                <tr key={f.name} className="border-t border-white/5 hover:bg-white/[0.02]">
                                                                    <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                                                                    <td className="px-4 py-2.5 text-white font-medium">{f.name}</td>
                                                                    <td className="px-4 py-2.5 text-accent text-right font-mono">{f.value.toFixed(6)}</td>
                                                                    <td className="px-4 py-2.5 text-green-400 text-right">{pct}%</td>
                                                                    <td className="px-4 py-2.5">
                                                                        <div className="w-full bg-white/10 rounded-full h-1.5">
                                                                            <div
                                                                                className="h-1.5 rounded-full bg-gradient-to-r from-accent to-blue-400"
                                                                                style={{ width: `${barWidth}%` }}
                                                                            />
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted/50">Feature importance data not available for this model.</p>
                                    )}
                                </div>

                                {/* Section 3: Operational Recommendations */}
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <Settings className="h-4 w-4 text-purple-400" />
                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Section 3 — Operational Recommendations</h3>
                                    </div>
                                    <div className="space-y-3">
                                        {[
                                            {
                                                num: '01',
                                                color: 'text-blue-400',
                                                title: 'Hyperparameter Tuning',
                                                body: model?.algorithm === 'random_forest' || model?.algorithm === 'gradient_boosting'
                                                    ? `Current max_depth cap: 12. If ${isClassification ? 'accuracy' : 'R²'} < ${ isClassification ? '85%' : '0.85'}, consider increasing to 16. If training accuracy significantly exceeds test accuracy, reduce to 8 to combat overfitting. For Random Forest, increasing n_estimators to 200+ typically yields diminishing returns beyond stability gains.`
                                                    : model?.algorithm === 'xgboost'
                                                    ? `Tune learning_rate (0.01–0.3) in conjunction with n_estimators. Lower learning_rate + more estimators generally outperforms. Add subsample=0.8 and colsample_bytree=0.8 for regularization. Use early_stopping_rounds=50 to prevent overfitting.`
                                                    : `For linear models, regularization strength (C for Logistic Regression, alpha for Ridge) is the primary lever. Use cross-validation to identify the optimal C value on a log scale.`,
                                            },
                                            {
                                                num: '02',
                                                color: 'text-green-400',
                                                title: 'Feature Engineering',
                                                body: topFeatures.length > 0
                                                    ? `Top driver '${topFeatures[0]?.name}' carries ${((topFeatures[0]?.value / topFeatures.reduce((s:number, x:any) => s + x.value, 0)) * 100).toFixed(1)}% of total importance. Consider creating polynomial or interaction features (e.g., ${topFeatures[0]?.name} × ${topFeatures[1]?.name || 'secondary_feature'}) to capture non-linear relationships not expressible in the linear basis of this model type.`
                                                    : `Analyze feature correlations via a Pearson/Spearman matrix. Remove features with |correlation| > 0.95 to reduce multicollinearity. Consider PCA if dimensionality > 50 features.`,
                                            },
                                            {
                                                num: '03',
                                                color: 'text-purple-400',
                                                title: isClassification ? 'Class Imbalance' : 'Residual Analysis',
                                                body: isClassification
                                                    ? `If F1 score (${model?.metrics?.f1_score ? (model.metrics.f1_score * 100).toFixed(1) + '%' : 'N/A'}) trails Accuracy (${model?.metrics?.accuracy ? (model.metrics.accuracy * 100).toFixed(1) + '%' : 'N/A'}), the target distribution is likely imbalanced. Apply class_weight='balanced' (built-in to sklearn) or use SMOTE oversampling on the training set only (never the test set). Brier Score: ${model?.metrics?.brier_score ?? 'N/A'} — values < 0.25 indicate good calibration.`
                                                    : `Plot predicted vs actual values. Systematic curvature in residuals indicates a non-linear relationship that the current model is under-fitting. R² of ${model?.metrics?.r2_score ?? 'N/A'} — values > 0.85 indicate strong fit. MSE of ${model?.metrics?.mse ?? 'N/A'} — check for outliers in the target variable driving disproportionate loss.`,
                                            },
                                        ].map(rec => (
                                            <div key={rec.num} className="bg-white/[0.02] border border-white/5 rounded-lg p-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className={`font-bold text-sm ${rec.color}`}>{rec.num}</span>
                                                    <span className="text-white text-xs font-semibold uppercase tracking-wider">{rec.title}</span>
                                                </div>
                                                <p className="text-xs text-muted/80 leading-relaxed">{rec.body}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Report Footer */}
                                <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                                    <p className="text-[10px] text-muted/40">Generated by Inference Studio · {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                                    <p className="text-[10px] text-muted/40 font-mono">Model ID: {id}</p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}