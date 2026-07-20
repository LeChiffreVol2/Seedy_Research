-- CityMCP RPC/view privilege hardening. Runtime access should go through the
-- ops-dashboard server with SUPABASE_SERVICE_KEY, not browser/client roles.

revoke all on function public.smart_city_get_layer_features(double precision, double precision, double precision, double precision, double precision, text[], timestamptz, boolean, integer) from public, anon, authenticated;
grant execute on function public.smart_city_get_layer_features(double precision, double precision, double precision, double precision, double precision, text[], timestamptz, boolean, integer) to service_role;

revoke all on function public.smart_city_get_layer_feature_stats(double precision, double precision, double precision, double precision, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.smart_city_get_layer_feature_stats(double precision, double precision, double precision, double precision, text[], timestamptz) to service_role;

revoke all on function public.smart_city_get_layer_features_page(double precision, double precision, double precision, double precision, double precision, text[], timestamptz, integer, timestamptz, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.smart_city_get_layer_features_page(double precision, double precision, double precision, double precision, double precision, text[], timestamptz, integer, timestamptz, text, boolean, integer) to service_role;

revoke all on function public.smart_city_get_layer_mvt(integer, integer, integer, text[], timestamptz, boolean, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.smart_city_get_layer_mvt(integer, integer, integer, text[], timestamptz, boolean, integer, integer, integer) to service_role;

revoke all on function public.smart_city_begin_ingest_run(text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.smart_city_begin_ingest_run(text, text, text, text[], jsonb) to service_role;

revoke all on function public.smart_city_mark_missing_rows_stale(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.smart_city_mark_missing_rows_stale(uuid, text[], text) to service_role;

revoke all on function public.smart_city_finish_ingest_run(uuid, text, text[], text[], jsonb, text, text) from public, anon, authenticated;
grant execute on function public.smart_city_finish_ingest_run(uuid, text, text[], text[], jsonb, text, text) to service_role;

revoke all on function public.smart_city_transition_action_record(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.smart_city_transition_action_record(text, text, text, text, text, jsonb) to service_role;

revoke all on table public.smart_city_source_freshness_v from public, anon, authenticated;
grant select on table public.smart_city_source_freshness_v to service_role;

revoke all on table public.smart_city_layer_items_v from public, anon, authenticated;
grant select on table public.smart_city_layer_items_v to service_role;

revoke all on table public.smart_city_layer_registry_v from public, anon, authenticated;
grant select on table public.smart_city_layer_registry_v to service_role;

revoke all on table public.smart_city_source_sla_v from public, anon, authenticated;
grant select on table public.smart_city_source_sla_v to service_role;

notify pgrst, 'reload schema';
