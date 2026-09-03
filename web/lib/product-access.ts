/**
 * Research Preview access policy.
 *
 * Open Access removes commercial entitlement and answer-credit gates. Authentication
 * is a separate boundary: demo features default to signed-in access so saved research,
 * chat history, and learning progress always have a durable owner.
 */
export const CIVILMCP_OPEN_ACCESS = (process.env.CIVILMCP_OPEN_ACCESS ?? process.env.NEXT_PUBLIC_CIVILMCP_OPEN_ACCESS) !== "false";

export const CIVILMCP_OPEN_ACCESS_LABEL = "Open Access";

export type CivilMcpFeature = "explore" | "chat" | "workspace" | "notebook" | "path" | "history" | "shared" | "settings";

export type CivilMcpFeatureAccess = {
  enabled: boolean;
  requiresAuth: boolean;
  label: string;
};

function enabledFlag(value: string | undefined, fallback = true): boolean {
  if (value === "false") return false;
  if (value === "true") return true;
  return fallback;
}

const LOGIN_REQUIRED = enabledFlag(
  process.env.CIVILMCP_REQUIRE_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_REQUIRE_AUTH,
  true,
);

function requiresAuthFlag(value: string | undefined): boolean {
  return enabledFlag(value, LOGIN_REQUIRED);
}

export const CIVILMCP_FEATURE_ACCESS: Record<CivilMcpFeature, CivilMcpFeatureAccess> = {
  explore: {
    label: "Explore",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_EXPLORE_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_EXPLORE_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_EXPLORE_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_EXPLORE_REQUIRES_AUTH),
  },
  chat: {
    label: "Chat",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_CHAT_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_CHAT_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_CHAT_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_CHAT_REQUIRES_AUTH),
  },
  workspace: {
    label: "Research Workspace",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_WORKSPACE_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_WORKSPACE_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_WORKSPACE_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_WORKSPACE_REQUIRES_AUTH),
  },
  notebook: {
    label: "Research Notebook",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_NOTEBOOK_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_NOTEBOOK_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_NOTEBOOK_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_NOTEBOOK_REQUIRES_AUTH),
  },
  path: {
    label: "Research Path",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_RESEARCH_PATH_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_RESEARCH_PATH_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_RESEARCH_PATH_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_RESEARCH_PATH_REQUIRES_AUTH),
  },
  history: {
    label: "Chat History",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_HISTORY_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_HISTORY_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_HISTORY_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_HISTORY_REQUIRES_AUTH),
  },
  shared: {
    label: "Share & export",
    enabled: enabledFlag(process.env.CIVILMCP_FEATURE_SHARE_ENABLED ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_SHARE_ENABLED),
    requiresAuth: requiresAuthFlag(process.env.CIVILMCP_FEATURE_SHARE_REQUIRES_AUTH ?? process.env.NEXT_PUBLIC_CIVILMCP_FEATURE_SHARE_REQUIRES_AUTH),
  },
  settings: {
    label: "Account",
    enabled: true,
    requiresAuth: false,
  },
};
