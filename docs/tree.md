# who-gho-mcp-server - Directory Structure

Generated on: 2026-08-18 21:31:24

```text
who-gho-mcp-server/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   ├── CODE_OF_CONDUCT.md
│   ├── CONTRIBUTING.md
│   ├── FUNDING.yml
│   └── SECURITY.md
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   ├── 0.1.x/
│   ├── 0.2.x/
│   ├── 0.3.x/
│   └── template.md
├── docs/
│   ├── design.md
│   └── idea.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── release-github.ts
│   ├── split-changelog.ts
│   └── tree.ts
├── skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── src/
│   ├── config/
│   │   └── server-config.ts
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   ├── resources/
│   │   │   └── definitions/
│   │   │       ├── who-dimension-values.resource.ts
│   │   │       └── who-indicator-metadata.resource.ts
│   │   └── tools/
│   │       └── definitions/
│   │           ├── who-get-indicator-metadata.tool.ts
│   │           ├── who-list-dimension-values.tool.ts
│   │           ├── who-list-dimensions.tool.ts
│   │           ├── who-list-indicators.tool.ts
│   │           ├── who-query-indicator-data.tool.ts
│   │           └── who-search-indicators.tool.ts
│   ├── services/
│   │   └── gho/
│   │       ├── gho-service.ts
│   │       └── types.ts
│   ├── utils/
│   │   └── well-formed.ts
│   └── index.ts
├── tests/
│   ├── fuzz/
│   │   └── who-tools.fuzz.test.ts
│   ├── integration/
│   │   ├── gho-upstream.ts
│   │   ├── malformed-identifier.int.test.ts
│   │   ├── well-formed-echo.int.test.ts
│   │   ├── who-get-indicator-metadata.int.test.ts
│   │   ├── who-list-dimension-values.int.test.ts
│   │   ├── who-query-indicator-data.int.test.ts
│   │   └── who-search-indicators.int.test.ts
│   ├── prompts/
│   ├── resources/
│   │   ├── who-dimension-values-extended.resource.test.ts
│   │   ├── who-dimension-values.resource.test.ts
│   │   ├── who-indicator-metadata-extended.resource.test.ts
│   │   └── who-indicator-metadata.resource.test.ts
│   ├── services/
│   │   └── gho/
│   │       └── gho-service.test.ts
│   ├── smoke/
│   │   └── definitions.smoke.test.ts
│   ├── tools/
│   │   ├── who-get-indicator-metadata-extended.tool.test.ts
│   │   ├── who-get-indicator-metadata.tool.test.ts
│   │   ├── who-list-dimension-values-extended.tool.test.ts
│   │   ├── who-list-dimension-values.tool.test.ts
│   │   ├── who-list-dimensions-extended.tool.test.ts
│   │   ├── who-list-dimensions.tool.test.ts
│   │   ├── who-list-indicators-extended.tool.test.ts
│   │   ├── who-list-indicators.tool.test.ts
│   │   ├── who-query-indicator-data-extended.tool.test.ts
│   │   ├── who-query-indicator-data.tool.test.ts
│   │   ├── who-search-indicators-extended.tool.test.ts
│   │   └── who-search-indicators.tool.test.ts
│   ├── utils/
│   │   └── well-formed.test.ts
│   └── serialized-frame.ts
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── .mcpbignore
├── biome.json
├── bun.lock
├── bunfig.toml
├── CHANGELOG.md
├── CITATION.cff
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── LICENSE
├── manifest.json
├── package.json
├── README.md
├── server.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
