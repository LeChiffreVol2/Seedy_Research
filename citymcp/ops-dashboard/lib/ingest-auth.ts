import { loadOpsEnv } from "./env";

export function configuredIngestSecret(): string | null {
  loadOpsEnv();
  const ingestSecret = process.env.OPS_INGEST_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  return ingestSecret || cronSecret || null;
}

export function isAuthorizedIngestRequest(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const headerSecret = request.headers.get("x-ops-ingest-secret") ?? "";
  if (request.method === "GET") {
    loadOpsEnv();
    const cronSecret = process.env.CRON_SECRET?.trim();
    return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
  }
  if (request.method === "POST") {
    loadOpsEnv();
    const ingestSecret = process.env.OPS_INGEST_SECRET?.trim();
    return Boolean(ingestSecret && (headerSecret === ingestSecret || auth === `Bearer ${ingestSecret}`));
  }
  return false;
}
