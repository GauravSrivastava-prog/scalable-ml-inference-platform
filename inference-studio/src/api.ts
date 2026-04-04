export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:9000";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem("access_token");
    const headers = new Headers(options.headers || {});

    // If we have a token, attach it like an ID badge
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    if (response.status === 401) {
        // If the token expires, kick them out
        localStorage.removeItem("access_token");
        window.location.href = '/';
    }

    return response;
}