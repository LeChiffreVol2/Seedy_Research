import path from "node:path";
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

let loaded = false;

export function loadOpsEnv() {
  if (loaded) return;
  const rootDir = path.resolve(process.cwd(), "..");
  loadEnvConfig(rootDir);
  loadEnvConfig(process.cwd());
  loadDotenvFile(path.join(rootDir, ".env"));
  loadDotenvFile(path.join(process.cwd(), ".env.local"));
  loaded = true;
}

function loadDotenvFile(filePath: string) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    const name = key.trim();
    if (!name || process.env[name]) continue;
    let value = stripInlineComment(valueParts.join("=").trim());
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

function stripInlineComment(value: string): string {
  if (!value || value.startsWith('"') || value.startsWith("'")) return value;
  const commentIndex = value.search(/\s#/);
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd();
}
