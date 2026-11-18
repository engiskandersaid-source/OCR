"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/types";

const AuthCtx = createContext<SessionUser | null>(null);

/** For display only: the server enforces every permission on its own. */
export function AuthProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const user = useContext(AuthCtx);
  if (!user) throw new Error("useAuth must be used inside AuthProvider");
  return user;
}
