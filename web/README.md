# Seedy Research Web

The Next.js application for Research Cases, Explore, the full-paper reader,
Workspace, Notebook, Chat, Research Path, and browser-native SeedyMCP tools.

Start with the [root README](../README.md). It separates the credential-free
fixture gate from a live research environment.

- [Local setup and deployment](../docs/OPERATIONS.md)
- [Test scopes and commands](../docs/HARNESS.md)
- [Application boundaries](../docs/ARCHITECTURE.md)

Use `npm ci` to install the locked dependencies. Next.js reads web-local env
files; it does not automatically load the repository-root `.env`. Follow the
explicit environment-loading steps in Operations. Provider and service-role
keys are server-only and must never use the `NEXT_PUBLIC_*` prefix.
