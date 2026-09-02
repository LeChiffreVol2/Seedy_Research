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
        callback = source("web/app/auth/callback/route.ts")
        workspace = source("web/lib/paper-workspace.ts")
        page = source("web/app/page.tsx")
        self.assertIn('value?.trim().replace(/^[\'\"]|[\'\"]$/g, "")', auth)
        self.assertIn(".find(isHttpUrl)", auth)
        self.assertNotIn("process.env.SUPABASE_SERVICE_KEY", auth)
        self.assertIn('value.startsWith("sb_publishable_")', auth)
        self.assertIn('payload.role === "anon"', auth)
        self.assertIn(".find(isSupabaseAnonKey)", auth)
        authenticated = auth.index("if (authenticated.authUser && authenticated.user)")
        guest = auth.index("signedGuestIdFromRequest(request)")
        self.assertLess(authenticated, guest)
        self.assertIn("if (identity.isAuthenticated) clearGuestCookie(response)", cookies)
        for contract in (
            "exchangeCodeForSession(code)",
            "transferChatSessions(previousOwnerId, data.user.id)",
            "transferWorkspaceItems(previousOwnerId, data.user.id)",
            "clearGuestCookie(response)",
        ):
            self.assertIn(contract, callback)
        for contract in (
            'workspaceItemId(to, guestItem.source)',
            '.upsert(mergedItems, { onConflict: "owner_id,source" })',
            '.delete()',
            '.eq("owner_id", from)',
        ):
            self.assertIn(contract, workspace)
        self.assertIn('body: JSON.stringify({ action: "profile", displayName })', page)
        self.assertIn("onProfileUpdate={() => void updateProfile()}", page)

    def test_expired_authenticated_session_never_falls_back_to_guest(self) -> None:
        auth = source("web/lib/chat-auth.ts")
        self.assertIn("hasSupabaseAuthCookie(request)", auth)
        self.assertIn("throw new ChatIdentityError(", auth)
        self.assertIn('rejected ? 401 : 503', auth)
        self.assertIn('response.cookies.delete(name)', auth)

    def test_account_deletion_is_transactional_and_service_role_only(self) -> None:
        route = source("web/app/api/auth/route.ts")
        migration = source("supabase/migrations/20260813110000_civil_transactional_account_deletion.sql")
        rpc_call = route.index('admin.rpc("civil_delete_account_data"')
        auth_delete = route.index("admin.auth.admin.deleteUser")
        self.assertLess(rpc_call, auth_delete)
        self.assertNotIn('admin.from("civil_chat_feedback").delete()', route)
        self.assertTrue(migration.startswith("begin;"))
        self.assertTrue(migration.rstrip().endswith("commit;"))
        for contract in (
            "create or replace function public.civil_delete_account_data(p_user_id text)",
            "security definer",
            "set search_path = public",
            "active subscription must be canceled before account deletion",
            "for update",
            "delete from public.civil_chat_feedback",
            "select trace_id from public.civil_chat_traces",
            "select session_id from public.civil_chat_sessions where owner_id = p_user_id",
            "delete from public.civil_chat_sessions where owner_id = p_user_id",
            "delete from public.civil_paper_workspace_items where owner_id = p_user_id",
            "delete from public.civil_paper_workspaces where owner_id = p_user_id",
            "delete from public.civil_support_requests where user_id = p_user_id",
            "delete from public.civil_product_events where user_id = p_user_id",
            "delete from public.civil_credit_ledger where user_id = p_user_id",
            "delete from public.civil_billing_accounts where user_id = p_user_id",
            "delete from public.civil_chat_users where user_id = p_user_id",
            "revoke all on function public.civil_delete_account_data(text) from public, anon, authenticated",
            "grant execute on function public.civil_delete_account_data(text) to service_role",
        ):
            self.assertIn(contract, migration)

    def test_chat_quota_is_distributed_bounded_and_fail_closed(self) -> None:
        store = source("web/lib/chat-store.ts")
        route = source("web/app/api/chat/route.ts")
        translation = source("web/app/api/paper-translation/route.ts")
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
        for contract in (
            "await resolveChatIdentity(request)",
            "await consumeChatQuota({",
            'scope: "paper_translation"',
            "guestMinuteLimit: GUEST_REQUESTS_PER_MINUTE",
            "authenticatedHourLimit: AUTH_REQUESTS_PER_HOUR",
            "applyChatIdentityCookies(response, identity, applyAuthCookies)",
        ):
            self.assertIn(contract, translation)
        self.assertNotIn("checkRateLimit(", translation)
        self.assertNotIn("requestIdentityKey(", translation)

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

    def test_fast_retrieval_falls_back_when_semantic_results_are_empty(self) -> None:
        route = source("web/app/api/chat/route.ts")
        self.assertIn("needsSectionFallback ||= chunks.length === 0", route)
        self.assertIn("function focusedFallbackQuery(query: string, intent: Intent)", route)
        self.assertIn(
            "if (needsSectionFallback && toolCalls < Math.min(MAX_TOOL_CALLS, MAX_AGENT_STEPS))",
            route,
        )
        self.assertIn('const sectionsPayload = await callTool("search_civil_sections"', route)
        self.assertIn("query: focusedFallbackQuery(plan.searchQuery, plan.intent)", route)

    def test_public_ci_uses_committed_data_fixtures_and_gates_preview_secrets(self) -> None:
        ci = source(".github/workflows/ci.yml")
        preview = source(".github/workflows/preview-release.yml")
        self.assertNotIn("run: python harness/run_data_quality.py", ci)
        self.assertIn("python -m unittest harness.test_data_quality_integrity", ci)
        self.assertIn("vars.PREVIEW_RELEASE_ENABLED == 'true'", preview)
        self.assertIn("github.event_name == 'workflow_dispatch'", preview)
        preview_migration = preview.split("  migrate-preview:", 1)[1].split("  deploy-mcp-preview:", 1)[0]
        production_stage = preview.split("  stage-production:", 1)[1].split("  production-candidate-smoke:", 1)[0]
        self.assertNotIn("github.event_name == 'workflow_dispatch' ||", preview_migration)
        self.assertIn("needs: source-gate", production_stage)
        self.assertNotIn("needs: preview-smoke", production_stage)

    def test_github_actions_use_node24_runtime(self) -> None:
        workflows = "\n".join(
            source(path)
            for path in (
                ".github/workflows/ci.yml",
                ".github/workflows/preview-release.yml",
            )
        )
        for action in (
            "actions/checkout",
            "actions/setup-python",
            "actions/setup-node",
            "actions/upload-artifact",
        ):
            self.assertIn(f"{action}@v7", workflows)
            for old_major in range(1, 7):
                self.assertNotIn(f"{action}@v{old_major}", workflows)

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

    def test_open_access_bypasses_entitlements_while_legacy_billing_stays_fail_closed(self) -> None:
        models = source("web/lib/chat-models.ts")
        chat = source("web/app/api/chat/route.ts")
        billing = source("web/lib/billing.ts")
        webhook = source("web/app/api/webhooks/stripe/route.ts")
        migration = source("supabase/migrations/20260720160000_civil_founder_pro.sql")
        period_guard = source("supabase/migrations/20260720163000_civil_billing_period_guards.sql")
        model_policy = source("supabase/migrations/20260725120000_civil_deepseek_default_and_pro_models.sql")
        openai_default_policy = source("supabase/migrations/20260829072758_default_openai_luna.sql")
        weekly_policy = source("supabase/migrations/20260725203000_civil_free_weekly_credits.sql")
        pro_top_up_policy = source("supabase/migrations/20260725205900_civil_founder_pro_500_credits.sql")
        stripe_idempotency = source("supabase/migrations/20260813120000_civil_stripe_event_idempotency.sql")
        credit_ladder = source("supabase/migrations/20260814100000_civil_terra_sol_credit_correction.sql")
        policy = source("web/lib/product-access.ts")
        self.assertIn('DEFAULT_CHAT_MODEL: ChatModel = "gpt-5.6-luna"', models)
        self.assertIn('"deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", credits: 2, requiresPro: false', models)
        self.assertIn('"gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", credits: 1, requiresPro: false', models)
        self.assertIn('"gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", credits: 5, requiresPro: false', models)
        self.assertIn('"gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", credits: 10, requiresPro: false', models)
        self.assertIn('CIVILMCP_OPEN_ACCESS', policy)
        self.assertIn('if (CIVILMCP_OPEN_ACCESS)', billing)
        self.assertIn('reason: "open_access"', billing)
        self.assertIn('if (!CIVILMCP_OPEN_ACCESS', chat)
        self.assertIn("alter column model set default 'deepseek-v4-flash'", model_policy)
        self.assertIn("alter column model set default 'gpt-5.6-luna'", openai_default_policy)
        self.assertIn("p_model in ('deepseek-v4-pro', 'gpt-5.6-terra', 'gpt-5.6-sol')", credit_ladder)
        self.assertIn("if (chatModelRequiresPro(input.model))", billing)
        self.assertIn('reason: "pro_required"', billing)
        self.assertIn("await reserveAnswerCredits({", chat)
        self.assertIn("refundAnswerCredits(userId, requestId, creditReservation.charged)", chat)
        self.assertIn('event: "civilmcp_credit_refund_pending"', chat)
        self.assertIn("Credit restoration is pending. Contact support with trace", chat)
        self.assertIn("if (data !== true) throw new Error", billing)
        self.assertIn("const requestId = safeTraceId();", chat)
        self.assertNotIn('request.headers.get("x-request-id")', chat)
        self.assertIn("baselineData.appendMessageAnnotation(creditRecoveryAnnotation(restored))", chat)
        self.assertIn("data.appendMessageAnnotation(creditRecoveryAnnotation(restored))", chat)
        self.assertIn('status: 402', chat)
        self.assertIn('request.text()', webhook)
        self.assertIn('verifyStripeSignature(payload', webhook)
        self.assertIn('timingSafeEqual(received, expected)', billing)
        self.assertIn("Math.abs(Date.now() / 1000 - seconds) > 300", billing)
        self.assertIn('rpc("civil_apply_stripe_subscription_event"', billing)
        billing_route = source("web/app/api/billing/route.ts")
        self.assertIn('{ error: "Billing is temporarily unavailable.", traceId }', billing_route)
        self.assertNotIn('{ error: error instanceof Error ? error.message', billing_route)
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
            "current_period_end <= clock_timestamp()",
        ):
            self.assertIn(contract, period_guard)
        for contract in (
            "alter column credits_included set default 100",
            "credits_included = 100",
            "date_trunc('week', v_now)",
            "interval '1 week'",
        ):
            self.assertIn(contract, weekly_policy)
        self.assertIn("FREE_WEEKLY_CREDITS = 100", billing)
        self.assertIn("FOUNDER_PRO_PRICE_THB = 299", billing)
        self.assertIn("PRO_MONTHLY_TOP_UP_CREDITS = 500", billing)
        for contract in (
            "free_credits_included",
            "pro_credits_included",
            "pro_credits_included = case when plan = 'founder_pro' then 500",
            "free_credits_included + case when v_is_pro then pro_credits_included",
        ):
            self.assertIn(contract, pro_top_up_policy)
        for contract in (
            "when 'deepseek-v4-pro' then 2",
            "when 'gpt-5.6-terra' then 5",
            "when 'gpt-5.6-sol' then 10",
            "p_model in ('deepseek-v4-pro', 'gpt-5.6-terra', 'gpt-5.6-sol')",
            "Flash/Luna 1, DeepSeek Pro 2, Terra 5, Sol 10",
        ):
            self.assertIn(contract, credit_ladder)
        for contract in (
            "civil_stripe_event_ledger",
            "on conflict (event_id) do nothing",
            "p_event_created_at = v_account.stripe_event_created_at",
            "v_event_rank = v_previous_rank and p_event_id <= coalesce(v_account.stripe_event_id, '')",
            "return 'duplicate'",
            "return 'stale'",
            "return 'applied'",
            "if not found then",
            "Answer credit restoration was not confirmed",
        ):
            haystack = billing if contract == "Answer credit restoration was not confirmed" else stripe_idempotency
            self.assertIn(contract, haystack)

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
        self.assertIn("function citationAudit(answer: string, evidenceItems: EvidenceItem[])", chat)
        self.assertIn("unresolvedCitationMarkers", chat)
        self.assertIn("answer: generatedAnswer", chat)
        self.assertIn("answerValidationFailed", chat)
        self.assertNotIn("? buildFallbackResearchBrief(latestUserForTrace, builtContext)\n        : generatedAnswer;\n      const usage", chat)

    def test_webmcp_research_passport_is_bounded_visible_and_review_gated(self) -> None:
        bridge = source("web/lib/webmcp.ts")
        page = source("web/app/page.tsx")
        e2e = source("web/tests/e2e/webmcp.spec.ts")

        for tool in (
            "start_research_case",
            "discover_research",
            "audit_global_visibility",
            "inspect_paper_evidence",
            "trace_research_connections",
            "draft_research_passport",
            "build_research_path",
            "inspect_learning_progress",
        ):
            self.assertIn(f'"{tool}"', bridge)
        self.assertIn("rawEvidenceIds.length < 1 || rawEvidenceIds.length > 3", bridge)
        self.assertIn('focus: requiredText(record, "focus", 8, 180)', bridge)
        self.assertIn('source: requiredText(record, "source", 1, 320)', bridge)
        self.assertIn("if (new Set(evidenceIds).size !== evidenceIds.length)", bridge)
        passport_tool_marker = 'name: "draft_research_passport"'
        next_tool_marker = 'name: "build_research_path"'
        self.assertIn(passport_tool_marker, bridge)
        passport_tool = bridge.partition(passport_tool_marker)[2].partition(next_tool_marker)[0]
        self.assertIn("minItems: 1, maxItems: 3, uniqueItems: true", passport_tool)
        self.assertIn('annotations: { readOnlyHint: false, untrustedContentHint: true }', passport_tool)

        handler_marker = "draftResearchPassport: async (input, signal) => {"
        next_handler_marker = "buildResearchPath: async (input, signal) => {"
        self.assertIn(handler_marker, page)
        passport_handler = page.partition(handler_marker)[2].partition(next_handler_marker)[0]
        self.assertIn("webMcpEvidenceContextRef.current", passport_handler)
        self.assertIn("activeDetail.document.source !== input.source", passport_handler)
        self.assertIn("Every evidenceId must be visible in the active paper.", passport_handler)
        self.assertIn("item.pageStart == null || item.pageEnd == null", passport_handler)
        self.assertIn("Research Passport evidence must resolve to original source pages.", passport_handler)
        self.assertIn('input.source.startsWith("private:")', passport_handler)
        self.assertIn("Private paper sources cannot be included in a public Research Passport.", passport_handler)
        self.assertIn('activeDetail.document.citable !== true || activeDetail.document.discoveryLayer === "thai_discovery"', passport_handler)
        self.assertIn("Discovery-only records cannot be used as Research Passport evidence.", passport_handler)
        self.assertIn("citationMapSourceRef.current === activeDetail.document.source", passport_handler)
        self.assertIn("const globalWorks = tracedGlobalWorks(connectionResponse)", passport_handler)
        self.assertNotIn("globalResponse.works", passport_handler)
        self.assertIn("researchContextRevisionRef.current !== contextRevision", passport_handler)
        self.assertIn("const translationResponse = await translationRequest", passport_handler)
        self.assertIn("thaiEvidence = exactEvidence.filter", passport_handler)
        self.assertIn("englishSnippet: englishByEvidenceId.get(item.id) ?? null", passport_handler)
        self.assertIn("citable: false", passport_handler)
        self.assertIn("reviewRequired: true", passport_handler)
        self.assertIn('status: "unsupported_candidate"', passport_handler)
        self.assertIn("evidenceRelationValidated: false", passport_handler)
        self.assertIn("Only OpenAlex nodes from the active exact-DOI relationship trace", passport_handler)
        self.assertIn("Topical search results are excluded", passport_handler)
        for private_state in ("libraryNote", "workspaceItems", "pathCheckpointAnswers"):
            self.assertNotIn(private_state, passport_handler)

        self.assertIn("artifact.openedEvidenceIds.includes(item.id)", page)
        self.assertIn('artifact.reviewDecisions[item.id]?.decision === "accepted"', page)
        self.assertIn("allEvidenceDecided", page)
        self.assertIn("Review the current Research Passport before exporting it.", page)
        self.assertIn('disabled={!reviewed || artifact.stale}', page)
        self.assertIn("global records used as evidence: 0", page)
        self.assertIn("provenance is not scientific correctness", page)
        self.assertIn("visible in the active paper", e2e)
        self.assertIn("expect(passport.globalLeads?.[0]?.citable).toBe(false)", e2e)
        self.assertIn("expect(exportPassport).toBeDisabled()", e2e)
        self.assertIn('getByRole("button", { name: "Accept", exact: true })', e2e)
        self.assertIn('getByRole("button", { name: "Complete evidence review" })', e2e)
        self.assertIn("expect(exportPassport).toBeEnabled()", e2e)

    def test_public_read_errors_are_redacted_and_cacheable(self) -> None:
        feed = source("web/app/api/research-feed/route.ts")
        papers = source("web/app/api/papers/route.ts")
        for route in (feed, papers):
            self.assertIn('"Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300"', route)
            self.assertIn("safeTraceId()", route)
            self.assertNotIn("detail: error instanceof Error", route)

    def test_deep_research_open_access_and_assessed_research_path_boundaries(self) -> None:
        chat = source("web/app/api/chat/route.ts")
        path = source("web/app/api/research-path/route.ts")
        openalex = source("web/lib/openalex.ts")
        global_discovery = source("web/app/api/global-discovery/route.ts")
        self.assertIn('experience === "research"', chat)
        self.assertIn('experience === "research" || experience === "automated"', chat)
        self.assertIn("fallbackAutomationProgram", chat)
        self.assertIn("finalizeAutomationProgram", chat)
        self.assertIn('experience === "automated"', chat)
        self.assertIn("if (!CIVILMCP_OPEN_ACCESS", chat)
        self.assertIn("getBillingState(userId)", chat)
        self.assertIn('billingState.plan !== "founder_pro"', chat)
        self.assertIn("readBoundedJson<PathRequest>(request, 24_000)", path)
        self.assertIn("goal.length < 8", path)
        self.assertIn("discoverOpenAlex", path)
        self.assertIn("research-to-project brief", path)
        self.assertIn("Do not infer technology readiness", path)
        self.assertIn("await resolveChatIdentity(request)", path)
        self.assertIn("await consumeChatQuota({", path)
        self.assertIn('scope: isCheckpoint ? "research_path_checkpoint" : "research_path"', path)
        self.assertIn("applyChatIdentityCookies(response, identity, applyAuthCookies)", path)
        self.assertNotIn('detail: error instanceof Error', path)
        for contract in (
            'z.literal("assess_checkpoint")',
            'const CHECKPOINT_MODEL = "gpt-5.6-luna"',
            "checkpointResultSchema",
            "getPaperDetail",
            "AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS)",
            'score >= 75 ? "understood"',
            "evidence.get(id)",
            "ALLOW-LISTED EVIDENCE",
        ):
            self.assertIn(contract, path)
        page = source("web/app/page.tsx")
        self.assertTrue(
            "Check against evidence" in page or "Check understanding" in page,
            "Research Path must expose an evidence-grounded checkpoint action.",
        )
        self.assertNotIn(">Need review</button>", page)
        self.assertNotIn(">Understood</button>", page)
        self.assertIn("const OPENALEX_TIMEOUT_MS = 8_000", openalex)
        self.assertIn("AbortSignal.timeout(OPENALEX_TIMEOUT_MS)", openalex)
        self.assertIn("process.env.OPENALEX_API_KEY", openalex)
        self.assertIn('scope: "global_discovery"', global_discovery)

    def test_metadata_catalog_never_exposes_stored_abstracts(self) -> None:
        feed = source("web/lib/research-feed.ts")
        mcp = source("mcp-server/server.py")
        migration = source("supabase/migrations/20260813100000_civil_catalog_public_rights_boundary.sql")
        self.assertIn('rpc("search_civil_source_catalog_public_v1"', feed)
        self.assertNotIn("abstract_local?:", feed)
        self.assertNotIn("abstract_en?:", feed)
        self.assertIn("never selected into a public card", feed)
        self.assertIn('"search_civil_source_catalog_public_v1"', mcp)
        self.assertNotIn('"abstract_local, abstract_en, authors', mcp)
        self.assertIn("Stored abstracts are intentionally omitted", migration)
        self.assertNotIn("abstract_local text", migration)
        self.assertNotIn("abstract_en text", migration)

    def test_research_workspace_is_open_access_bounded_and_citation_allowlisted(self) -> None:
        workspace = source("web/app/api/research-workspaces/route.ts")
        workspace_store = source("web/lib/research-workspaces.ts")
        workspace_ui = source("web/components/research-workspace.tsx")
        page = source("web/app/page.tsx")
        self.assertIn('rows: z.array(workspaceRowSchema).min(1).max(6)', workspace)
        self.assertIn('columns: z.array(workspaceColumnSchema).min(1).max(6)', workspace)
        self.assertIn('if (!CIVILMCP_OPEN_ACCESS)', workspace)
        self.assertIn('scope: "research_workspace_run"', workspace)
        self.assertIn("await reserveAnswerCredits({", workspace)
        self.assertIn("refundAnswerCredits", workspace)
        self.assertIn("restoreWorkspaceCredits", workspace)
        self.assertIn("Credit restoration is pending. Contact support with trace", workspace)
        self.assertNotIn("failed. Reserved credits were restored.", workspace)
        self.assertIn("const billingExecutionId = safeTraceId();", workspace)
        self.assertIn("`${billingExecutionId}:paper:${index + 1}`", workspace)
        self.assertNotIn("`${parsed.data.runId}:paper:${index + 1}`", workspace)
        self.assertIn("AbortSignal.timeout(WORKSPACE_GENERATION_TIMEOUT_MS)", workspace)
        self.assertIn('id.startsWith(prefix)', workspace)
        self.assertIn('evidenceIds: z.array(z.string().regex(/^P\\d+E\\d+$/)).max(4)', workspace)
        self.assertIn('notes.length > 550_000', workspace_store)
        self.assertIn('existing.owner_id !== input.ownerId', workspace_store)
        self.assertIn('.eq("workspace_id", workspaceId).eq("owner_id", input.ownerId)', workspace_store)
        self.assertIn('.eq("owner_id", ownerId)', workspace_store)
        self.assertIn('aria-label="Open Access Research Workspace"', workspace_ui)
        self.assertIn('<strong>Open review tools.</strong>', workspace_ui)
        self.assertIn('Research Notebook asks require sign-in so generated answers remain bound to one owner-scoped Workspace.', workspace_ui)
        self.assertIn('Notebook answers and private sources require sign-in for owner isolation.', workspace_ui)
        self.assertIn('"prisma_scoping"', workspace_ui)
        self.assertIn('aria-label="PRISMA-guided scoping review"', workspace_ui)
        self.assertIn('PRISMA-ScR', workspace_ui)
        self.assertIn('screening[row.source]?.decision === "included"', workspace_ui)
        for notebook_contract in (
            'action: z.literal("ask")',
            'scope: "research_notebook_ask"',
            'shareable: packets.every((packet) => packet.shareable)',
            'getResearchWorkspace(identity.userId, parsed.data.workspaceId)',
            'parsed.data.sources.some((source) => !allowedSources.has(source))',
            'detail.document.citable !== true',
            'detail.document.discoveryLayer === "thai_discovery"',
            'shareable: false',
            'AbortSignal.timeout(WORKSPACE_GENERATION_TIMEOUT_MS)',
        ):
            self.assertIn(notebook_contract, workspace)
        self.assertIn('.eq("owner_id", ownerId)', workspace_store)
        self.assertIn('.eq("workspace_id", workspaceId.trim().slice(0, 96))', workspace_store)
        self.assertIn('aria-label="Research Notebook"', workspace_ui)
        self.assertIn('OpenRAG-compatible · Seedy evidence authority', workspace_ui)
        self.assertIn('answer text is not persisted in Workspace state', workspace_ui)
        self.assertIn('label: "Workspace"', page)
        self.assertIn('label: "Automated Research"', page)

    def test_public_mcp_units_are_dormant_in_open_access_and_legacy_ledger_stays_atomic(self) -> None:
        server = source("mcp-server/server.py")
        migration = source("supabase/migrations/20260815150000_civil_mcp_research_units.sql")
        access = source("web/app/api/mcp-access/route.ts")
        models = source("web/lib/chat-models.ts")
        self.assertTrue(migration.startswith("begin;"))
        self.assertTrue(migration.rstrip().endswith("commit;"))
        for contract in (
            "civil_mcp_usage_accounts",
            "civil_mcp_usage_ledger",
            "create or replace function public.civil_get_mcp_usage",
            "create or replace function public.civil_consume_mcp_units",
            "create or replace function public.civil_refund_mcp_units",
            "when 'discover_research' then 3",
            "when 'compare_papers' then 5",
            "when 'save_papers' then 0",
            "grant execute on function public.civil_consume_mcp_units(text, text, text) to service_role",
        ):
            self.assertIn(contract, migration)
        self.assertIn('request_id = f"mcp_{uuid.uuid4()}"', server)
        self.assertIn('if CIVILMCP_OPEN_ACCESS:', server)
        self.assertIn("refund_public_mcp_units(reservation)", server)
        self.assertIn('meta["research_units"]', server)
        self.assertIn("_meta=meta", server)
        self.assertNotIn("        meta=meta,", server)
        self.assertIn('client.rpc("civil_get_mcp_usage"', access)
        self.assertIn('if (CIVILMCP_OPEN_ACCESS)', access)
        for unchanged_weight in (
            'id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", credits: 1',
            'id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", credits: 5',
            'id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", credits: 10',
            'id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek", credits: 1',
            'id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", credits: 2',
        ):
            self.assertIn(unchanged_weight, models)


if __name__ == "__main__":
    unittest.main(verbosity=2)
