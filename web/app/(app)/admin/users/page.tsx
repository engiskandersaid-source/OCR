import { UsersAdmin } from "@/components/UsersAdmin";
import { requirePageAdmin } from "@/lib/auth/guard";
import { listUsers } from "@/lib/users";

export default async function UsersPage() {
  await requirePageAdmin();
  return <UsersAdmin initialUsers={listUsers()} />;
}
