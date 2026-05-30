/**
 * @fileoverview Extended tests for the who://indicator/{indicatorCode}/metadata resource:
 * security and edge case assertions.
 * @module tests/resources/who-indicator-metadata-extended.resource.test
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

describe('whoIndicatorMetadataResource — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates service rejection as thrown error', async () => {
    mockService.getIndicatorDimensions.mockRejectedValue(new Error('GHO API timeout'));
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({
      indicatorCode: 'WHOSIS_000001',
    });
    await expect(whoIndicatorMetadataResource.handler(params, ctx)).rejects.toThrow(
      'GHO API timeout',
    );
  });

  it('returns multiple dimensions for an indicator', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([
        [
          'WHOSIS_000001',
          [
            { dimension: 'COUNTRY', dimensionName: 'Country' },
            { dimension: 'SEX', dimensionName: 'Sex' },
            { dimension: 'WORLDBANKINCOMEGROUP', dimensionName: 'World Bank Income Group' },
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
    const params = whoIndicatorMetadataResource.params.parse({
      indicatorCode: 'WHOSIS_000001',
    });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.dimensions).toHaveLength(3);
    expect(result.dimensions.map((d) => d.dimension)).toContain('WORLDBANKINCOMEGROUP');
  });

  it('echoes indicatorCode into result.indicatorCode', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['MY_CODE', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'MY_CODE', indicatorName: 'My Indicator' }],
      total: 1,
    });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({ indicatorCode: 'MY_CODE' });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.indicatorCode).toBe('MY_CODE');
  });

  it('falls back to code as indicatorName when catalog returns no match', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['MYSTERY', [{ dimension: 'SEX', dimensionName: 'Sex' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({ indicatorCode: 'MYSTERY' });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.indicatorName).toBe('MYSTERY');
  });
});

describe('whoIndicatorMetadataResource — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not leak env vars or secrets in not-found error', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map());
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({ indicatorCode: 'NOTEXIST' });
    let caughtError: unknown;
    try {
      await whoIndicatorMetadataResource.handler(params, ctx);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('handles injection attempt in indicatorCode without crashing', async () => {
    const injectionCode = "'; DROP TABLE indicators; --";
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([[injectionCode, [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({ indicatorCode: injectionCode });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    // Handler echoes the code as indicatorCode and indicatorName — no additional values injected
    expect(result.indicatorCode).toBe(injectionCode);
    // Dimensions came from service, not from the injected code
    for (const d of result.dimensions) {
      expect(d.dimension).not.toContain('DROP TABLE');
    }
  });

  it('handles unicode indicatorCode without throwing', async () => {
    const unicodeCode = 'INDICATEUR_SANTÉ_2024';
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([[unicodeCode, [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: unicodeCode, indicatorName: 'Indicateur de santé 2024' }],
      total: 1,
    });
    const ctx = createMockContext();
    const params = whoIndicatorMetadataResource.params.parse({ indicatorCode: unicodeCode });
    const result = await whoIndicatorMetadataResource.handler(params, ctx);
    expect(result.indicatorCode).toBe(unicodeCode);
    expect(result.indicatorName).toBe('Indicateur de santé 2024');
  });
});
