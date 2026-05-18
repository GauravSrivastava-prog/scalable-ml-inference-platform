import { useEffect } from 'react';

export function usePrewarmCluster() {
    useEffect(() => {
        const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
        const urls = [
            `${base}/api/v1/auth/health`,
            `${base}/api/v1/models/health`,
            `${base}/api/v1/predictions/health`
        ];

        // Fire silent no-cors requests to wake up the containers
        urls.forEach(url => {
            fetch(url, { method: 'HEAD', mode: 'no-cors' }).catch(() => { });
        });
    }, []); // Empty dependency array = runs exactly once when Landing Page mounts
}