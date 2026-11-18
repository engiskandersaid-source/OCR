import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { ChatWidget } from "@/components/ChatWidget";
import { getSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** Layouts do not re-run on client navigation, so every page below checks access too. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AuthProvider user={session.user}>
      {children}
      {!session.user.mustChangePassword && <ChatWidget />}
    </AuthProvider>
  );
}
