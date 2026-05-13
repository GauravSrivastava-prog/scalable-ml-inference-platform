import { useEffect } from 'react';

export function usePrewarmCluster() {
    useEffect(() => {
        const urls = [
            'https://ml-auth-service.onrender.com/docs',
            'https://scalable-ml-inference-platform.onrender.com/docs',
            'https://ml-prediction-service-m7xo.onrender.com/docs'
        ];

        // Fire silent no-cors requests to wake up the containers
        urls.forEach(url => {
            fetch(url, { method: 'HEAD', mode: 'no-cors' }).catch(() => { });
        });
    }, []); // Empty dependency array = runs exactly once when Landing Page mounts
}