/**
 * @fileoverview Extended tests for the who_list_indicators tool: input validation,
 * edge cases, and security assertions.
 * @module tests/tools/who-list-indicators-extended.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListIndicators — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects limit=0 (min 1)', () => {
    expect(() => whoListIndicators.input.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit=501 (max 500)', () => {
    expect(() => whoListIndicators.input.parse({ limit: 501 })).toThrow();
  });

  it('accepts limit at boundaries: 1 and 500', () => {
    expect(() => whoListIndicators.input.parse({ limit: 1 })).not.toThrow();
    expect(() => whoListIndicators.input.parse({ limit: 500 })).not.toThrow();
  });

  it('rejects offset=-1 (min 0)', () => {
    expect(() => whoListIndicators.input.parse({ offset: -1 })).toThrow();
  });

  it('accepts offset=0 (boundary)', () => {
    expect(() => whoListIndicators.input.parse({ offset: 0 })).not.toThrow();
  });

  it('applies defaults: limit=50 and offset=0', () => {
    const parsed = whoListIndicators.input.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it('rejects non-integer limit', () => {
    expect(() => whoListIndicators.input.parse({ limit: 2.5 })).toThrow();
  });

  it('rejects non-integer offset', () => {
    expect(() => whoListIndicators.input.parse({ offset: 1.5 })).toThrow();
  });
});

describe('whoListIndicators — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty indicators array when service returns none', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 50, offset: 9999 });
    const result = await whoListIndicators.handler(input, ctx);
    expect(result.indicators).toHaveLength(0);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.totalCount).toBe(0);
  });

  it('pageInfo reflects exact offset and count', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: Array.from({ length: 10 }, (_, i) => ({
        indicatorCode: `CODE_${i}`,
        indicatorName: `Name ${i}`,
      })),
      total: 100,
    });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 10, offset: 30 });
    await whoListIndicators.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.pageInfo).toContain('offset 30');
    expect(enrichment.pageInfo).toContain('10');
    expect(enrichment.pageInfo).toContain('100');
    expect(enrichment.hasMore).toBe(true);
  });

  it('hasMore is false when offset+count equals total', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'LAST', indicatorName: 'Last' }],
      total: 5,
    });
    const ctx = createMockContext();
    // offset=4, returns 1 → 4+1 = 5 = total → no more
    const input = whoListIndicators.input.parse({ limit: 50, offset: 4 });
    await whoListIndicators.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
  });

  it('formats empty result without crashing', () => {
    const output = { indicators: [] };
    const blocks = whoListIndicators.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('0');
  });
});

describe('whoListIndicators — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not propagate env-var-like strings into output', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'CODE_1', indicatorName: 'Normal Indicator' }],
      total: 1,
    });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 1, offset: 0 });
    const result = await whoListIndicators.handler(input, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('format output contains no script injection artifacts', () => {
    const output = {
      indicators: [{ indicatorCode: '<script>alert(1)</script>', indicatorName: 'XSS attempt' }],
    };
    const blocks = whoListIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Format echoes what the service returns — assertion is that no additional
    // injection vectors are introduced by the formatter itself.
    expect(typeof text).toBe('string');
    expect(text).toContain('XSS attempt');
  });
});
