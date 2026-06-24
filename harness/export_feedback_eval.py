from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common import ROOT, Check, load_env, make_report, print_report, write_report

OUTPUT = ROOT / "eval" / "feedback_eval_seed.jsonl"


def normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    trace = row.pop("trace", None)
    if trace is not None:
        row["civil_chat_traces"] = trace
    return row


def rows_from_supabase_rest(env: dict[str, str]) -> list[dict[str, Any]]:
    from supabase import create_client

    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
    return (
        sb.table("civil_chat_feedback")
        .select(
            "feedback_id, trace_id, session_id, rating, categories, correction, citation_issue, created_at, "
            "civil_chat_traces(question, answer, model, collection, context_stats, evidence_items, usage, timings)"
        )
        .eq("rating", "down")
        .order("created_at", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )


def rows_from_db_url(env: dict[str, str]) -> list[dict[str, Any]]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(env["SUPABASE_DB_URL"], connect_timeout=30, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  f.feedback_id,
                  f.trace_id,
                  f.session_id,
                  f.rating,
                  f.categories,
                  f.correction,
                  f.citation_issue,
                  f.created_at,
                  jsonb_build_object(
                    'question', t.question,
                    'answer', t.answer,
                    'model', t.model,
                    'collection', t.collection,
                    'context_stats', t.context_stats,
                    'evidence_items', t.evidence_items,
                    'usage', t.usage,
                    'timings', t.timings
                  ) as trace
                from civil_chat_feedback f
                left join civil_chat_traces t on t.trace_id = f.trace_id
                where f.rating = 'down'
                order by f.created_at desc
                limit 200
                """
            )
            return [normalize_row(dict(row)) for row in cur.fetchall()]


def main() -> None:
    env = load_env()
    if not ((env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")) or env.get("SUPABASE_DB_URL")):
        report = make_report(
            "feedback_eval_export",
            [Check("feedback_eval_export", "warn", "Supabase REST env and SUPABASE_DB_URL are missing; feedback export skipped.")],
        )
        path = write_report("feedback_eval_export", report)
        print_report(report, path)
        return

    try:
        try:
            if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_KEY")):
                raise RuntimeError("Supabase REST env missing.")
            rows = rows_from_supabase_rest(env)
            source = "supabase_rest"
        except Exception as rest_exc:  # noqa: BLE001
            if not env.get("SUPABASE_DB_URL"):
                raise rest_exc
            rows = rows_from_db_url(env)
            source = "supabase_db_url"
        OUTPUT.write_text("".join(json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in rows), encoding="utf-8")
        report = make_report(
            "feedback_eval_export",
            [Check("feedback_eval_export", "pass", f"Exported {len(rows)} feedback rows to {OUTPUT.relative_to(ROOT)}")],
            {"rowCount": len(rows), "output": str(OUTPUT.relative_to(ROOT)), "source": source},
        )
    except Exception as exc:  # noqa: BLE001
        report = make_report(
            "feedback_eval_export",
            [Check("feedback_eval_export", "warn", f"Feedback export skipped: {exc}")],
        )
    path = write_report("feedback_eval_export", report)
    print_report(report, path)


if __name__ == "__main__":
    main()
