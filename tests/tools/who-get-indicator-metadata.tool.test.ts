/**
 * @fileoverview Tests for the who_get_indicator_metadata tool.
 * @module tests/tools/who-get-indicator-metadata.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  getIndicatorDimensions: vi.fn(),
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoGetIndicatorMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata for known codes', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([
        [
          'WHOSIS_000001',
          [
            { dimension: 'COUNTRY', dimensionName: 'Country' },
            { dimension: 'SEX', dimensionName: 'Sex' },
          ],
        ],
      ]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [
        { indicatorCode: 'WHOSIS_000001', indicatorName: 'Life expectancy at birth (years)' },
      ],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['WHOSIS_000001'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0]?.indicatorCode).toBe('WHOSIS_000001');
    expect(result.indicators[0]?.dimensions).toHaveLength(2);
    expect(result.notFound).toHaveLength(0);
  });

  it('reports unknown codes in notFound array', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['KNOWN_CODE', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['KNOWN_CODE', 'UNKNOWN_CODE'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.indicators).toHaveLength(1);
    expect(result.notFound).toContain('UNKNOWN_CODE');
  });

  it('throws all_not_found when all codes return empty metadata', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map());
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['NOTEXIST'],
    });
    await expect(whoGetIndicatorMetadata.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'all_not_found' },
    });
  });

  it('returns a code whose name resolves but whose dimension table is empty', async () => {
    // 1,300 of the 3,089 catalog indicators have no IndicatorDimension rows, and most
    // of them still carry data — an empty dimension list is not a missing indicator.
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['PHE_HHAIR_PROP_POP_CLEAN_FUELS', []]]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [
        {
          indicatorCode: 'PHE_HHAIR_PROP_POP_CLEAN_FUELS',
          indicatorName: 'Proportion of population with primary reliance on clean fuels',
        },
      ],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['PHE_HHAIR_PROP_POP_CLEAN_FUELS'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.notFound).toHaveLength(0);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0]?.indicatorName).toContain('clean fuels');
    expect(result.indicators[0]?.dimensions).toEqual([]);
    expect(result.indicators[0]?.dimensionsNote).toMatch(/who_query_indicator_data/);
    expect(result.indicators[0]?.dimensionsNote).toMatch(/dim1Type/);
  });

  it('keeps a code that resolves to neither a name nor dimensions in notFound', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([
        ['WHOSIS_000001', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]],
        ['NOTEXIST', []],
      ]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'WHOSIS_000001', indicatorName: 'Life expectancy' }],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['WHOSIS_000001', 'NOTEXIST'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.notFound).toEqual(['NOTEXIST']);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0]?.dimensionsNote).toBeUndefined();
  });

  it('renders the empty-dimension case on both consumption surfaces', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map([['FOODBORNE_YLL_100K', []]]));
    mockService.listIndicators.mockResolvedValue({
      indicators: [
        { indicatorCode: 'FOODBORNE_YLL_100K', indicatorName: 'Foodborne YLL per 100 000' },
      ],
      total: 1,
    });
    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: ['FOODBORNE_YLL_100K'],
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      indicators: { dimensionsNote?: string; dimensions: unknown[] }[];
    };
    expect(structured.indicators[0]?.dimensions).toEqual([]);
    expect(structured.indicators[0]?.dimensionsNote).toBeDefined();
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(text).toContain('FOODBORNE_YLL_100K');
    expect(text).toContain('dim1Type');
  });

  it('formats output with indicator codes and dimensions', () => {
    const output = {
      indicators: [
        {
          indicatorCode: 'WHOSIS_000001',
          indicatorName: 'Life expectancy at birth (years)',
          dimensions: [
            { dimension: 'COUNTRY', dimensionName: 'Country' },
            { dimension: 'SEX', dimensionName: 'Sex' },
          ],
        },
      ],
      notFound: [],
    };
    const blocks = whoGetIndicatorMetadata.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('Life expectancy');
    expect(text).toContain('COUNTRY');
    expect(text).toContain('SEX');
  });

  it('formats output with notFound codes', () => {
    const output = {
      indicators: [],
      notFound: ['UNKNOWN_CODE'],
    };
    const blocks = whoGetIndicatorMetadata.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('UNKNOWN_CODE');
  });
});
