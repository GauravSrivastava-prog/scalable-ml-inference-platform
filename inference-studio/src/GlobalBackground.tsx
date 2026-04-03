import { useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import Particles from "react-tsparticles";
import { loadSlim } from "tsparticles-slim";
import type { Engine, ISourceOptions } from "tsparticles-engine";

export default function GlobalBackground() {
    const location = useLocation();
    const isAuthPage = location.pathname === "/";

    const particlesInit = useCallback(async (engine: Engine) => {
        await loadSlim(engine);
    }, []);

    const options: ISourceOptions = useMemo(() => {
        if (isAuthPage) {
            // STATE 1: THE ORGANIC BRAIN (Auth Page) - Unchanged
            return {
                background: { color: "#050505" },
                fpsLimit: 60,
                particles: {
                    color: { value: "#3b82f6" },
                    links: {
                        color: "#3b82f6",
                        distance: 150,
                        enable: true,
                        opacity: 0.3,
                        width: 1,
                    },
                    move: {
                        enable: true,
                        direction: "none",
                        speed: 0.8,
                        outModes: "bounce",
                    },
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
            // STATE 2: THE AMBIENT CONSTELLATION (Studio Page) - Completely Redesigned
            return {
                background: { color: "#050505" },
                fpsLimit: 60,
                particles: {
                    color: { value: "#ffffff" }, // Clean, stark white/grey
                    links: {
                        color: "#ffffff",
                        distance: 250, // Very long reach to create a large, sparse grid
                        enable: true,
                        opacity: 0.03, // EXTREMELY faint lines so they don't distract
                        width: 1,
                    },
                    move: {
                        enable: true,
                        direction: "none",
                        speed: 0.1, // Barely moving, almost static
                        outModes: "out",
                    },
                    // Drastically reduced node count (from 120 down to just 25)
                    number: { value: 25, density: { enable: true, area: 800 } },
                    opacity: {
                        value: { min: 0.1, max: 0.3 }, // Nodes stay very dim
                        animation: { enable: true, speed: 0.5, minimumValue: 0.1 } // Slow breathing opacity
                    },
                    shape: { type: "circle" },
                    size: { value: { min: 1, max: 2 } },
                },
                interactivity: {
                    events: { onHover: { enable: false } }, // Turn off hover to keep the dashboard usable
                },
            };
        }
    }, [isAuthPage]);

    return (
        <div className="fixed inset-0 z-[-1] pointer-events-none">
            <Particles
                id="tsparticles"
                init={particlesInit}
                options={options}
                className="absolute inset-0"
            />
        </div>
    );
}