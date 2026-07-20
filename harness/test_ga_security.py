#!/usr/bin/env python3
"""Dependency-free regression checks for GA security contracts."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class GASecurityContracts(unittest.TestCase):
    def test_guest_cookie_is_signed_expiring_and_hardened(self) -> None:
        text = source("web/lib/chat-cookies.ts")
        for contract in (
            'createHmac("sha256", guestCookieSecret())',
            'timingSafeEqual(expected, provided)',
            "parts.length !== 4",
            "expiresAt <= Math.floor(now / 1000)",
            "httpOnly: true",
            'sameSite: "lax"',
            'secure: process.env.NODE_ENV === "production"',
            "GUEST_SESSION_HMAC_KEY must be a non-placeholder secret with at least 32 characters in production.",
            'deriveCivilSecurityKey("guest-session")',
            'update(`civilmcp:${purpose}:v1`)',
            "source.length < 32 || isPlaceholderSecret(source)",
        ):
            self.assertIn(contract, text)

    def test_authenticated_identity_wins_and_clears_guest_cookie(self) -> None:
        auth = source("web/lib/chat-auth.ts")
        cookies = source("web/lib/chat-cookies.ts")
        self.assertIn('value?.trim().replace(/^[\'\"]|[\'\"]$/g, "")', auth)
        self.assertIn(".find(isHttpUrl)", auth)
        self.assertIn("process.env.SUPABASE_SERVICE_KEY", auth)
        self.assertIn(".find(isUsableKey)", auth)
        authenticated = auth.index("if (authenticated.authUser && authenticated.user)")
        guest = auth.index("signedGuestIdFromRequest(request)")
        self.assertLess(authenticated, guest)
        self.assertIn("if (identity.isAuthenticated) clearGuestCookie(response)", cookies)

    def test_expired_authenticated_session_never_falls_back_to_guest(self) -> None:
        auth = source("web/lib/chat-auth.ts")
        self.assertIn("hasSupabaseAuthCookie(request)", auth)
        self.assertIn("throw new ChatIdentityError(", auth)
        self.assertIn('rejected ? 401 : 503', auth)
        self.assertIn('response.cookies.delete(name)', auth)

    def test_chat_quota_is_distributed_bounded_and_fail_closed(self) -> None:
        store = source("web/lib/chat-store.ts")
        route = source("web/app/api/chat/route.ts")
        for contract in (
            'supabase.rpc("consume_civil_quota"',
            "consume(scope, identityHash, minuteLimit, 60)",
            "consume(scope, identityHash, hourLimit, 3600)",
            'consume(`${scope}_ip`, ipHash, Math.min(10_000, minuteLimit * 10), 60)',
            "results.every((result) => result.allowed)",
            'createHmac("sha256", hashKey)',
            'deriveCivilSecurityKey("quota")',
        ):
            self.assertIn(contract, store)
        self.assertIn("await resolveChatIdentity(request)", route)
        self.assertIn("await consumeChatQuota({", route)
        self.assertIn('status: 429, headers: rateLimitHeaders(rate)', route)
        self.assertIn('status: 503', route)

    def test_openai_answer_budget_preserves_visible_output(self) -> None:
        route = source("web/app/api/chat/route.ts")
        self.assertIn("OPENAI_ANSWER_MIN_TOKENS = 2400", route)
        self.assertIn('providerOptions: { openai: { reasoningEffort: "low" } }', route)
        self.assertEqual(route.count("...answerGenerationOptions(selectedModel)"), 4)

    def test_shared_sessions_require_expiry_and_revocation_checks(self) -> None:
        store = source("web/lib/chat-store.ts")
        share = source("web/app/api/share/route.ts")
        self.assertIn('.is("share_revoked_at", null)', store)
        self.assertIn('.gt("share_expires_at", new Date().toISOString())', store)
        self.assertIn('.eq("owner_id", ownerId)', store)
        self.assertIn("await revokeShareableSession(sessionId, identity.userId)", share)
        self.assertIn("expiresAt: share.expiresAt", share)

    def test_production_traces_are_metadata_only_by_default(self) -> None:
        store = source("web/lib/chat-store.ts")
        migration = source("supabase/migrations/20260718090000_civil_ga_backbone_p0.sql")
        self.assertIn('process.env.NODE_ENV === "production" ? "metadata" : "debug"', store)
        self.assertIn('traceMode === "debug" && trace.includeContent === true', store)
        self.assertIn("question: retainContent ? trace.question ?? null : null", store)
        self.assertIn("answer: retainContent ? trace.answer ?? null : null", store)
        self.assertIn("question_hash: questionHash", store)
        self.assertIn('const keepSnapshot = feedback.rating === "down"', store)
        self.assertIn("content_expires_at: keepSnapshot", store)
        self.assertIn("metadataOnlyTraceValue", store)
        self.assertIn("alter column content_mode set default 'debug'", migration)

    def test_guest_persistence_and_history_writes_are_bounded(self) -> None:
        auth = source("web/lib/chat-auth.ts")
        session = source("web/app/api/session/route.ts")
        history = source("web/app/api/history/route.ts")
        self.assertIn("storedUser ??", auth)
        self.assertIn("createEmptyChatSession", session)
        self.assertIn("readBoundedJson(request, HISTORY_MAX_BODY_BYTES)", history)
        self.assertIn('.max(HISTORY_MAX_MESSAGES)', history)
        self.assertIn('scope: "history_write"', history)

    def test_feedback_is_bound_to_trace_owner(self) -> None:
        store = source("web/lib/chat-store.ts")
        self.assertIn('.eq("trace_id", feedback.traceId)', store)
        self.assertIn('.eq("user_id", feedback.userId)', store)
        self.assertIn("Feedback session does not match its trace.", store)


if __name__ == "__main__":
    unittest.main(verbosity=2)
