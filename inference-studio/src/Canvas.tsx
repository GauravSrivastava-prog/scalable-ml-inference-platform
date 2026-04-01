import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowLeft, Play, Database, Activity, Target, Plus, ShieldCheck, Trash2, ClipboardPaste, CheckCircle2 } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { apiFetch } from './api';

// --- Helper Functions ---
const getMedian = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const getMode = (arr: any[]) => {
    if (arr.length === 0) return "";
    return arr.sort((a, b) =>
        arr.filter(v => v === a).length - arr.filter(v => v === b).length
    ).pop();
};

const generateRowId = () => Math.random().toString(36).substring(2, 9);

export default function Canvas() {
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();

    const [model, setModel] = useState<any>(location.state?.model || null);
    const [isLoadingModel, setIsLoadingModel] = useState(!model);
    const [isPredicting, setIsPredicting] = useState(false);

    const [gridData, setGridData] = useState<Record<string, any>[]>([]);
    const [schema, setSchema] = useState<Record<string, any>>({});
    const [results, setResults] = useState<any[]>([]);
    const [toastMsg, setToastMsg] = useState<string | null>(null);

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

    useEffect(() => {
        if (!model?.metrics) return;

        const features: string[] = model.metrics.feature_columns || [];
        const sampleData: Record<string, any>[] = model.metrics.sample_data || [];

        const inferredSchema: Record<string, any> = {};
        const ghostRow: Record<string, any> = { _id: generateRowId() };

        features.forEach(f => {
            const values = sampleData.map(row => row[f]).filter(v => v !== null && v !== undefined && v !== '');

            if (values.length === 0) {
                inferredSchema[f] = { type: 'continuous', median: 0, min: 0, max: 0 };
                ghostRow[f] = 0;
                return;
            }

            const isNumeric = values.every(v => !isNaN(Number(v)));
            const isInteger = values.every(v => Number.isInteger(Number(v)));
            const uniqueVals = Array.from(new Set(values));

            let type = 'continuous';
            if (!isNumeric) {
                type = 'categorical';
            } else if (isInteger && uniqueVals.length <= 5 && uniqueVals.every(v => Number(v) >= 0 && Number(v) <= 10)) {
                type = 'categorical';
            }

            if (type === 'continuous') {
                const numVals = values.map(Number);
                inferredSchema[f] = {
                    type: 'continuous',
                    median: getMedian(numVals),
                    min: Math.min(...numVals),
                    max: Math.max(...numVals)
                };
                ghostRow[f] = inferredSchema[f].median;
            } else {
                inferredSchema[f] = {
                    type: 'categorical',
                    options: uniqueVals.sort((a, b) => a > b ? 1 : -1),
                    mode: getMode(values)
                };
                ghostRow[f] = inferredSchema[f].mode;
            }
        });

        setSchema(inferredSchema);
        if (gridData.length === 0) {
            setGridData([ghostRow]);
        }
    }, [model]);

    const handleCellChange = (rowIndex: number, feature: string, value: string) => {
        const newData = [...gridData];
        newData[rowIndex][feature] = schema[feature]?.type === 'continuous' ? Number(value) : value;
        setGridData(newData);
    };

    const addRow = () => {
        const newRow: Record<string, any> = { _id: generateRowId() };
        Object.keys(schema).forEach(f => {
            newRow[f] = schema[f].type === 'continuous' ? schema[f].median : schema[f].mode;
        });
        setGridData([...gridData, newRow]);
    };

    const deleteRow = (index: number) => {
        if (gridData.length <= 1) return; // Guardrail
        setGridData(prev => prev.filter((_, i) => i !== index));
        setResults(prev => prev.filter((_, i) => i !== index));
    };

    // --- BULK PASTE ENGINE ---
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const clipboardData = e.clipboardData.getData('Text');
        if (!clipboardData) return;

        // Simple TSV/CSV parsing
        const rows = clipboardData.trim().split('\n').map(row => row.split(/\t|,/));
        if (rows.length === 0 || rows[0].length === 0) return;

        const features = Object.keys(schema);
        const newGridData: Record<string, any>[] = [];

        rows.forEach(row => {
            const newRow: Record<string, any> = { _id: generateRowId() };
            features.forEach((f, i) => {
                // If pasted data has this column, cast it based on schema, else use median/mode fallback
                if (row[i] !== undefined) {
                    newRow[f] = schema[f].type === 'continuous' ? Number(row[i].trim()) : row[i].trim();
                } else {
                    newRow[f] = schema[f].type === 'continuous' ? schema[f].median : schema[f].mode;
                }
            });
            newGridData.push(newRow);
        });

        if (newGridData.length > 0) {
            setGridData(prev => [...prev, ...newGridData]);
            setToastMsg(`✓ ${newGridData.length} rows successfully pasted`);
            setTimeout(() => setToastMsg(null), 3000);
        }
    }, [schema]);

    const handlePredict = async () => {
        setIsPredicting(true);
        setResults([]);

        try {
            // Strip out internal _id before sending
            const cleanInputs = gridData.map(row => {
                const cleanRow = { ...row };
                delete cleanRow._id;
                return cleanRow;
            });

            const payload = {
                model_id: id,
                input_data: cleanInputs
            };

            const response = await apiFetch('/api/v1/predictions/batch', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            setResults(data.predictions || [data]);

        } catch (error) {
            console.error("Inference Engine Offline:", error);
            setResults(gridData.map(() => ({ prediction: 'ERR', confidence: 0 })));
        } finally {
            setIsPredicting(false);
        }
    };

    // --- ANIMATED METRIC GAUGE ---
    const AnimatedGauge = ({ value, label, isR2 = false }: { value: number, label: string, isR2?: boolean }) => {
        const motionVal = useMotionValue(0);
        const springVal = useSpring(motionVal, { duration: 1500, bounce: 0 });

        // Transform the raw spring value to a formatted string. 
        const displayValue = useTransform(springVal, (v) => isR2 ? v.toFixed(3) : `${Math.round(v)}%`) as any;

        const strokeColor = useTransform(springVal, (v) => {
            const normalized = isR2 ? v * 100 : v;
            if (normalized > 80) return '#4ade80'; // Green
            if (normalized > 50) return '#facc15'; // Yellow
            return '#f87171'; // Red
        });

        const circumference = 2 * Math.PI * 20;
        const strokeDashoffset = useTransform(springVal, (v) => {
            // If it's an R2 score (0.615), we use it directly as the fraction.
            // If it's an Accuracy score (86), we divide by 100 to get 0.86.
            const fillFraction = isR2 ? Math.max(0, v) : v / 100;
            return circumference - (fillFraction * circumference);
        });

        useEffect(() => {
            motionVal.set(isR2 ? value : value * 100);
        }, [value, isR2, motionVal]);

        // Helper function to get text AND color based on the final value
        const getPerformanceDetails = (score: number) => {
            // The raw score from the backend is a decimal (e.g., 1.0 or 0.615)
            // We MUST multiply it by 100 before comparing it to our 85/65 thresholds!
            const percentage = score * 100;
            if (percentage >= 80) return { text: "Strong", color: "text-green-400" };
            if (percentage >= 50) return { text: "Moderate", color: "text-yellow-400" };
            return { text: "Poor", color: "text-red-400" };
        };

        const perfDetails = getPerformanceDetails(value);

        return (
            <div className="flex flex-col items-center justify-center space-y-2">
                <div className="relative h-14 w-14 flex items-center justify-center">
                    <svg className="transform -rotate-90 w-14 h-14">
                        <circle cx="28" cy="28" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/10" />
                        <motion.circle
                            cx="28" cy="28" r="20" strokeWidth="4" fill="transparent"
                            strokeDasharray={circumference}
                            style={{ strokeDashoffset, stroke: strokeColor }}
                            strokeLinecap="round"
                            animate={{ opacity: [1, 0.85, 1] }}
                            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                        />
                    </svg>
                    <motion.span className="absolute text-xs font-mono font-medium">{displayValue}</motion.span>
                </div>
                <div className="text-center">
                    <span className="block text-[10px] text-muted uppercase tracking-wider">{label}</span>
                    <span className={`block text-[9px] font-medium mt-0.5 ${perfDetails.color}`}>
                        {perfDetails.text}
                    </span>
                </div>
            </div>
        );
    };

    if (isLoadingModel) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
        );
    }

    const metrics = model?.metrics || {};
    const features = metrics.feature_columns || [];

    return (
        <div className="min-h-screen bg-background font-sans text-primary p-6 sm:p-12 flex flex-col h-screen">
            {/* Top Nav */}
            <nav className="flex items-center justify-between mb-8 border-b border-white/10 pb-6 shrink-0">
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
                <button
                    onClick={handlePredict}
                    disabled={isPredicting}
                    className="flex items-center space-x-2 rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-50 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                >
                    <Play className={`h-4 w-4 ${isPredicting ? 'animate-pulse' : ''}`} fill="currentColor" />
                    <span>{isPredicting ? 'Computing...' : 'Run Tensor Graph'}</span>
                </button>
            </nav>

            {/* Model Intelligence Header */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 shrink-0">
                <div className="col-span-1 lg:col-span-1 bg-surface/20 border border-white/10 rounded-2xl p-6 flex flex-col">
                    <div className="flex items-center space-x-2 mb-6">
                        <Activity className="h-4 w-4 text-accent" />
                        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Model Performance</h2>
                    </div>
                    <div className="flex items-center justify-around flex-1">
                        {metrics.task_type === 'classification' ? (
                            <>
                                <AnimatedGauge value={metrics.accuracy || 0} label="Accuracy" />
                                <AnimatedGauge value={metrics.f1_score || 0} label="F1 Score" />
                            </>
                        ) : (
                            <AnimatedGauge value={metrics.r2_score || 0} label="R² Score" isR2={true} />
                        )}
                    </div>
                </div>

                <div className="col-span-1 lg:col-span-2 bg-surface/20 border border-white/10 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                            <ShieldCheck className="h-4 w-4 text-green-400" />
                            <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Schema Fingerprint</h2>
                        </div>
                        <span className="text-xs text-muted">{features.length} Features Detected</span>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                        {features.map((f: string) => (
                            <div key={f} className="flex items-center space-x-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-md text-xs">
                                <span className="font-medium text-white/80">{f}</span>
                                <span className="text-muted/50">|</span>
                                <span className="text-muted font-mono">
                                    {schema[f]?.type === 'continuous' ? `Num (${schema[f].min} - ${schema[f].max})` : `Cat (${schema[f]?.options?.length})`}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* THE SMART TENSOR GRID */}
            <div className="flex-1 flex flex-col bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative">
                <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between shrink-0">
                    <div className="flex items-center space-x-2">
                        <Database className="h-4 w-4 text-muted" />
                        <h2 className="text-sm font-medium text-white tracking-wide">Inference Matrix</h2>
                    </div>
                    <div className="flex items-center space-x-4">
                        <span className="hidden md:flex items-center space-x-1 text-xs text-muted/60">
                            <ClipboardPaste className="h-3 w-3" />
                            <span>⌘V to paste TSV/CSV</span>
                        </span>
                        <button onClick={addRow} className="flex items-center space-x-1 text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                            <Plus className="h-3 w-3" />
                            <span>Add Row</span>
                        </button>
                    </div>
                </div>

                {/* Table Container - Attached Paste Listener Here */}
                <div className="flex-1 overflow-auto custom-scrollbar" onPaste={handlePaste} tabIndex={0}>
                    <table className="w-full text-left text-sm whitespace-nowrap table-fixed">
                        <thead className="bg-surface/80 border-b border-white/10 text-muted uppercase tracking-wider text-[10px] sticky top-0 z-30 backdrop-blur-md">
                            <tr>
                                <th className="px-2 py-3 w-12 text-center sticky left-0 z-40 bg-surface/80 backdrop-blur-md border-r border-white/5">#</th>
                                {features.map((f: string) => (
                                    <th key={f} className="px-4 py-3 font-medium min-w-[140px] truncate" title={f}>{f}</th>
                                ))}
                                <th className="px-4 py-3 font-medium border-l border-white/10 bg-accent/5 text-accent sticky right-0 z-40 w-32">Output</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                            <AnimatePresence>
                                {gridData.map((row, rIndex) => (
                                    <motion.tr
                                        key={row._id}
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, x: -20, scaleY: 0 }}
                                        className="hover:bg-white/[0.02] transition-colors group"
                                    >
                                        <td className="w-12 sticky left-0 z-20 bg-[#0a0a0a] group-hover:bg-[#111] border-r border-white/5 transition-colors">
                                            <div className="flex items-center justify-center h-full w-full">
                                                <span className="text-muted/40 text-xs font-mono group-hover:hidden">
                                                    {rIndex + 1}
                                                </span>
                                                <button
                                                    onClick={() => deleteRow(rIndex)}
                                                    disabled={gridData.length <= 1}
                                                    className="hidden group-hover:flex p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors disabled:opacity-30 disabled:hover:text-muted disabled:hover:bg-transparent"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </td>

                                        {features.map((f: string) => (
                                            <td key={f} className="px-2 py-3 relative focus-within:z-10">
                                                {schema[f]?.type === 'categorical' ? (
                                                    <select
                                                        value={row[f]}
                                                        onChange={(e) => handleCellChange(rIndex, f, e.target.value)}
                                                        className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-accent focus:bg-surface focus:ring-1 focus:ring-accent/30 focus:shadow-xl rounded px-2 py-1.5 outline-none appearance-none cursor-pointer text-white/90 transition-all truncate"
                                                    >
                                                        {schema[f].options.map((opt: any) => (
                                                            <option key={opt} value={opt} className="bg-surface text-primary">{opt}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        value={row[f]}
                                                        onChange={(e) => handleCellChange(rIndex, f, e.target.value)}
                                                        placeholder={String(schema[f]?.median)}
                                                        className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-accent focus:bg-surface focus:ring-1 focus:ring-accent/30 focus:shadow-xl rounded px-2 py-1.5 outline-none text-white/90 font-mono placeholder:text-white/20 transition-all"
                                                    />
                                                )}
                                            </td>
                                        ))}

                                        <td className="px-4 py-3 border-l border-white/10 sticky right-0 bg-[#0a0a0a] group-hover:bg-[#111] z-20">
                                            {isPredicting ? (
                                                <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                                            ) : results[rIndex] ? (
                                                <div className="flex items-center space-x-2">
                                                    <span className="font-bold text-white truncate max-w-[80px]" title={String(results[rIndex].prediction || results[rIndex].result)}>
                                                        {String(results[rIndex].prediction || results[rIndex].result)}
                                                    </span>
                                                    {results[rIndex].probabilities && (
                                                        <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded">
                                                            {(Math.max(...results[rIndex].probabilities) * 100).toFixed(1)}%
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-muted/30 text-xs italic">Awaiting...</span>
                                            )}
                                        </td>
                                    </motion.tr>
                                ))}
                            </AnimatePresence>

                            <tr>
                                <td colSpan={features.length + 2} className="p-8">
                                    <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-white/5 rounded-xl py-8 bg-white/[0.01]">
                                        <ClipboardPaste className="h-6 w-6 text-muted/30 mb-2" />
                                        <p className="text-sm text-muted/50 font-medium">Click anywhere in the grid and press <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/70">⌘ V</kbd> to paste rows</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <AnimatePresence>
                    {toastMsg && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-2 rounded-full text-sm font-medium flex items-center shadow-lg backdrop-blur-md z-50"
                        >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {toastMsg}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}