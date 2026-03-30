import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Auth from './Auth';
import Studio from './Studio';
import Canvas from './Canvas';
import Pulse from './Pulse';
import History from './History';

// 1. Create the Bouncer Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  // FIX: Make sure this exactly matches what your AuthContext saves!
  const token = localStorage.getItem('access_token');

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    // Move BrowserRouter to the very outside!
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Route */}
          <Route path="/" element={<Auth />} />

          {/* Protected Routes */}
          <Route
            path="/studio"
            element={<ProtectedRoute><Studio /></ProtectedRoute>}
          />
          <Route
            path="/model/:id"
            element={<ProtectedRoute><Canvas /></ProtectedRoute>}
          />
          <Route
            path="/pulse"
            element={<ProtectedRoute><Pulse /></ProtectedRoute>}
          />
          {/* THE NEW ROUTE MUST BE INSIDE THE <Routes> TAG! */}
          <Route
            path="/history"
            element={<ProtectedRoute><History /></ProtectedRoute>}
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}