-- OAuth tokens issued for third-party clients are bound to the public MCP v2 resource.
-- Enabling this function as the Custom Access Token hook remains an Auth dashboard action.

begin;

create or replace function public.civil_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
begin
  claims := event->'claims';

  if nullif(claims->>'client_id', '') is not null then
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://civil-mcp-server.vercel.app/v2/mcp'::text)
    );
    claims := jsonb_set(claims, '{civilmcp_mcp}', 'true'::jsonb);
    claims := jsonb_set(
      claims,
      '{civilmcp_permissions}',
      '["evidence:read","private:read","library:read","library:write"]'::jsonb
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.civil_mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.civil_mcp_access_token_hook(jsonb) from public, anon, authenticated;

comment on function public.civil_mcp_access_token_hook(jsonb) is
  'Binds Supabase OAuth-client access tokens to CivilMCP MCP v2 and adds server-enforced permissions.';

commit;
