/**
 * @fileoverview Keep MCP skill protocol runtime modules while stripping dependency agent documentation.
 * @module tests/scripts/mcpb-skills
 */
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';
import { checkBundleEntries } from '../../scripts/lint-packaging.js';

describe('MCPB skill runtime entries', () => {
  it('retains the SDK extension runtime and the published guide', () => {
    const entries = [
      'skills/who-gho-guide/SKILL.md',
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
      'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
      'node_modules/parent/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.cjs',
      'node_modules/other/dist/ext/skills/runtime.js',
      'node_modules/@scope/other/lib/skills/runtime.js',
      'node_modules/parent/node_modules/nested/lib/.agents/runtime.js',
    ];
    expect(filterAgentDocEntries(entries)).toEqual([]);
    expect(checkBundleEntries(entries, 'test.mcpb')).toEqual([]);
  });

  it('still removes dependency development skills and agent documentation', () => {
    const entries = [
      'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
      'node_modules/dependency/skills/guide/SKILL.md',
      'node_modules/dependency/.claude/settings.json',
      'node_modules/dependency/.agents/instructions.md',
      'node_modules/dependency/SKILL.md',
      'node_modules/@scope/dependency/skills/guide/SKILL.md',
      'node_modules/parent/node_modules/@scope/dependency/skills/guide/SKILL.md',
      'node_modules/@scope/parent/node_modules/nested/.agents/instructions.md',
    ];
    expect(filterAgentDocEntries(entries)).toEqual(entries);
    expect(checkBundleEntries(entries, 'test.mcpb')).not.toEqual([]);
  });

  it('matches archive paths with bounded CPU growth', () => {
    const checkCpu = (cpuUs: number, firstCpuUs: number) => {
      expect(cpuUs).toBeLessThan(250_000);
      expect(cpuUs / firstCpuUs).toBeLessThan(256);
    };
    expect(() => checkCpu(250_001, 100_000)).toThrow();
    expect(() => checkCpu(256, 1)).toThrow();
    const cpuTimes: number[] = [];
    for (const size of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000]) {
      const inputs = [
        `node_modules/${'@scope/package/node_modules/'.repeat(Math.ceil(size / 28))}runtime.js`,
        `node_modules/${'a'.repeat(size)}\n`,
        `node_modules/${'skills/\n'.repeat(Math.ceil(size / 8))}runtime.js`,
      ];
      for (let i = 0; i < 4; i++) for (const input of inputs) AGENT_DOC_ENTRY.test(input);
      const start = process.threadCpuUsage();
      for (let i = 0; i < 32; i++) for (const input of inputs) AGENT_DOC_ENTRY.test(input);
      const elapsed = process.threadCpuUsage(start);
      const cpuUs = elapsed.user + elapsed.system;
      checkCpu(cpuUs, cpuTimes[0] ?? cpuUs);
      cpuTimes.push(cpuUs);
    }
    console.info('archive matcher CPU microseconds:', cpuTimes);
  });
});
