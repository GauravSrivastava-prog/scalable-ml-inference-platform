import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from './AuthContext';
import Auth from './Auth';
import Studio from './Studio';
import Canvas from './Canvas';
import Pulse from './Pulse';
import History from './History';
import PageTransition from './PageTransition';
import GlobalBackground from './GlobalBackground'; // <-- 1. Import the new background

// 1. Create the Bouncer Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('access_token');
  if (!token) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

// 2. Extract Routes so we can use `useLocation` for animations
const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    // 'wait' ensures the old page fades out completely before the new one slides in
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* Public Route */}
        <Route
          path="/"
          element={<PageTransition><Auth /></PageTransition>}
        />

        {/* Protected Routes */}
        <Route
          path="/studio"
          element={<ProtectedRoute><PageTransition><Studio /></PageTransition></ProtectedRoute>}
        />
        <Route
          path="/model/:id"
          element={<ProtectedRoute><PageTransition><Canvas /></PageTransition></ProtectedRoute>}
        />
        <Route
          path="/pulse"
          element={<ProtectedRoute><PageTransition><Pulse /></PageTransition></ProtectedRoute>}
        />
        <Route
          path="/history"
          element={<ProtectedRoute><PageTransition><History /></PageTransition></ProtectedRoute>}
        />
      </Routes>
    </AnimatePresence>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* 2. THE SAFE ZONE:
          - It is inside BrowserRouter, so useLocation() works perfectly.
          - It is outside AnimatePresence, so it NEVER unmounts during page transitions.
        */}
        <GlobalBackground />

        <AnimatedRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}