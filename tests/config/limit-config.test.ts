/** Verify exported and dotenv configuration before schemas load, including Node startup. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'gho-limit-config-'));
const bundle = join(directory, 'probe.mjs');
beforeAll(() => {
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  execFileSync(
    'bun',
    [
      'build',
      'tests/config/schema-probe.ts',
      '--target=node',
      '--packages=external',
      '--outfile',
      bundle,
    ],
    { cwd: root },
  );
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function probe(dotenv: string, exported?: string, runtime = 'node') {
  writeFileSync(join(directory, '.env'), dotenv);
  const env = { ...process.env };
  delete env.GHO_CLAMP_LIMITS;
  if (exported !== undefined) env.GHO_CLAMP_LIMITS = exported;
  return spawnSync(runtime, [bundle], { cwd: directory, env, encoding: 'utf8', timeout: 10000 });
}

describe.each(['node', 'bun'])('%s configuration', (runtime) => {
  it.each([
    ['', undefined, true],
    ['GHO_CLAMP_LIMITS=false\n', undefined, false],
    ['GHO_CLAMP_LIMITS=false\n', 'true', true],
    ['GHO_CLAMP_LIMITS=true\n', 'false', false],
  ] as const)('constructs schemas from dotenv=%j exported=%j', (dotenv, exported, enabled) => {
    const result = probe(dotenv, exported, runtime);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.clampLimits).toBe(enabled);
    expect(output.accepts).toEqual(Array(6).fill(enabled));
    const ceilings = [100, 500, 500, 1000];
    for (const [index, ceiling] of ceilings.entries()) {
      expect(output.schemas[index].properties.limit.maximum).toBe(enabled ? undefined : ceiling);
    }
    expect(output.schemas[4].properties.indicator_codes.maxItems).toBe(enabled ? 1000 : 10);
    expect(output.resource.properties.limit.maximum).toBe(enabled ? undefined : 500);
  });

  it.each(['GHO_CLAMP_LIMITS=typo\n', 'GHO_REQUEST_TIMEOUT_MS=invalid\n'])(
    'rejects invalid server configuration %j at startup',
    (dotenv) => {
      const result = probe(dotenv, undefined, runtime);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(dotenv.split('=')[0]);
    },
  );
});
