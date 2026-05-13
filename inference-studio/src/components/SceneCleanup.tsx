import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

export function SceneCleanup() {
    const { gl, scene } = useThree();

    useEffect(() => {
        return () => {
            // Traverse and dispose all 3D geometries and materials on unmount
            scene.traverse((object: any) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((m: any) => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
            // Kill the WebGL context to free up GPU memory
            gl.dispose();
            gl.forceContextLoss();
        };
    }, [gl, scene]);

    return null;
}