const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";
const AUTH_BASE = API_BASE;
const MODEL_BASE = API_BASE;
const PREDICT_BASE = API_BASE;

function getBaseUrl(endpoint: string): string {
    if (endpoint.startsWith('/api/v1/auth')) return AUTH_BASE;
    if (endpoint.startsWith('/api/v1/models')) return MODEL_BASE;
    if (endpoint.startsWith('/api/v1/predictions') || endpoint.includes('batch')) return PREDICT_BASE;

    return AUTH_BASE;
}

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem("access_token");
    const headers = new Headers(options.headers || {});

    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${getBaseUrl(endpoint)}${endpoint}`, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        localStorage.removeItem("access_token");
        window.location.href = '/login';
    }

    return response;
}