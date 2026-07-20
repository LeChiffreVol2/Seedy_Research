import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import {
  checkRateLimit,
  clampEnvNumber,
  rateLimitHeaders,
  readBoundedJson,
  requestIdentityKey,
  safeTraceId,
} from "@/lib/server-guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = ["sin1"];

const THAI_TEXT_PATTERN = /[\u0E00-\u0E7F]/;
const MAX_BODY_BYTES = clampEnvNumber(process.env.TRANSLATION_MAX_BODY_BYTES, 8_192, 100_000, 64_000);
const MAX_INPUT_CHARS = clampEnvNumber(process.env.TRANSLATION_MAX_INPUT_CHARS, 2_000, 30_000, 18_000);
const RATE_LIMIT_WINDOW_SECONDS = clampEnvNumber(process.env.TRANSLATION_RATE_LIMIT_WINDOW_SECONDS, 10, 3_600, 60);
const RATE_LIMIT_MAX_CALLS = clampEnvNumber(process.env.TRANSLATION_RATE_LIMIT_MAX_CALLS, 1, 120, 20);

const TranslationRequestSchema = z.object({
  targetLanguage: z.literal("en").default("en"),
  segments: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(180),
        text: z.string().trim().min(1).max(2_400),
      }),
    )
    .min(1)
    .max(64),
});

const TranslationResultSchema = z.object({
  translations: z.array(
    z.object({
      id: z.string().trim().min(1).max(180),
      text: z.string().trim().min(1).max(4_800),
    }),
  ),
});

function translationModel() {
  const configuredModel = process.env.TRANSLATION_MODEL?.trim();
  if (!process.env.OPENAI_API_KEY) throw new Error("Translation provider is not configured.");
  return openai(configuredModel?.startsWith("gpt-5.6-") ? configuredModel : "gpt-5.6-luna");
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(
    requestIdentityKey(request, "paper_translation"),
    RATE_LIMIT_MAX_CALLS,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return Response.json({ error: "Too many translation requests. Please try again shortly." }, { status: 429, headers });
  }

  try {
    const body = TranslationRequestSchema.parse(await readBoundedJson<unknown>(request, MAX_BODY_BYTES));
    const uniqueSegments = Array.from(new Map(body.segments.map((segment) => [segment.id, segment])).values());
    const thaiSegments = uniqueSegments.filter((segment) => THAI_TEXT_PATTERN.test(segment.text));
    const totalChars = thaiSegments.reduce((total, segment) => total + segment.text.length, 0);

    if (totalChars > MAX_INPUT_CHARS) {
      return Response.json(
        { error: `Translation input exceeds the ${MAX_INPUT_CHARS.toLocaleString()} character limit.` },
        { status: 413, headers: { ...headers, "Cache-Control": "no-store" } },
      );
    }

    if (!thaiSegments.length) {
      return Response.json(
        { sourceLanguage: "th", targetLanguage: "en", translations: [], translatedAt: new Date().toISOString() },
        { headers: { ...headers, "Cache-Control": "no-store" } },
      );
    }

    const result = await generateObject({
      model: translationModel(),
      schema: TranslationResultSchema,
      system:
        "You translate Thai civil-engineering paper content into precise, natural English. " +
        "Translate only; never summarize, explain, omit, or add claims. Preserve identifiers, citations, equations, units, numeric values, headings, and proper nouns. " +
        "Keep text that is already English when it is part of a mixed-language segment. Return exactly one translation for every supplied segment id.",
      prompt: JSON.stringify({ targetLanguage: body.targetLanguage, segments: thaiSegments }),
      maxTokens: 7_000,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });

    const requestedIds = new Set(thaiSegments.map((segment) => segment.id));
    const translations = result.object.translations
      .filter((segment) => requestedIds.has(segment.id) && segment.text.trim())
      .map((segment) => ({ id: segment.id, text: segment.text.trim() }));

    return Response.json(
      {
        sourceLanguage: "th",
        targetLanguage: "en",
        translations,
        translatedAt: new Date().toISOString(),
      },
      { headers: { ...headers, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const traceId = safeTraceId();
    const status = error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 502;
    console.error("paper_translation_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      {
        error: status === 400 ? "Invalid translation request." : "Paper translation is temporarily unavailable.",
        traceId,
      },
      { status, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
