import { loadOpsEnv } from "./env";

export function configuredIngestSecret(): string | null {
  loadOpsEnv();
  const ingestSecret = process.env.OPS_INGEST_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  return ingestSecret || cronSecret || null;
}

function configuredIngestSecrets(): string[] {
  loadOpsEnv();
  return [process.env.OPS_INGEST_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(
    (secret): secret is string => Boolean(secret),
  );
}

export function isAuthorizedIngestRequest(request: Request): boolean {
  const secrets = configuredIngestSecrets();
  if (secrets.length === 0) return false;
  const auth = request.headers.get("authorization") ?? "";
  const headerSecret = request.headers.get("x-ops-ingest-secret") ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}` || headerSecret === secret);
}
