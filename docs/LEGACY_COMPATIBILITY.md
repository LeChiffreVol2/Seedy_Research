# Compatibility and archived work

Seedy Research is the only active application in this repository. CityMCP is a
separate project and its application and manual workflows are no longer part
of the active source tree or Seedy release process.

## Recovering CityMCP

The complete source and workflows remain in Git history under the published
annotated tag [`archive/citymcp-before-seedy-cleanup-2026-09-04`](https://github.com/LeChiffreVol2/Seedy_Research/tree/archive/citymcp-before-seedy-cleanup-2026-09-04).
The tag points to `ada8036a8674b61179344185c19e46a447517e0c`.

Inspect it without changing the working tree:

```bash
git show archive/citymcp-before-seedy-cleanup-2026-09-04:citymcp/README.md
```

Do not restore its production workflows into Seedy without a separate review.
This source cleanup does not delete CityMCP deployments or database data.

## Contracts retained by Seedy

- `civil_*` database tables, RPCs, provider IDs, stored evidence locators, and
  MCP tool identifiers remain stable for existing users and clients.
- `https://civil-mcp-server.vercel.app` remains the remote MCP service and
  OAuth resource origin. It is not the retired web domain.
- Applied `smart_city_*` migrations and `supabase/smart_city_schema.sql` record
  historical shared-database objects. They are not active Seedy features.
  Removing them from migration history would make existing installations and
  fresh databases diverge; no database-baseline migration is included here.
- The current web URL is `https://seedresearch.vercel.app`.

Product-facing names are Seedy Research and SeedyMCP. Stable storage/protocol
names are intentionally not renamed for cosmetic consistency.
