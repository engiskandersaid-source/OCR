export type Role = "admin" | "employee";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
};

/** What the user-management screen receives. Never includes the password hash. */
export type ManagedUser = SessionUser & {
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

/** Which transfers a request may touch. Always derived from the session, never from input. */
export type TransferScope = { kind: "all" } | { kind: "owner"; userId: string };

export const scopeFor = (user: SessionUser): TransferScope =>
  user.role === "admin" ? { kind: "all" } : { kind: "owner", userId: user.id };
