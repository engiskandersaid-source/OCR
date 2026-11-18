"use client";

import type { ReactNode } from "react";
import { Backdrop } from "@/components/Backdrop";
import { Header } from "@/components/Header";

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Backdrop />
      <Header />
      {children}
    </div>
  );
}
