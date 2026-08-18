/**
 * @fileoverview Tests for the who_list_dimension_values tool.
 * @module tests/tools/who-list-dimension-values.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

/** The service returns one page plus the unpaged total. */
const page = <T>(values: T[], total = values.length) => ({ values, total });

describe('whoListDimensionValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dimension values for a known dimension', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([
        { code: 'AFR', label: 'African Region' },
        { code: 'EUR', label: 'European Region' },
      ]),
    );
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'REGION' });
    const result = await whoListDimensionValues.handler(input, ctx);
    expect(result.dimension).toBe('REGION');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toMatchObject({ code: 'AFR', label: 'African Region' });

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(2);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toBeUndefined();
  });

  it('throws dimension_not_found when an unfiltered call returns nothing', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'UNKNOWNDIM' });
    await expect(whoListDimensionValues.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'dimension_not_found' },
    });
  });

  it('passes limit and offset through and reports the next page', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'AGO', label: 'Angola' }], 234),
    );
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({
      dimension: 'COUNTRY',
      limit: 1,
      offset: 2,
    });
    await whoListDimensionValues.handler(input, ctx);

    expect(mockService.listDimensionValues).toHaveBeenCalledWith(
      { dimensionCode: 'COUNTRY', limit: 1, offset: 2 },
      expect.anything(),
    );
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(234);
    expect(enrichment.offset).toBe(2);
    expect(enrichment.hasMore).toBe(true);
    expect(enrichment.nextOffset).toBe(3);
    expect(enrichment.pageInfo).toBe('offset 2, showing 1 of 234');
    expect(enrichment.notice).toContain('offset 3');
  });

  it('forwards parent_code to the service as a parentCode filter', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'ALB', label: 'Albania', parentCode: 'EUR' }], 58),
    );
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({
      dimension: 'COUNTRY',
      parent_code: 'EUR',
      limit: 1,
    });
    const result = await whoListDimensionValues.handler(input, ctx);

    expect(mockService.listDimensionValues).toHaveBeenCalledWith(
      { dimensionCode: 'COUNTRY', limit: 1, offset: 0, parentCode: 'EUR' },
      expect.anything(),
    );
    expect(result.values[0]?.parentCode).toBe('EUR');
    expect(getEnrichment(ctx).totalCount).toBe(58);
  });

  it('returns an empty page when parent_code matches nothing, not dimension_not_found', async () => {
    // An unknown dimension and a valid dimension whose filter matched nothing are both
    // HTTP 200 with value: [] upstream. Only the unfiltered case may claim non-existence.
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({
      dimension: 'COUNTRY',
      parent_code: 'NOSUCHREGION',
    });
    const result = await whoListDimensionValues.handler(input, ctx);

    expect(result.values).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toContain('NOSUCHREGION');
    expect(enrichment.notice).toContain('parent_code');
  });

  it('returns an empty page when offset lands exactly on the total', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([], 234));
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'COUNTRY', offset: 234 });
    const result = await whoListDimensionValues.handler(input, ctx);

    // The bound is `offset >= total`: offset 234 over 234 values is already past the end.
    expect(result.values).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toContain('234');
    expect(enrichment.notice).toContain('last reachable offset is 233');
  });

  it('returns an empty page when offset runs past the total', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([], 234));
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'COUNTRY', offset: 900 });
    const result = await whoListDimensionValues.handler(input, ctx);

    expect(result.values).toEqual([]);
    expect(getEnrichment(ctx).notice).toContain('last reachable offset is 233');
  });

  it('carries the page on both consumption surfaces', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'JPN', label: 'Japan', parentCode: 'WPR' }], 234),
    );
    const result = await runToolContract(whoListDimensionValues, {
      dimension: 'COUNTRY',
      limit: 1,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      values: { code: string }[];
      totalCount: number;
      hasMore: boolean;
      nextOffset?: number;
    };
    expect(structured.values[0]?.code).toBe('JPN');
    expect(structured.totalCount).toBe(234);
    expect(structured.hasMore).toBe(true);
    expect(structured.nextOffset).toBe(1);
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(text).toContain('JPN');
    expect(text).toContain('234');
  });

  it('formats output with all value fields', () => {
    const output = {
      dimension: 'REGION',
      values: [
        {
          code: 'AFR',
          label: 'African Region',
          parentCode: 'ROOT',
          parentLabel: 'Global',
          parentDimension: 'GLOBAL',
        },
      ],
    };
    const blocks = whoListDimensionValues.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('AFR');
    expect(text).toContain('African Region');
    expect(text).toContain('parentCode=ROOT');
    expect(text).toContain('parentLabel=Global');
    expect(text).toContain('parentDimension=GLOBAL');
  });

  it('formats sparse dimension values without parent fields', () => {
    const output = {
      dimension: 'SEX',
      values: [{ code: 'SEX_BTSX', label: 'Both sexes' }],
    };
    const blocks = whoListDimensionValues.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('SEX_BTSX');
    expect(text).toContain('Both sexes');
  });

  it('formats an empty page without crashing', () => {
    const blocks = whoListDimensionValues.format!({ dimension: 'COUNTRY', values: [] });
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('COUNTRY');
  });
});

describe('whoListDimensionValues — malformed dimension code (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-wraps a service malformed_identifier into the typed contract failure', async () => {
    mockService.listDimensionValues.mockRejectedValue({
      data: { reason: 'malformed_identifier' },
    });
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: '\uD800' });

    await expect(whoListDimensionValues.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'malformed_identifier',
        recovery: { hint: expect.stringContaining('dimension') },
      },
    });
  });

  it('does not echo the rejected code back to the client', async () => {
    mockService.listDimensionValues.mockRejectedValue({
      data: { reason: 'malformed_identifier' },
    });
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: '\uD800' });

    const err = await Promise.resolve(whoListDimensionValues.handler(input, ctx)).catch(
      (e: unknown) => e,
    );
    expect(JSON.stringify(err)).not.toContain('\\ud800');
  });
});
