import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Plus, Search, Activity, Box, Clock, MoreVertical, LayoutGrid, List, UploadCloud, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';
import { useAuth } from './AuthContext';

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
    const [view, setView] = useState<'grid' | 'list'>('grid');

    const [models, setModels] = useState<BackendModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // --- MODAL STATE ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalStep, setModalStep] = useState<'upload' | 'train'>('upload');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [datasetId, setDatasetId] = useState<string | null>(null);
    const [modelName, setModelName] = useState('');
    const [targetColumn, setTargetColumn] = useState('');
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
            setError('Failed to load models from the cluster.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchModels();
    }, []);

    // --- PIPELINE LOGIC ---
    const handleFileUpload = async () => {
        if (!selectedFile) return;
        setIsProcessing(true);

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            // FIX: Explicitly grab 'access_token' instead of 'token'
            const token = localStorage.getItem('access_token');
            if (!token) throw new Error("No access token found in browser storage.");

            const response = await fetch('http://localhost:9000/api/v1/models/upload-dataset', {
                method: 'POST',
                headers: {
                    // FIX: Ensure exact Bearer formatting
                    'Authorization': `Bearer ${token}`
                },
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
                algorithm: "random_forest",
                target_column: targetColumn
            };

            const response = await apiFetch('/api/v1/models/train', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Training failed');

            // Success! Close modal, reset state, and refresh grid
            setIsModalOpen(false);
            setModalStep('upload');
            setSelectedFile(null);
            setModelName('');
            setTargetColumn('');

            await fetchModels(); // Refresh the grid to show the new model!

        } catch (err) {
            console.error(err);
            alert("Failed to train model.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-background font-sans text-primary flex relative">

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
                                        <div className="border-2 border-dashed border-white/10 rounded-xl p-8 flex flex-col items-center justify-center bg-background/50 text-center">
                                            <UploadCloud className="h-8 w-8 text-muted mb-3" />
                                            <input
                                                type="file"
                                                accept=".csv"
                                                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                                className="text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent/10 file:text-accent hover:file:bg-accent/20 cursor-pointer w-full"
                                            />
                                        </div>
                                        <button
                                            onClick={handleFileUpload}
                                            disabled={!selectedFile || isProcessing}
                                            className="w-full bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
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

            {/* Sidebar */}
            <aside className="w-64 border-r border-white/10 bg-surface/50 hidden md:flex flex-col">
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
                </nav>
                <div className="p-4 border-t border-white/10">
                    <button onClick={logout} className="w-full text-left px-4 py-2 text-sm text-muted hover:text-white transition-colors">
                        Disconnect Session
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="h-20 border-b border-white/10 flex items-center justify-between px-8 bg-background/80 backdrop-blur-md z-10">
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

                    {!isLoading && models.length > 0 && (
                        <div className={`grid gap-6 ${view === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
                            {models.map((model) => (
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