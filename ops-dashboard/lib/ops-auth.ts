import { loadOpsEnv } from "./env";
import type { OpsActor, OpsActorRole, OpsPermission } from "./types";

const ROLE_PERMISSIONS: Record<OpsActorRole, OpsPermission[]> = {
  viewer: ["read.ops"],
  analyst: ["read.ops", "run.research_gate", "apply.ui_command"],
  operator: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "transition.action"],
  approver: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "approve.action", "transition.action"],
  admin: ["read.ops", "run.research_gate", "apply.ui_command", "record.action", "approve.action", "transition.action", "refresh.ingest"],
};

type RbacPolicy = {
  defaultRole?: OpsActorRole;
  users?: Record<string, OpsActorRole | { role?: OpsActorRole; permissions?: OpsPermission[] }>;
};

function isRole(value: unknown): value is OpsActorRole {
  return value === "viewer" || value === "analyst" || value === "operator" || value === "approver" || value === "admin";
}

function decodeBasicAuth(request: Request): { username: string; password: string } | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function readPolicy(): RbacPolicy {
  loadOpsEnv();
  const raw = process.env.OPS_RBAC_POLICY_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as RbacPolicy;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function roleForUser(username: string): { role: OpsActorRole; extraPermissions: OpsPermission[] } {
  const policy = readPolicy();
  const entry = policy.users?.[username];
  if (typeof entry === "string" && isRole(entry)) return { role: entry, extraPermissions: [] };
  if (entry && typeof entry === "object" && isRole(entry.role)) {
    const extraPermissions = Array.isArray(entry.permissions)
      ? entry.permissions.filter((item): item is OpsPermission => typeof item === "string" && item.includes("."))
      : [];
    return { role: entry.role, extraPermissions };
  }
  if (isRole(policy.defaultRole)) return { role: policy.defaultRole, extraPermissions: [] };
  return { role: username === process.env.OPS_DASHBOARD_BASIC_AUTH_USER ? "admin" : "viewer", extraPermissions: [] };
}

export function getOpsActor(request: Request): OpsActor {
  loadOpsEnv();
  const basic = decodeBasicAuth(request);
  const expectedUser = process.env.OPS_DASHBOARD_BASIC_AUTH_USER;
  const expectedPassword = process.env.OPS_DASHBOARD_BASIC_AUTH_PASSWORD;

  if (basic && expectedUser && expectedPassword && basic.username === expectedUser && basic.password === expectedPassword) {
    const { role, extraPermissions } = roleForUser(basic.username);
    return {
      id: `ops:${basic.username}`,
      username: basic.username,
      role,
      permissions: [...new Set([...ROLE_PERMISSIONS[role], ...extraPermissions])],
      authSource: "basic",
    };
  }

  if (process.env.NODE_ENV !== "production" || process.env.OPS_DASHBOARD_AUTH_DISABLED === "true") {
    return {
      id: "ops:local-dev",
      username: "local-dev",
      role: "admin",
      permissions: ROLE_PERMISSIONS.admin,
      authSource: "local_dev",
    };
  }

  return {
    id: "ops:anonymous",
    username: "anonymous",
    role: "viewer",
    permissions: ROLE_PERMISSIONS.viewer,
    authSource: "system",
  };
}

export function hasOpsPermission(actor: OpsActor, permission: OpsPermission): boolean {
  return actor.permissions.includes(permission);
}

export function requireOpsPermission(actor: OpsActor, permission: OpsPermission): void {
  if (!hasOpsPermission(actor, permission)) {
    throw new Error(`Actor ${actor.username} lacks ${permission}`);
  }
}
