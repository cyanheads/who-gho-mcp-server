/**
 * @fileoverview Tests for the who://indicator/{indicatorCode}/metadata resource.
 * @module tests/resources/who-indicator-metadata.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoIndicatorMetadataResource } from '@/mcp-server/resources/definitions/who-indicator-metadata.resource.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  getIndicatorDimensions: vi.fn(),
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoIndicatorMetadataResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata for a known indicator code', async () => {
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
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: 'WHOSIS_000001' });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result).toMatchObject({
      indicatorCode: 'WHOSIS_000001',
      indicatorName: 'Life expectancy at birth (years)',
    });
    expect(result.dimensions).toHaveLength(2);
  });

  it('throws not found for unknown indicator code', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map());
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: 'NOTEXIST' });
    await expect(whoIndicatorMetadataResource.handler(params, ctx)).rejects.toThrow(
      /not exist|not found/i,
    );
  });

  it('returns a payload for a code whose name resolves but whose dimension table is empty', async () => {
    // The resource shares getIndicatorDimensions with the tool, so it inherited the same
    // false negative: an empty dimension table read as "the indicator may not exist".
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
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params!.parse({
      indicatorCode: 'PHE_HHAIR_PROP_POP_CLEAN_FUELS',
    });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.dimensions).toEqual([]);
    expect(result.indicatorName).toContain('clean fuels');
    expect(result.dimensionsNote).toMatch(/who_query_indicator_data/);
  });

  it('still throws when neither a name nor dimension rows resolve', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map([['NOTEXIST', []]]));
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: 'NOTEXIST' });
    await expect(whoIndicatorMetadataResource.handler(params, ctx)).rejects.toThrow(
      /not exist|not found/i,
    );
  });

  it('uses indicator code as name when indicator catalog search finds no name', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['CODE_X', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: 'CODE_X' });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.indicatorName).toBe('CODE_X');
  });
});
