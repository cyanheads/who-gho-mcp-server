/**
 * @fileoverview Tests for the who_search_indicators tool.
 * @module tests/tools/who-search-indicators.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoSearchIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matching indicators', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [
        { indicatorCode: 'WHOSIS_000001', indicatorName: 'Life expectancy at birth (years)' },
      ],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'life expectancy', limit: 20 });
    const result = await whoSearchIndicators.handler(input, ctx);
    expect(result.indicators).toHaveLength(1);
    expect(result.totalMatches).toBe(1);
    expect(result.note).toBeUndefined();
  });

  it('includes truncation note when results exceed limit', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: Array.from({ length: 5 }, (_, i) => ({
        indicatorCode: `CODE_${i}`,
        indicatorName: `Indicator ${i}`,
      })),
      total: 50,
    });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'life', limit: 5 });
    const result = await whoSearchIndicators.handler(input, ctx);
    expect(result.note).toBeDefined();
    expect(result.note).toContain('50');
  });

  it('throws no_results when no indicators match', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'zzznomatch' });
    await expect(whoSearchIndicators.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_results' },
    });
  });

  it('formats output with codes and names', () => {
    const output = {
      indicators: [
        { indicatorCode: 'WHOSIS_000001', indicatorName: 'Life expectancy at birth (years)' },
      ],
      totalMatches: 1,
    };
    const blocks = whoSearchIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('Life expectancy');
    expect(text).toContain('1');
  });

  it('formats output with truncation note', () => {
    const output = {
      indicators: [{ indicatorCode: 'CODE_1', indicatorName: 'Indicator 1' }],
      totalMatches: 100,
      note: 'Showing 1 of 100 matches.',
    };
    const blocks = whoSearchIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Showing 1 of 100 matches');
  });
});
