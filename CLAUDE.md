# Agent Protocol

**Server:** @cyanheads/who-gho-mcp-server
**Version:** 0.1.14
**Framework:** [@cyanheads/mcp-ts-core](https://www.npmjs.com/package/@cyanheads/mcp-ts-core) `^0.10.9`
**Engines:** Bun ≥1.3.2, Node ≥24.0.0

> **Read the framework docs first:** `node_modules/@cyanheads/mcp-ts-core/CLAUDE.md` contains the full API reference — builders, Context, error codes, exports, patterns. This file covers server-specific conventions only.

---

## What's Next?

When the user asks what to do next, what's left, or needs direction, suggest relevant options based on the current project state:

1. **Re-run the `setup` skill** — ensures CLAUDE.md, skills, structure, and metadata are populated and up to date with the current codebase
2. **Run the `design-mcp-server` skill** — if the tool/resource surface hasn't been mapped yet, work through domain design
3. **Add tools/resources/prompts** — scaffold new definitions using the `add-tool`, `add-app-tool`, `add-resource`, `add-prompt` skills
4. **Add services** — scaffold domain service integrations using the `add-service` skill
5. **Add tests** — scaffold tests for existing definitions using the `add-test` skill
6. **Field-test definitions** — exercise tools/resources/prompts with real inputs using the `field-test` skill, get a report of issues and pain points
7. **Run `devcheck`** — lint, format, typecheck, and security audit
8. **Run the `security-pass` skill** — audit handlers for MCP-specific security gaps: output injection, scope blast radius, input sinks, tenant isolation
9. **Run the `polish-docs-meta` skill** — finalize README, CHANGELOG, metadata, and agent protocol for shipping
10. **Run the `maintenance` skill** — investigate changelogs, adopt upstream changes, and sync skills after `bun update --latest`

Tailor suggestions to what's actually missing or stale — don't recite the full list every time.

---

## Core Rules

- **Logic throws, framework catches.** Tool/resource handlers are pure — throw on failure, no `try/catch`. Plain `Error` is fine; the framework catches, classifies, and formats. Use error factories (`notFound()`, `validationError()`, etc.) when the error code matters.
- **Use `ctx.log`** for request-scoped logging. No `console` calls.
- **Use `ctx.state`** for tenant-scoped storage. Never access persistence directly.
- **Check `ctx.elicit`** for presence before calling (`if (ctx.elicit) { ... }`) — wired when the client advertised elicitation capability, `undefined` otherwise.
- **Secrets in env vars only** — never hardcoded.
- **Close the loop on issues.** When implementing work tracked by a GitHub issue, comment on the issue with what landed and close it. Do both — a comment without a close leaves stale issues open; a close without a comment leaves no record of what shipped. The comment is for future readers — state the concrete changes, not the conversation that produced them.

---

## Patterns

### Tool

```ts
import { tool, z } from '@cyanheads/mcp-ts-core';

export const searchItems = tool('search_items', {
  description: 'Search inventory items by query.',
  annotations: { readOnlyHint: true },
  input: z.object({
    query: z.string().describe('Search terms'),
    limit: z.number().default(10).describe('Max results'),
  }),
  output: z.object({
    items: z.array(z.object({
      id: z.string().describe('Item ID'),
      name: z.string().describe('Item name'),
    })).describe('Matching items'),
  }),
  auth: ['inventory:read'],

  async handler(input, ctx) {
    const items = await findItems(input.query, input.limit);
    ctx.log.info('Search completed', { query: input.query, count: items.length });
    return { items };
  },

  // format() populates content[] — the markdown twin of structuredContent.
  // Different clients read different surfaces (Claude Code → structuredContent,
  // Claude Desktop → content[]); both must carry the same data.
  // Enforced at lint time: every field in `output` must appear in the rendered text.
  format: (result) => [{
    type: 'text',
    text: result.items.map(i => `**${i.id}**: ${i.name}`).join('\n'),
  }],
});
```

### Resource

```ts
import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';

export const itemData = resource('inventory://{itemId}', {
  description: 'Fetch an inventory item by ID.',
  params: z.object({ itemId: z.string().describe('Item identifier') }),
  auth: ['inventory:read'],
  async handler(params, ctx) {
    const item = await ctx.state.get(`item:${params.itemId}`);
    if (!item) throw notFound(`Item ${params.itemId} not found`, { itemId: params.itemId });
    return item;
  },
});
```

### Prompt

```ts
import { prompt, z } from '@cyanheads/mcp-ts-core';

export const reviewCode = prompt('review_code', {
  description: 'Review code for issues and best practices.',
  args: z.object({
    code: z.string().describe('Code to review'),
    language: z.string().optional().describe('Programming language'),
  }),
  generate: (args) => [
    { role: 'user', content: { type: 'text', text: `Review this ${args.language ?? ''} code:\n${args.code}` } },
  ],
});
```

### Server config

```ts
// src/config/server-config.ts — lazy-parsed, separate from framework config
import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z.string().describe('External API key'),
  maxResults: z.coerce.number().default(100),
});

let _config: z.infer<typeof ServerConfigSchema> | undefined;
export function getServerConfig() {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'MY_API_KEY',
    maxResults: 'MY_MAX_RESULTS',
  });
  return _config;
}
```

`parseEnvConfig` maps Zod schema paths → env var names so errors name the variable (`MY_API_KEY`) not the path (`apiKey`). Throws `ConfigurationError`, which the framework prints as a clean startup banner.

For env booleans use `z.stringbool()`, never `z.coerce.boolean()` — `Boolean("false")` is `true`, so a coerced flag can't be disabled through the environment. `z.stringbool()` parses `true/false/1/0/yes/no/on/off` and rejects anything else.

### Server identity and instructions

`createApp()` accepts optional identity fields forwarded to the SDK's `initialize` response and the server manifest:

```ts
await createApp({
  name: 'who-gho-mcp-server',    // unscoped package name — required for devcheck identity check
  title: 'who-gho-mcp-server',   // same as name — display identity on every surface
  instructions: 'WHO Global Health Observatory MCP server. Primary workflow: ...',
});
```

`instructions` — optional server-level orientation, sent on every `initialize` as session-level context. Use it for deployment guidance (connection aliases, regional notes, scope hints) instead of repeating the same context across tool descriptions.

---

## Context

Handlers receive a unified `ctx` object. Key properties:

| Property | Description |
|:---------|:------------|
| `ctx.log` | Request-scoped logger — `.debug()`, `.info()`, `.notice()`, `.warning()`, `.error()`. Auto-correlates requestId, traceId, tenantId. |
| `ctx.state` | Tenant-scoped KV — `.get(key)`, `.set(key, value, { ttl? })`, `.delete(key)`, `.list(prefix, { cursor, limit })`. Accepts any serializable value. |
| `ctx.elicit` | Ask user for structured input — form call `(message, schema)` or `.url(message, url)` for an external link. **Check for presence first:** `if (ctx.elicit) { ... }` |
| `ctx.signal` | `AbortSignal` for cancellation. |
| `ctx.progress` | Task progress (present when `task: true`) — `.setTotal(n)`, `.increment()`, `.update(message)`. |
| `ctx.requestId` | Unique request ID. |
| `ctx.tenantId` | Tenant ID from JWT or `'default'` for stdio. |

---

## Errors

Handlers throw — the framework catches, classifies, and formats.

**Recommended: typed error contract.** Declare `errors: [{ reason, code, when, recovery, retryable? }]` on `tool()` / `resource()` to receive `ctx.fail(reason, …)` typed against the reason union. TypeScript catches typos at compile time, `data.reason` is auto-populated for observability, linter enforces conformance against the handler body. `recovery` is required descriptive metadata for the agent's next move (≥ 5 words, lint-validated); for the wire `data.recovery.hint` (mirrored into `content[]` text), pass explicitly at the throw site when dynamic context matters: `ctx.fail('reason', msg, { recovery: { hint: '...' } })`. Baseline codes (`InternalError`, `ServiceUnavailable`, `Timeout`, `ValidationError`, `SerializationError`) bubble freely and don't need declaring.

```ts
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';

errors: [
  { reason: 'no_match', code: JsonRpcErrorCode.NotFound,
    when: 'No item matched the query',
    recovery: 'Broaden the query or check the spelling and try again.' },
],
async handler(input, ctx) {
  const item = await db.find(input.id);
  if (!item) throw ctx.fail('no_match', `No item ${input.id}`);
  return item;
}
```

**Declare contracts inline on each tool.** The contract is part of the tool's public surface — one file should give the full picture. Don't extract a shared `errors[]` constant; per-tool repetition is the intended cost of locality.

**Fallback (no contract entry fits):** throw via factories or plain `Error`.

```ts
// Error factories — explicit code
import { notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
throw notFound('Item not found', { itemId });
throw serviceUnavailable('API unavailable', { url }, { cause: err });

// Plain Error — framework auto-classifies from message patterns
throw new Error('Item not found');           // → NotFound
throw new Error('Invalid query format');     // → ValidationError

// McpError — when no factory exists for the code
import { McpError, JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
throw new McpError(JsonRpcErrorCode.DatabaseError, 'Connection failed', { pool: 'primary' });
```

See framework CLAUDE.md and the `api-errors` skill for the full auto-classification table, all available factories, and the contract reference.

---

## Structure

```text
src/
  index.ts                              # createApp() entry point
  config/
    server-config.ts                    # Server-specific env vars (Zod schema)
  services/
    [domain]/
      [domain]-service.ts               # Domain service (init/accessor pattern)
      types.ts                          # Domain types
  mcp-server/
    tools/definitions/
      [tool-name].tool.ts               # Tool definitions
    resources/definitions/
      [resource-name].resource.ts       # Resource definitions
    prompts/definitions/
      [prompt-name].prompt.ts           # Prompt definitions
```

---

## Naming

| What | Convention | Example |
|:-----|:-----------|:--------|
| Files | kebab-case with suffix | `search-docs.tool.ts` |
| Tool/resource/prompt names | snake_case | `search_docs` |
| Directories | kebab-case | `src/services/doc-search/` |
| Descriptions | Single string or template literal, no `+` concatenation | `'Search items by query and filter.'` |

---

## Skills

Skills are modular instructions in `skills/` at the project root. Read them directly when a task matches — e.g., `skills/add-tool/SKILL.md` when adding a tool.

**Agent skill directory:** Copy skills into the directory your agent discovers (Claude Code: `.claude/skills/`, others: equivalent). Skills then load as context without referencing `skills/` paths. After framework updates, run the `maintenance` skill — Phase B re-syncs the agent directory.

Available skills:

| Skill | Purpose |
|:------|:--------|
| `setup` | Post-init project orientation |
| `design-mcp-server` | Design tool surface, resources, and services for a new server |
| `add-tool` | Scaffold a new tool definition |
| `add-app-tool` | Scaffold an MCP App tool + paired UI resource |
| `add-resource` | Scaffold a new resource definition |
| `add-prompt` | Scaffold a new prompt definition |
| `add-service` | Scaffold a new service integration |
| `add-test` | Scaffold test file for a tool, resource, or service |
| `field-test` | Exercise tools/resources/prompts with real inputs, verify behavior, report issues |
| `tool-defs-analysis` | Read-only audit of MCP definition language across the surface — voice, leaks, defaults, recovery hints, output descriptions |
| `security-pass` | Audit server for MCP-flavored security gaps: output injection, scope blast radius, input sinks, tenant isolation |
| `code-simplifier` | Post-session cleanup against `git diff` — modernize syntax, consolidate duplication, align with the codebase |
| `devcheck` | Lint, format, typecheck, audit |
| `polish-docs-meta` | Finalize docs, README, metadata, and agent protocol for shipping |
| `maintenance` | Investigate changelogs, adopt upstream changes, sync skills to agent dirs |
| `git-wrapup` | Land working-tree changes as a versioned commit + annotated tag — version bump, changelog, verify, tag. Local only. |
| `release-and-publish` | Push + npm + MCP Registry + GH Release + Docker. Picks up from `git-wrapup` |
| `report-issue-framework` | File bug/feature request against @cyanheads/mcp-ts-core |
| `report-issue-local` | File bug/feature request against this server's repo |
| `api-auth` | Auth modes, scopes, JWT/OAuth |
| `api-canvas` | DataCanvas: register tabular data, run SQL, export, plus the `spillover()` helper for big result sets — Tier 3 opt-in |
| `api-config` | AppConfig, parseConfig, env vars |
| `api-context` | Context interface, logger, state, progress |
| `api-errors` | McpError, JsonRpcErrorCode, error patterns |
| `api-linter` | Definition linter rule catalog — invoked by `bun run lint:mcp` and `devcheck` |
| `api-mirror` | MirrorService: persistent embedded-SQLite mirror of a bulk upstream dataset (FTS5, sync state machine, Bun/Node) |
| `api-services` | LLM, Speech, Graph services |
| `api-telemetry` | OTel catalog: spans, metrics, completion logs, env config, cardinality rules |
| `api-testing` | createMockContext, test patterns |
| `api-utils` | Formatting, parsing, security, pagination, scheduling, telemetry helpers |
| `api-workers` | Cloudflare Workers runtime |
| `orchestrations` | Multi-phase pipeline workflows for fleet-scale operations across N servers |

When you complete a skill's checklist, check the boxes and add a completion timestamp at the end (e.g., `Completed: 2026-03-11`).

---

## Commands

| Command | Purpose |
|:--------|:--------|
| `bun run build` | Compile TypeScript |
| `bun run rebuild` | Clean + build |
| `bun run clean` | Remove build artifacts |
| `bun run devcheck` | Lint + format + typecheck + security + packaging alignment |
| `bun run audit:refresh` | Delete `bun.lock`, reinstall, and re-run `bun audit`. Use when `devcheck` flags a transitive advisory — `bun update` is sticky on transitive resolutions, so the advisory may be a stale-lockfile false positive. If it survives the refresh, it's real. |
| `bun run tree` | Generate directory structure doc |
| `bun run format` | Auto-fix formatting |
| `bun run test` | Run tests |
| `bun run lint:mcp` | Validate MCP definitions against spec |
| `bun run lint:packaging` | Validate env var alignment between `manifest.json` and `server.json` (skipped cleanly when `manifest.json` is absent) |
| `bun run list-skills` | List skills in `skills/` with name + description |
| `bun run bundle` | Build and pack as `dist/who-gho-mcp-server.mcpb` for one-click Claude Desktop install |
| `bun run release:github` | Create or repair the GitHub Release for the current version tag |
| `bun run start:stdio` | Production mode (stdio) |
| `bun run start:http` | Production mode (HTTP) |

---

## Bundling

`bun run bundle` produces `dist/who-gho-mcp-server.mcpb` for one-click install in Claude Desktop. MCPB is stdio-only — HTTP and Docker deployments are unaffected. The `release-and-publish` skill attaches the bundle to the GitHub Release at a stable `releases/latest/download/who-gho-mcp-server.mcpb` URL that powers the README install badge.

**Adding an env var requires both files**: `server.json` stdio `environmentVariables[]` (registry discovery) and `manifest.json` `mcp_config.env` (bundle install UX, plus `user_config` if user-prompted). `bun run lint:packaging` (run by `devcheck`) verifies the env var names align.

---

## Publishing

Run the `release-and-publish` skill after git wrapup — it runs the verification gate (`devcheck`, `rebuild`, `test`), pushes commits and tags, and publishes to npm, the MCP Registry, GHCR, and attaches the `.mcpb` bundle to the GitHub Release, halting on the first failure. For reference, the underlying commands are:

```bash
bun publish --access public

docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/cyanheads/who-gho-mcp-server:<version> \
  -t ghcr.io/cyanheads/who-gho-mcp-server:latest \
  --push .

mcp-publisher publish
```

---

## Changelog

Directory-based, grouped by minor series via the `.x` semver-wildcard convention. Source of truth: `changelog/<major.minor>.x/<version>.md` (e.g. `changelog/0.1.x/0.1.0.md`) — one file per release, shipped in the npm package. At release, author the per-version file with a concrete version and date, then run `bun run changelog:build` to regenerate the rollup. `changelog/template.md` is a **pristine format reference** — never edited or moved; read it for the frontmatter + section layout when scaffolding. `CHANGELOG.md` is a **navigation index** (header + link + summary per version), regenerated by `bun run changelog:build` — devcheck hard-fails on drift; never hand-edit it.

Each per-version file opens with YAML frontmatter:

```markdown
---
summary: "One-line headline, ≤350 chars"  # required — powers the rollup index
breaking: false                            # optional — true flags breaking changes
security: false                            # optional — true flags security fixes
---

# 0.1.0 — YYYY-MM-DD
...
```

`breaking: true` renders a `· ⚠️ Breaking` badge — use it when consumers must update code on upgrade (signature changes, removed APIs, config renames). `security: true` renders a `· 🛡️ Security` badge and pairs with a `## Security` body section. When both are set, badges render `· ⚠️ Breaking · 🛡️ Security`.

**Section order** (Keep a Changelog): Added, Changed, Deprecated, Removed, Fixed, Security. Include only sections with entries — don't ship empty headers.

**Tag annotations** render as GitHub Release bodies via `--notes-from-tag`. They must be structured markdown — never a flat comma-separated string. Subject omits the version number (GitHub prepends it). See `changelog/template.md` for the full format reference.

---

## Imports

```ts
// Framework — z is re-exported, no separate zod import needed
import { tool, z } from '@cyanheads/mcp-ts-core';
import { McpError, JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';

// Server's own code — via path alias
import { getMyService } from '@/services/my-domain/my-service.js';
```

---

## Checklist

- [ ] Zod schemas: all fields have `.describe()`, only JSON-Schema-serializable types (no `z.custom()`, `z.date()`, `z.transform()`, `z.bigint()`, `z.symbol()`, `z.void()`, `z.map()`, `z.set()`, `z.function()`, `z.nan()`)
- [ ] Optional nested objects: handler guards for empty inner values from form-based clients (`if (input.obj?.field && ...)`, not just `if (input.obj)`). When regex/length constraints matter, use `z.union([z.literal(''), z.string().regex(...).describe(...)])` — literal variants are exempt from `describe-on-fields`.
- [ ] JSDoc `@fileoverview` + `@module` on every file
- [ ] `ctx.log` for logging, `ctx.state` for storage
- [ ] Handlers throw on failure — error factories or plain `Error`, no try/catch
- [ ] `format()` renders all data the LLM needs — different clients forward different surfaces (Claude Code → `structuredContent`, Claude Desktop → `content[]`); both must carry the same data
- [ ] If wrapping external API: raw/domain/output schemas reviewed against real upstream sparsity/nullability before finalizing required vs optional fields
- [ ] If wrapping external API: normalization and `format()` preserve uncertainty; do not fabricate facts from missing upstream data
- [ ] If wrapping external API: tests include at least one sparse payload case with omitted upstream fields
- [ ] Registered in `createApp()` arrays (directly or via barrel exports)
- [ ] Tests use `createMockContext()` from `@cyanheads/mcp-ts-core/testing`
- [ ] `.codex-plugin/plugin.json` populated — `name`, `version`, `description`, `repository`, `license` from `package.json`; `interface.displayName` = package name; `interface.shortDescription` from `package.json` description
- [ ] `.codex-plugin/mcp.json` updated — server name key matches `package.json` name; env vars added for any required API keys
- [ ] `.claude-plugin/plugin.json` populated — `name`, `version`, `description`, `repository`, `license` from `package.json`; inline `mcpServers` entry with server name key, env vars for any required API keys
- [ ] `bun run devcheck` passes
