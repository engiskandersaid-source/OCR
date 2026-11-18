"use client";

import { motion } from "framer-motion";

/** Decorative gradient blobs shared by every screen. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <motion.div
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-indigo-400/30 blur-3xl"
      />
      <motion.div
        animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-24 top-10 size-[24rem] rounded-full bg-cyan-400/25 blur-3xl"
      />
      <div className="absolute left-1/3 top-80 size-[20rem] rounded-full bg-fuchsia-400/15 blur-3xl" />
    </div>
  );
}
