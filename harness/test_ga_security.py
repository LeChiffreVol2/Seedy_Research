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
        self.assertEqual(route.count("...answerGenerationOptions(selectedModel)"), 5)

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

    def test_founder_pro_entitlement_and_credit_paths_are_server_enforced(self) -> None:
        models = source("web/lib/chat-models.ts")
        chat = source("web/app/api/chat/route.ts")
        billing = source("web/lib/billing.ts")
        webhook = source("web/app/api/webhooks/stripe/route.ts")
        migration = source("supabase/migrations/20260720160000_civil_founder_pro.sql")
        period_guard = source("supabase/migrations/20260720163000_civil_billing_period_guards.sql")
        self.assertIn('"gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", credits: 3, requiresPro: true', models)
        self.assertIn('"gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", credits: 5, requiresPro: true', models)
        self.assertIn("await reserveAnswerCredits({", chat)
        self.assertIn("await refundAnswerCredits(userId, requestId, creditReservation.charged)", chat)
        self.assertEqual(chat.count("onError: refundCredits"), 2)
        self.assertIn('status: 402', chat)
        self.assertIn('request.text()', webhook)
        self.assertIn('verifyStripeSignature(payload', webhook)
        self.assertIn('timingSafeEqual(received, expected)', billing)
        self.assertIn("Math.abs(Date.now() / 1000 - seconds) > 300", billing)
        for contract in (
            "create table if not exists public.civil_billing_accounts",
            "create table if not exists public.civil_credit_ledger",
            "unique (user_id, request_id, kind)",
            "for update",
            "civil_consume_answer_credits",
            "civil_refund_answer_credits",
            "civil_sync_stripe_subscription",
            "p_event_created_at < v_account.stripe_event_created_at",
            "revoke all on table public.civil_credit_ledger from public, anon, authenticated",
        ):
            self.assertIn(contract, migration)
        for contract in (
            "civil_expire_billing_account",
            "plan = 'free'",
            "credits_included = 25",
            "current_period_end <= clock_timestamp()",
        ):
            self.assertIn(contract, period_guard)

    def test_agentic_evidence_mission_is_bounded_and_citation_allowlisted(self) -> None:
        chat = source("web/app/api/chat/route.ts")
        page = source("web/app/page.tsx")
        self.assertIn('type ChatExperience = "answer" | "mission" | "learn" | "research" | "automated"', chat)
        self.assertIn("uniqueValidEvidenceIds", chat)
        self.assertIn('core.verdict.status === "conflicting" && sourceCount < 2', chat)
        self.assertIn('noEvidence ? "insufficient"', chat)
        self.assertIn("MAX_TOOL_CALLS", chat)
        self.assertIn("MAX_AGENT_STEPS", chat)
        self.assertIn('type: "civilmcp_mission"', chat)
        self.assertIn("createDataStreamResponse", chat)
        self.assertIn("getCivilMissionAnnotation", page)
        self.assertIn("evidenceBriefMarkdown", page)

    def test_deep_research_entitlement_and_research_path_boundaries(self) -> None:
        chat = source("web/app/api/chat/route.ts")
        path = source("web/app/api/research-path/route.ts")
        self.assertIn('experience === "research"', chat)
        self.assertIn('experience === "research" || experience === "automated"', chat)
        self.assertIn("fallbackAutomationProgram", chat)
        self.assertIn("finalizeAutomationProgram", chat)
        self.assertIn('experience === "automated"', chat)
        self.assertIn("getBillingState(userId)", chat)
        self.assertIn('billingState.plan !== "founder_pro"', chat)
        self.assertIn("readBoundedJson<PathRequest>(request, 8_192)", path)
        self.assertIn("goal.length < 8", path)
        self.assertIn("AbortSignal.timeout(8_000)", path)
        self.assertIn("process.env.OPENALEX_API_KEY", path)

    def test_research_workspace_is_pro_gated_bounded_and_citation_allowlisted(self) -> None:
        workspace = source("web/app/api/research-workspaces/route.ts")
        workspace_store = source("web/lib/research-workspaces.ts")
        workspace_ui = source("web/components/research-workspace.tsx")
        page = source("web/app/page.tsx")
        self.assertIn('rows: z.array(workspaceRowSchema).min(1).max(6)', workspace)
        self.assertIn('columns: z.array(workspaceColumnSchema).min(1).max(6)', workspace)
        self.assertIn('billing.plan !== "founder_pro"', workspace)
        self.assertIn('scope: "research_workspace_run"', workspace)
        self.assertIn("await reserveAnswerCredits({", workspace)
        self.assertIn("refundAnswerCredits", workspace)
        self.assertIn('id.startsWith(prefix)', workspace)
        self.assertIn('evidenceIds: z.array(z.string().regex(/^P\\d+E\\d+$/)).max(4)', workspace)
        self.assertIn('notes.length > 550_000', workspace_store)
        self.assertIn('existing.owner_id !== input.ownerId', workspace_store)
        self.assertIn('.eq("workspace_id", workspaceId).eq("owner_id", input.ownerId)', workspace_store)
        self.assertIn('.eq("owner_id", ownerId)', workspace_store)
        self.assertIn('aria-label="Research Workspace Pro"', workspace_ui)
        self.assertIn('label: "Workspace Pro"', page)
        self.assertNotIn('label: "Automated Research"', page)


if __name__ == "__main__":
    unittest.main(verbosity=2)
