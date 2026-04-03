import React from 'react';
import { motion } from 'framer-motion';
import type { Transition } from 'framer-motion'; // <-- The exact fix

// 1. Define the 3D "Depth of Field" animation states
const pageVariants = {
    initial: {
        opacity: 0,
        scale: 0.96,
        filter: "blur(10px)",
        y: 15
    },
    in: {
        opacity: 1,
        scale: 1,
        filter: "blur(0px)",
        y: 0
    },
    out: {
        opacity: 0,
        scale: 1.04,
        filter: "blur(10px)",
        y: -15
    }
};

// 2. Explicitly tell TypeScript this is a Framer Motion Transition
const pageTransition: Transition = {
    duration: 0.5,
    ease: [0.22, 1, 0.36, 1]
};

export default function PageTransition({ children }: { children: React.ReactNode }) {
    return (
        <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
            className="w-full h-full flex flex-col origin-center"
        >
            {children}
        </motion.div>
    );
}