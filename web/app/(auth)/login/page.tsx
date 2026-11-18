import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/auth/guard";
import { hasActiveAdmin } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return <LoginForm hasAdmin={hasActiveAdmin()} />;
}
