import { useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import Particles from "react-tsparticles";
import { loadSlim } from "tsparticles-slim";
import type { Engine, ISourceOptions } from "tsparticles-engine";
import { ROUTES } from "./routes";

export default function GlobalBackground() {
    const location = useLocation();

    // KILL-SWITCH: The Landing Page owns its own 3D Canvas on pure black.
    // Returning null fully unmounts the tsparticles canvas, freeing CPU/GPU
    // resources for the Three.js scene.
    if (location.pathname === ROUTES.LANDING) {
        return null;
    }

    const isAuthPage = location.pathname === ROUTES.LOGIN;

    const particlesInit = useCallback(async (engine: Engine) => {
        await loadSlim(engine);
    }, []);

    const options: ISourceOptions = useMemo(() => {
        if (isAuthPage) {
            return {
                background: { color: "#050505" },
                fpsLimit: 60,
                particles: {
                    color: { value: "#3b82f6" },
                    links: { color: "#3b82f6", distance: 150, enable: true, opacity: 0.3, width: 1 },
                    move: { enable: true, direction: "none", speed: 0.8, outModes: "bounce" },
                    number: { value: 60, density: { enable: true, area: 800 } },
                    opacity: { value: 0.5 },
                    size: { value: { min: 1, max: 3 } },
                },
                interactivity: {
                    events: { onHover: { enable: true, mode: "grab" } },
                    modes: { grab: { distance: 200, links: { opacity: 0.5 } } },
                },
            };
        } else {
            return {
                background: { color: "#050505" },
                fpsLimit: 60,
                particles: {
                    color: { value: "#ffffff" },
                    links: { color: "#ffffff", distance: 250, enable: true, opacity: 0.03, width: 1 },
                    move: { enable: true, direction: "none", speed: 0.1, outModes: "out" },
                    number: { value: 25, density: { enable: true, area: 800 } },
                    opacity: { value: { min: 0.1, max: 0.3 }, animation: { enable: true, speed: 0.5, minimumValue: 0.1 } },
                    shape: { type: "circle" },
                    size: { value: { min: 1, max: 2 } },
                },
                interactivity: { events: { onHover: { enable: false } } },
            };
        }
    }, [isAuthPage]);

    return (
        <div className="fixed inset-0 z-[-1] pointer-events-none">
            <Particles id="tsparticles" init={particlesInit} options={options} className="absolute inset-0" />
        </div>
    );
}