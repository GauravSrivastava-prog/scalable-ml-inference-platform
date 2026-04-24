import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Plus, Search, Activity, Box, Clock, List, UploadCloud, X, Trash2, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';
import { User } from 'lucide-react';

interface BackendModel {
    id: string;
    name: string;
    version: number;
    algorithm: string;
    status: string;
    metrics: {
        accuracy?: number;
        f1_score?: number;
        feature_columns?: string[];
    } | null;
    created_at: string;
}

export default function Studio() {
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [view] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [models, setModels] = useState<BackendModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // const [error, setError] = useState<string | null>(null);

    // --- MODAL STATE ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalStep, setModalStep] = useState<'upload' | 'train'>('upload');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [datasetId, setDatasetId] = useState<string | null>(null);
    const [modelName, setModelName] = useState('');
    const [targetColumn, setTargetColumn] = useState('');
    const [algorithm, setAlgorithm] = useState('random_forest');
    const [isProcessing, setIsProcessing] = useState(false);

    // Fetch Models
    const fetchModels = async () => {
        try {
            setIsLoading(true);
            const res = await apiFetch('/api/v1/models/');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setModels(data);
        } catch (err) {
            console.error("Failed to fetch models:", err);
            // setError('Failed to load models from the cluster.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchModels();
    }, []);

    const handleDeleteModel = async (e: React.MouseEvent, modelId: string) => {
        e.stopPropagation();

        if (!window.confirm("Are you sure you want to delete this model? This action cannot be undone.")) {
            return;
        }

        try {
            const res = await apiFetch(`/api/v1/models/${modelId}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                setModels(prevModels => prevModels.filter(m => m.id !== modelId));
            } else {
                console.error("Failed to delete model");
            }
        } catch (error) {
            console.error("Error deleting model:", error);
        }
    };

    // --- PIPELINE LOGIC ---
    const handleFileUpload = async () => {
        if (!selectedFile) return;
        setIsProcessing(true);

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            const response = await apiFetch('/api/v1/models/upload-dataset', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Upload failed');
            }

            const data = await response.json();
            setDatasetId(data.dataset_id);
            setModalStep('train');
        } catch (err: any) {
            console.error("Upload Error:", err);
            alert(`Upload Failed: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleTrainModel = async () => {
        if (!datasetId || !modelName || !targetColumn) return;
        setIsProcessing(true);

        try {
            const payload = {
                name: modelName,
                dataset_id: datasetId,
                algorithm: algorithm,
                target_column: targetColumn
            };

            const response = await apiFetch('/api/v1/models/train', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            // ✅ PROFESSIONAL POLISH: Catch the exact backend detail
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Training failed due to invalid parameters.');
            }

            setIsModalOpen(false);
            setModalStep('upload');
            setSelectedFile(null);
            setModelName('');
            setTargetColumn('');
            setAlgorithm('random_forest');

            await fetchModels();

        } catch (err: any) {
            console.error("Training Pipeline Error:", err);
            // ✅ PROFESSIONAL POLISH: Display the exact backend reasoning to the user
            alert(`Training Error: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const filteredModels = models.filter(model =>
        model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.algorithm.toLowerCase().replace('_', ' ').includes(searchQuery.toLowerCase())
    );

    return (
        // ✅ CHANGED: Root div is now bg-transparent and relative z-10
        <div className="min-h-screen bg-transparent font-sans text-primary flex relative z-10">

            {/* --- PIPELINE MODAL --- */}
            <AnimatePresence>
                {isModalOpen && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
                            className="bg-surface border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                        >
                            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                                <h3 className="font-medium text-white">Create New Pipeline</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-muted hover:text-white p-1 rounded-md transition-colors">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="p-6">
                                {modalStep === 'upload' ? (
                                    <div className="space-y-4">
                                        <p className="text-sm text-muted">Step 1: Upload your raw CSV dataset.</p>

                                        <label className="border-2 border-dashed border-white/10 hover:border-accent/50 rounded-xl p-8 flex flex-col items-center justify-center bg-white/[0.02] hover:bg-white/[0.04] text-center cursor-pointer transition-all group relative">
                                            <input
                                                type="file"
                                                accept=".csv"
                                                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                                className="hidden"
                                            />

                                            {selectedFile ? (
                                                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
                                                    <div className="p-3 bg-green-500/10 text-green-400 rounded-full mb-3">
                                                        <CheckCircle2 className="h-6 w-6" />
                                                    </div>
                                                    <p className="text-sm font-medium text-white truncate max-w-[200px]">{selectedFile.name}</p>
                                                    <p className="text-xs text-muted mt-1">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                                    <p className="text-[10px] text-accent mt-4 opacity-0 group-hover:opacity-100 transition-opacity">Click to change file</p>
                                                </motion.div>
                                            ) : (
                                                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
                                                    <div className="p-3 bg-white/5 group-hover:bg-accent/10 text-muted group-hover:text-accent rounded-full mb-3 transition-colors">
                                                        <UploadCloud className="h-6 w-6" />
                                                    </div>
                                                    <p className="text-sm font-medium text-white mb-1">Click to browse files</p>
                                                    <p className="text-xs text-muted">CSV files only</p>
                                                </motion.div>
                                            )}
                                        </label>

                                        <button
                                            onClick={handleFileUpload}
                                            disabled={!selectedFile || isProcessing}
                                            className="w-full bg-accent hover:bg-accent/90 text-white font-medium py-2.5 rounded-lg transition-colors shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50 disabled:bg-white/10 disabled:shadow-none"
                                        >
                                            {isProcessing ? 'Uploading to cluster...' : 'Upload Dataset'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <p className="text-sm text-muted">Step 2: Configure Training Parameters.</p>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-xs font-medium text-muted mb-1 block">Model Name</label>
                                                <input
                                                    type="text" placeholder="e.g., Churn Predictor V4"
                                                    value={modelName} onChange={(e) => setModelName(e.target.value)}
                                                    className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-muted mb-1 block">Target Column (from CSV)</label>
                                                <input
                                                    type="text" placeholder="e.g., churn"
                                                    value={targetColumn} onChange={(e) => setTargetColumn(e.target.value)}
                                                    className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                                                />
                                            </div>

                                            <div>
                                                <label className="text-xs font-medium text-muted mb-1 block">Algorithm</label>
                                                <div className="relative">
                                                    <select
                                                        value={algorithm}
                                                        onChange={(e) => setAlgorithm(e.target.value)}
                                                        className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                                                    >
                                                        <option value="random_forest">Random Forest</option>
                                                        <option value="xgboost">XGBoost</option>
                                                        <option value="logistic_regression">Logistic Regression</option>
                                                        <option value="decision_tree">Decision Tree</option>
                                                    </select>
                                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted">
                                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </div>
                                                </div>
                                            </div>

                                        </div>
                                        <button
                                            onClick={handleTrainModel}
                                            disabled={!modelName || !targetColumn || isProcessing}
                                            className="w-full bg-accent hover:bg-accent/90 text-white font-medium py-2.5 rounded-lg transition-colors shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50"
                                        >
                                            {isProcessing ? 'Training Model...' : 'Initialize Training Pipeline'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ✅ CHANGED: Sidebar is now frosted glass (bg-black/40 backdrop-blur-md) */}
            <aside className="w-64 border-r border-white/10 bg-black/40 backdrop-blur-md hidden md:flex flex-col">
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center space-x-3">
                        <Database className="h-6 w-6 text-accent" />
                        <span className="text-lg font-medium tracking-wide">Inference<span className="font-light text-muted">Studio</span></span>
                    </div>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <button className="w-full flex items-center space-x-3 px-4 py-3 bg-white/5 rounded-lg text-sm font-medium text-white transition-colors">
                        <Box className="h-4 w-4" />
                        <span>Deployed Models</span>
                    </button>
                    <button onClick={() => navigate('/pulse')} className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-white/5 rounded-lg text-sm font-medium text-muted hover:text-white transition-colors">
                        <Activity className="h-4 w-4" />
                        <span>System Pulse</span>
                    </button>
                    <button onClick={() => navigate('/history')} className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-white/5 rounded-lg text-sm font-medium text-muted hover:text-white transition-colors">
                        <List className="h-4 w-4" />
                        <span>Prediction Ledger</span>
                    </button>
                    <button
                        onClick={() => navigate('/profile')}
                        className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-white/5 rounded-lg text-sm font-medium text-muted hover:text-white transition-colors"
                    >
                        <User className="h-4 w-4" />
                        <span>My Profile</span>
                    </button>
                </nav>
                <div className="p-4 border-t border-white/10">
                    <button onClick={logout} className="w-full text-left px-4 py-2 text-sm text-muted hover:text-white transition-colors">
                        Disconnect Session
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden">
                {/* ✅ CHANGED: Header is now frosted glass (bg-black/40 backdrop-blur-md) */}
                <header className="h-20 border-b border-white/10 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md z-10">
                    <div>
                        <h1 className="text-xl font-medium">Model Registry</h1>
                        <p className="text-xs text-muted mt-1">Manage and monitor active endpoints</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                            <input
                                type="text"
                                placeholder="Search models..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-64 bg-surface/50 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-white/30 transition-all"
                            />
                        </div>

                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="flex items-center space-x-2 bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                        >
                            <Plus className="h-4 w-4" />
                            <span>New Pipeline</span>
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8">
                    {isLoading && (
                        <div className="flex justify-center items-center h-64">
                            <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                        </div>
                    )}

                    {!isLoading && models.length > 0 && filteredModels.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-center">
                            <Search className="h-8 w-8 text-muted/30 mb-3" />
                            <p className="text-muted">No models found matching "{searchQuery}"</p>
                        </div>
                    )}

                    {!isLoading && filteredModels.length > 0 && (
                        <div className={`grid gap-6 ${view === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
                            {filteredModels.map((model) => (
                                <motion.div
                                    key={model.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    whileHover={{ y: -2 }}
                                    onClick={() => navigate(`/model/${model.id}`, { state: { model } })}
                                    className="group relative flex flex-col bg-surface/30 border border-white/10 rounded-2xl p-6 hover:bg-surface/50 hover:border-white/20 transition-all cursor-pointer overflow-hidden"
                                >
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/5 to-transparent group-hover:via-accent/50 transition-all" />

                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-lg font-medium text-white/90 group-hover:text-white transition-colors">{model.name}</h3>
                                            <div className="flex items-center space-x-2 mt-1 text-xs text-muted">
                                                <span className="font-mono bg-white/5 px-2 py-0.5 rounded-md">v{model.version}</span>
                                                <span>•</span>
                                                <span className="capitalize">{model.algorithm.replace('_', ' ')}</span>
                                            </div>
                                        </div>

                                        <button
                                            onClick={(e) => handleDeleteModel(e, model.id)}
                                            className="p-2 text-muted hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors z-10"
                                            title="Delete Model"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mt-auto pt-6 border-t border-white/5">
                                        <div>
                                            <p className="text-xs text-muted mb-1 flex items-center"><Activity className="h-3 w-3 mr-1" /> Status</p>
                                            <p className="text-sm font-medium flex items-center space-x-2">
                                                <span className={`h-2 w-2 rounded-full ${model.status === 'ready' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-yellow-500'}`} />
                                                <span className="capitalize">{model.status}</span>
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted mb-1 flex items-center"><Clock className="h-3 w-3 mr-1" /> Created</p>
                                            <p className="text-sm font-medium">{new Date(model.created_at).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}