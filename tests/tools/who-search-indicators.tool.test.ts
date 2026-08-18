/**
 * @fileoverview Tests for the who_search_indicators tool.
 * @module tests/tools/who-search-indicators.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns matching indicators with enrichment', async () => {
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

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1);
    expect(enrichment.effectiveQuery).toBe('life expectancy');
    expect(enrichment.notice).toBeUndefined();
  });

  it('sets truncation notice in enrichment when results exceed limit', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: Array.from({ length: 5 }, (_, i) => ({
        indicatorCode: `CODE_${i}`,
        indicatorName: `Indicator ${i}`,
      })),
      total: 50,
    });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'life', limit: 5 });
    await whoSearchIndicators.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(50);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('50');
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
    };
    const blocks = whoSearchIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('Life expectancy');
  });
});

describe('whoSearchIndicators — offset paging (#10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const page = (start: number, size: number) =>
    Array.from({ length: size }, (_, i) => ({
      indicatorCode: `CODE_${start + i}`,
      indicatorName: `Indicator ${start + i}`,
    }));

  it('defaults offset to 0 and reproduces today single-page behavior', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: page(0, 1), total: 1 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'life' });
    await whoSearchIndicators.handler(input, ctx);

    expect(mockService.listIndicators).toHaveBeenCalledWith(
      { query: 'life', limit: 20, offset: 0 },
      ctx,
    );
    const enrichment = getEnrichment(ctx);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toBeUndefined();
  });

  it('threads a non-zero offset into the shared listIndicators call', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: page(2, 2), total: 31 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'mortality', limit: 2, offset: 2 });
    await whoSearchIndicators.handler(input, ctx);

    expect(mockService.listIndicators).toHaveBeenCalledWith(
      { query: 'mortality', limit: 2, offset: 2 },
      ctx,
    );
    const enrichment = getEnrichment(ctx);
    expect(enrichment.offset).toBe(2);
    expect(enrichment.hasMore).toBe(true);
    expect(enrichment.nextOffset).toBe(4);
    expect(enrichment.pageInfo).toBe('offset 2, showing 2 of 31');
    expect(enrichment.nextOffset as number).toBeLessThan(enrichment.totalCount as number);
  });

  it('returns disjoint indicator sets across two pages with totalCount unchanged', async () => {
    const ctxA = createMockContext({ errors: whoSearchIndicators.errors });
    mockService.listIndicators.mockResolvedValue({ indicators: page(0, 2), total: 31 });
    const first = await whoSearchIndicators.handler(
      whoSearchIndicators.input.parse({ query: 'mortality', limit: 2 }),
      ctxA,
    );

    const ctxB = createMockContext({ errors: whoSearchIndicators.errors });
    mockService.listIndicators.mockResolvedValue({ indicators: page(2, 2), total: 31 });
    const second = await whoSearchIndicators.handler(
      whoSearchIndicators.input.parse({
        query: 'mortality',
        limit: 2,
        offset: getEnrichment(ctxA).nextOffset as number,
      }),
      ctxB,
    );

    const firstCodes = first.indicators.map((i) => i.indicatorCode);
    const secondCodes = second.indicators.map((i) => i.indicatorCode);
    expect(firstCodes.some((c) => secondCodes.includes(c))).toBe(false);
    expect(getEnrichment(ctxA).totalCount).toBe(getEnrichment(ctxB).totalCount);
  });

  it('returns an empty page (not no_results) when the offset runs past the end', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 31 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'mortality', offset: 100 });
    const result = await whoSearchIndicators.handler(input, ctx);

    expect(result.indicators).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toContain('31 indicators');
    expect(enrichment.notice).toContain('last reachable offset is 30');
    // format() only ever sees the domain payload — the page disclosure lives in the notice.
    const text = (whoSearchIndicators.format!(result as never)[0] as { type: 'text'; text: string })
      .text;
    expect(text).toContain('showing 0');
  });

  it('treats an offset exactly equal to totalCount as past the end', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 31 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'mortality', offset: 31 });
    await expect(whoSearchIndicators.handler(input, ctx)).resolves.toMatchObject({
      indicators: [],
    });
    expect(getEnrichment(ctx).notice).toContain('last reachable offset is 30');
  });

  it('still throws no_results when the query matched nothing at all', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoSearchIndicators.errors });
    const input = whoSearchIndicators.input.parse({ query: 'zzznomatch', offset: 100 });
    await expect(whoSearchIndicators.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_results' },
    });
  });
});
