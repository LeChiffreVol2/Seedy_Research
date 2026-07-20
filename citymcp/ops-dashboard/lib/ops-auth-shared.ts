import type { OpsActorRole, OpsPermission } from "./types";

export const ROLE_PERMISSIONS: Record<OpsActorRole, OpsPermission[]> = {
  viewer: ["read.ops"],
  analyst: ["read.ops", "run.research_gate", "apply.ui_command"],
  operator: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "transition.action"],
  approver: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "approve.action", "transition.action"],
  admin: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "approve.action", "transition.action", "refresh.ingest"],
};

type RbacPolicy = {
  defaultRole?: OpsActorRole;
  users?: Record<string, OpsActorRole | { role?: OpsActorRole; password?: string; permissions?: OpsPermission[] }>;
};

export type ResolvedOpsAuth = {
  username: string;
  role: OpsActorRole;
  permissions: OpsPermission[];
} | null;

function isRole(value: unknown): value is OpsActorRole {
  return value === "viewer" || value === "analyst" || value === "operator" || value === "approver" || value === "admin";
}

function readPolicy(): RbacPolicy {
  const raw = process.env.OPS_RBAC_POLICY_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as RbacPolicy;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveOpsBasicAuth(username: string, password: string): ResolvedOpsAuth {
  const policy = readPolicy();
  const entry = policy.users?.[username];
  if (entry && typeof entry === "object" && isRole(entry.role) && entry.password && password === entry.password) {
    const extraPermissions = Array.isArray(entry.permissions)
      ? entry.permissions.filter((item): item is OpsPermission => typeof item === "string" && item.includes("."))
      : [];
    return {
      username,
      role: entry.role,
      permissions: [...new Set([...ROLE_PERMISSIONS[entry.role], ...extraPermissions])],
    };
  }

  const legacyUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
  const legacyPassword = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;
  const legacyMatch = Boolean(legacyUser && legacyPassword && username === legacyUser && password === legacyPassword);
  if (legacyMatch && isRole(entry)) {
    return { username, role: entry, permissions: ROLE_PERMISSIONS[entry] };
  }
  if (legacyMatch && entry && typeof entry === "object" && isRole(entry.role) && !entry.password) {
    const extraPermissions = Array.isArray(entry.permissions)
      ? entry.permissions.filter((item): item is OpsPermission => typeof item === "string" && item.includes("."))
      : [];
    return {
      username,
      role: entry.role,
      permissions: [...new Set([...ROLE_PERMISSIONS[entry.role], ...extraPermissions])],
    };
  }
  if (legacyMatch) {
    const role = isRole(policy.defaultRole) ? policy.defaultRole : "viewer";
    return { username, role, permissions: ROLE_PERMISSIONS[role] };
  }

  return null;
}
