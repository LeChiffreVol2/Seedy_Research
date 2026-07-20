import { loadOpsEnv } from "./env";
import { resolveOpsBasicAuth, ROLE_PERMISSIONS } from "./ops-auth-shared";
import type { OpsActor, OpsPermission } from "./types";

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

export function getOpsActor(request: Request): OpsActor {
  loadOpsEnv();
  const basic = decodeBasicAuth(request);
  const resolved = basic ? resolveOpsBasicAuth(basic.username, basic.password) : null;
  if (resolved) {
    return {
      id: `ops:${resolved.username}`,
      username: resolved.username,
      role: resolved.role,
      permissions: resolved.permissions,
      authSource: "basic",
    };
  }

  if (process.env.NODE_ENV !== "production" && process.env.OPS_DASHBOARD_AUTH_DISABLED === "true") {
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
    permissions: [],
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
