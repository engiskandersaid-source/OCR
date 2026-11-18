import { HomeClient } from "@/components/HomeClient";
import { requirePageUser } from "@/lib/auth/guard";

export default async function HomePage() {
  await requirePageUser();
  return <HomeClient />;
}
