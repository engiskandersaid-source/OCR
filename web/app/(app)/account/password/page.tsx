import { PasswordForm } from "@/components/PasswordForm";
import { requirePageUser } from "@/lib/auth/guard";

export default async function PasswordPage() {
  await requirePageUser({ allowPasswordChange: true });
  return <PasswordForm />;
}
