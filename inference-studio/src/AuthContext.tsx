import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api';
import { toast } from 'sonner';

interface AuthContextType {
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const navigate = useNavigate();

    // Check if we already have a token when the app loads
    useEffect(() => {
        const token = localStorage.getItem('access_token');
        if (token) setIsAuthenticated(true);
    }, []);

    const login = async (email: string, password: string) => {
        try {
            // Swapped back to standard JSON as per your backend's contract!
            const response = await fetch('http://localhost:9000/api/v1/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                // If it's a 422 or 401, throw to the catch block
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            localStorage.setItem('access_token', data.access_token);
            setIsAuthenticated(true);
            return true;

        } catch (error) {
            console.error("Login failed:", error);
            toast.error("Authentication failed. Check your credentials.");
            return false;
        }
    };

    const logout = () => {
        localStorage.removeItem('access_token');
        setIsAuthenticated(false);
        navigate('/');
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
};