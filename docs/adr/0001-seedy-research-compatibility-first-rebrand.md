# Rebrand to Seedy Research without renaming production identifiers

Seedy Research is the user-facing product, SeedyMCP is its shared human-agent layer, and Civil Research Pack is the first proof vertical. We retain existing `civil_*` database objects, environment variables, storage keys, routes, deployment domains, and remote MCP contracts through the WebMCP Challenge because renaming them would add migration and rollback risk without improving the judge experience; those identifiers may move later through additive aliases and separately verified migrations.

## Consequences

- Public UI, metadata, README, and submission language use Seedy Research and SeedyMCP.
- Existing production contracts remain backward compatible, including CityMCP consumers.
- New domain code must not introduce CivilMCP as the name of the whole product.
- A later identifier migration requires its own ADR, additive rollout, data migration, compatibility window, and rollback verification.
