import { createOpenAI, openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { applyChatIdentityCookies, chatIdentityErrorResponse, resolveChatIdentity } from "@/lib/chat-auth";
import { consumeChatQuota } from "@/lib/chat-store";
import {
  DEFAULT_CHAT_MODEL,
  isDeepSeekChatModel,
  isOpenAIChatModel,
  normalizeChatModel,
  type ChatModel,
} from "@/lib/chat-models";
import {
  clampEnvNumber,
  getRequestIp,
  rateLimitHeaders,
  readBoundedJson,
  safeTraceId,
} from "@/lib/server-guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

const THAI_TEXT_PATTERN = /[\u0E00-\u0E7F]/;
const MAX_BODY_BYTES = clampEnvNumber(process.env.TRANSLATION_MAX_BODY_BYTES, 8_192, 100_000, 64_000);
const MAX_INPUT_CHARS = clampEnvNumber(process.env.TRANSLATION_MAX_INPUT_CHARS, 2_000, 30_000, 18_000);
const GUEST_REQUESTS_PER_MINUTE = clampEnvNumber(process.env.TRANSLATION_GUEST_REQUESTS_PER_MINUTE, 1, 10, 2);
const GUEST_REQUESTS_PER_HOUR = clampEnvNumber(process.env.TRANSLATION_GUEST_REQUESTS_PER_HOUR, 1, 100, 10);
const AUTH_REQUESTS_PER_MINUTE = clampEnvNumber(process.env.TRANSLATION_AUTH_REQUESTS_PER_MINUTE, 1, 20, 5);
const AUTH_REQUESTS_PER_HOUR = clampEnvNumber(process.env.TRANSLATION_AUTH_REQUESTS_PER_HOUR, 1, 200, 30);
const deepseek = createOpenAI({
  name: "deepseek",
  baseURL: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
  apiKey: process.env.DEEPSEEK_API_KEY,
  compatibility: "compatible",
  fetch: async (input, init) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (typeof body.model === "string" && body.model.startsWith("deepseek-v4-")) {
          body.thinking = { type: "disabled" };
          return fetch(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // Fall through to the unmodified request body.
      }
    }
    return fetch(input, init);
  },
});

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

function translationModelName(): ChatModel {
  return normalizeChatModel(process.env.TRANSLATION_MODEL ?? DEFAULT_CHAT_MODEL);
}

function translationModel(model: ChatModel) {
  if (isOpenAIChatModel(model)) {
    if (!process.env.OPENAI_API_KEY) throw new Error("Translation provider is not configured.");
    return openai(model);
  }
  if (isDeepSeekChatModel(model) && process.env.DEEPSEEK_API_KEY) return deepseek(model);
  throw new Error("Translation provider is not configured.");
}

export async function POST(request: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolveChatIdentity>>;
  try {
    resolved = await resolveChatIdentity(request);
  } catch (error) {
    return chatIdentityErrorResponse(error, request);
  }
  const { identity, applyAuthCookies } = resolved;
  const finalize = (response: NextResponse) => applyChatIdentityCookies(response, identity, applyAuthCookies);

  const rate = await consumeChatQuota({
    scope: "paper_translation",
    userId: identity.userId,
    ipAddress: getRequestIp(request),
    isAuthenticated: identity.isAuthenticated,
    guestMinuteLimit: GUEST_REQUESTS_PER_MINUTE,
    guestHourLimit: GUEST_REQUESTS_PER_HOUR,
    authenticatedMinuteLimit: AUTH_REQUESTS_PER_MINUTE,
    authenticatedHourLimit: AUTH_REQUESTS_PER_HOUR,
  }).catch(() => null);
  if (!rate) {
    return finalize(NextResponse.json(
      { error: "Translation quota service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    ));
  }
  const headers = { ...rateLimitHeaders(rate), "Cache-Control": "private, no-store" };
  if (!rate.allowed) {
    return finalize(NextResponse.json(
      {
        error: "Translation limit reached. Please try again after the reset time.",
        resetAt: new Date(rate.resetAt).toISOString(),
      },
      { status: 429, headers },
    ));
  }

  try {
    const body = TranslationRequestSchema.parse(await readBoundedJson<unknown>(request, MAX_BODY_BYTES));
    const uniqueSegments = Array.from(new Map(body.segments.map((segment) => [segment.id, segment])).values());
    const thaiSegments = uniqueSegments.filter((segment) => THAI_TEXT_PATTERN.test(segment.text));
    const totalChars = thaiSegments.reduce((total, segment) => total + segment.text.length, 0);

    if (totalChars > MAX_INPUT_CHARS) {
      return finalize(NextResponse.json(
        { error: `Translation input exceeds the ${MAX_INPUT_CHARS.toLocaleString()} character limit.` },
        { status: 413, headers },
      ));
    }

    if (!thaiSegments.length) {
      return finalize(NextResponse.json(
        { sourceLanguage: "th", targetLanguage: "en", translations: [], translatedAt: new Date().toISOString() },
        { headers },
      ));
    }

    const selectedModel = translationModelName();
    const result = await generateObject({
      model: translationModel(selectedModel),
      schema: TranslationResultSchema,
      system:
        "You translate Thai civil-engineering paper content into precise, natural English. " +
        "Translate only; never summarize, explain, omit, or add claims. Preserve identifiers, citations, equations, units, numeric values, headings, and proper nouns. " +
        "Keep text that is already English when it is part of a mixed-language segment. Return exactly one translation for every supplied segment id.",
      prompt: JSON.stringify({ targetLanguage: body.targetLanguage, segments: thaiSegments }),
      maxTokens: 7_000,
      ...(isOpenAIChatModel(selectedModel) ? { providerOptions: { openai: { reasoningEffort: "low" } } } : {}),
    });

    const requestedIds = new Set(thaiSegments.map((segment) => segment.id));
    const translations = result.object.translations
      .filter((segment) => requestedIds.has(segment.id) && segment.text.trim())
      .map((segment) => ({ id: segment.id, text: segment.text.trim() }));

    return finalize(NextResponse.json(
      {
        sourceLanguage: "th",
        targetLanguage: "en",
        translations,
        translatedAt: new Date().toISOString(),
      },
      { headers },
    ));
  } catch (error) {
    const traceId = safeTraceId();
    const status = error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 502;
    console.error("paper_translation_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finalize(NextResponse.json(
      {
        error: status === 400 ? "Invalid translation request." : "Paper translation is temporarily unavailable.",
        traceId,
      },
      { status, headers },
    ));
  }
}
