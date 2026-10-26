/** Shared limit boundary validation and exactly-once clamp telemetry. */
import { z } from '@cyanheads/mcp-ts-core';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import * as config from '@/config/server-config.js';
import { applyReadLimit, readLimitSchema } from '@/utils/read-limit.js';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@cyanheads/mcp-ts-core/utils', async (original) => ({
  ...(await original<typeof import('@cyanheads/mcp-ts-core/utils')>()),
  createCounter: () => ({ add }),
}));
beforeEach(() => vi.clearAllMocks());

it.each([true, false])(
  'preserves invalid lower/fractional boundaries in clamp mode %s',
  (clampLimits) => {
    vi.spyOn(config, 'getServerConfig').mockReturnValue({
      clampLimits,
      baseUrl: 'https://example.test/',
      requestTimeoutMs: 30000,
    });
    for (const coerce of [false, true]) {
      const schema = readLimitSchema(100, coerce);
      for (const value of [0, -1, 1.5, Infinity, NaN])
        expect(schema.safeParse(coerce ? String(value) : value).success).toBe(false);
      expect(schema.parse(coerce ? '100' : 100)).toBe(100);
      expect(schema.safeParse(coerce ? '101' : 101).success).toBe(clampLimits);
      expect(z.toJSONSchema(schema).maximum).toBe(clampLimits ? undefined : 100);
    }
  },
);

it.each([
  [1, 1, 0],
  [100, 100, 0],
  [101, 100, 1],
])(
  'emits exactly one log and counter only when %s exceeds the ceiling',
  (requested, applied, emissions) => {
    const ctx = createMockContext();
    const log = vi.spyOn(ctx.log, 'notice');
    const result = applyReadLimit(requested, 100, 'test_read', ctx);
    expect(result.limit).toBe(applied);
    expect(log).toHaveBeenCalledTimes(emissions);
    expect(add).toHaveBeenCalledTimes(emissions);
    if (requested > 100) {
      expect(add).toHaveBeenCalledWith(1, { operation: 'test_read' });
      expect(result.notice).toBe('Requested limit 101; applied limit 100.');
    } else expect(result.notice).toBeUndefined();
  },
);
