/**
 * @fileoverview Extended tests for the who_get_indicator_metadata tool: input validation,
 * edge cases, and security assertions.
 * @module tests/tools/who-get-indicator-metadata-extended.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  getIndicatorDimensions: vi.fn(),
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoGetIndicatorMetadata — input validation', () => {
  it('rejects empty indicator_codes array (min 1)', () => {
    expect(() => whoGetIndicatorMetadata.input.parse({ indicator_codes: [] })).toThrow();
  });

  it('rejects array with more than 10 codes (max 10)', () => {
    const codes = Array.from({ length: 11 }, (_, i) => `CODE_${i}`);
    expect(() => whoGetIndicatorMetadata.input.parse({ indicator_codes: codes })).toThrow();
  });

  it('accepts exactly 1 code (min boundary)', () => {
    expect(() =>
      whoGetIndicatorMetadata.input.parse({ indicator_codes: ['CODE_1'] }),
    ).not.toThrow();
  });

  it('accepts exactly 10 codes (max boundary)', () => {
    const codes = Array.from({ length: 10 }, (_, i) => `CODE_${i}`);
    expect(() => whoGetIndicatorMetadata.input.parse({ indicator_codes: codes })).not.toThrow();
  });

  it('rejects an array containing an empty string (element min 1)', () => {
    expect(() => whoGetIndicatorMetadata.input.parse({ indicator_codes: [''] })).toThrow();
  });

  it('rejects missing indicator_codes field', () => {
    expect(() => whoGetIndicatorMetadata.input.parse({})).toThrow();
  });
});

describe('whoGetIndicatorMetadata — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('partial match: found entries and notFound entries coexist', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([
        ['CODE_A', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]],
        // CODE_B not in map → notFound
      ]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'CODE_A', indicatorName: 'Indicator A' }],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['CODE_A', 'CODE_B'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0]?.indicatorCode).toBe('CODE_A');
    expect(result.notFound).toContain('CODE_B');
  });

  it('falls back to indicator code as name when catalog returns no match', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['MYSTERY_CODE', [{ dimension: 'SEX', dimensionName: 'Sex' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['MYSTERY_CODE'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.indicators[0]?.indicatorName).toBe('MYSTERY_CODE');
  });

  it('propagates service rejection as thrown error', async () => {
    mockService.getIndicatorDimensions.mockRejectedValue(new Error('Service down'));
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({ indicator_codes: ['CODE_1'] });
    await expect(whoGetIndicatorMetadata.handler(input, ctx)).rejects.toThrow('Service down');
  });

  it('formats notFound-only output when all codes return empty dims', () => {
    const output = {
      indicators: [],
      notFound: ['UNKNOWN_A', 'UNKNOWN_B'],
    };
    const blocks = whoGetIndicatorMetadata.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('UNKNOWN_A');
    expect(text).toContain('UNKNOWN_B');
  });

  it('formats multiple found indicators correctly', () => {
    const output = {
      indicators: [
        {
          indicatorCode: 'CODE_A',
          indicatorName: 'Indicator A',
          dimensions: [{ dimension: 'COUNTRY', dimensionName: 'Country' }],
        },
        {
          indicatorCode: 'CODE_B',
          indicatorName: 'Indicator B',
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
    expect(text).toContain('CODE_A');
    expect(text).toContain('CODE_B');
    expect(text).toContain('SEX');
  });
});

describe('whoGetIndicatorMetadata — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not echo injection attempt from codes into indicator output fields', async () => {
    const injectionCode = "'; DROP TABLE indicators; --";
    // Code exists in dims so we get a result (not an error)
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([[injectionCode, [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({ indicator_codes: [injectionCode] });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    // The indicator code is echoed as-is (expected) but no new injection content should appear
    // in the dimensions array, which comes from the service, not the input
    for (const ind of result.indicators) {
      for (const dim of ind.dimensions) {
        expect(dim.dimension).not.toContain('DROP TABLE');
        expect(dim.dimensionName).not.toContain('DROP TABLE');
      }
    }
  });

  it('does not leak env vars or secrets in all_not_found error', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(new Map());
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 0 });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({ indicator_codes: ['NOTEXIST'] });
    let caughtError: unknown;
    try {
      await whoGetIndicatorMetadata.handler(input, ctx);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('handles unicode indicator codes without throwing', async () => {
    mockService.getIndicatorDimensions.mockResolvedValue(
      new Map([['INDICATEUR_SANTÉ', [{ dimension: 'COUNTRY', dimensionName: 'Country' }]]]),
    );
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'INDICATEUR_SANTÉ', indicatorName: 'Indicateur de santé' }],
      total: 1,
    });
    const ctx = createMockContext({ errors: whoGetIndicatorMetadata.errors });
    const input = whoGetIndicatorMetadata.input.parse({
      indicator_codes: ['INDICATEUR_SANTÉ'],
    });
    const result = await whoGetIndicatorMetadata.handler(input, ctx);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0]?.indicatorName).toBe('Indicateur de santé');
  });
});
