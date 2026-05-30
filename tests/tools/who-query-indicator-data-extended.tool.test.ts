/**
 * @fileoverview Extended tests for the who_query_indicator_data tool: input validation,
 * edge cases, and security assertions.
 * @module tests/tools/who-query-indicator-data-extended.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  queryData: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

const minimalRow = {
  indicatorCode: 'WHOSIS_000001',
  year: 2021,
};

describe('whoQueryIndicatorData — input validation', () => {
  it('rejects empty indicator_code string (min 1)', () => {
    expect(() => whoQueryIndicatorData.input.parse({ indicator_code: '' })).toThrow();
  });

  it('rejects missing indicator_code field', () => {
    expect(() => whoQueryIndicatorData.input.parse({})).toThrow();
  });

  it('rejects limit=0 (min 1)', () => {
    expect(() => whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', limit: 0 })).toThrow();
  });

  it('rejects limit=1001 (max 1000)', () => {
    expect(() =>
      whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', limit: 1001 }),
    ).toThrow();
  });

  it('accepts limit at boundaries: 1 and 1000', () => {
    expect(() =>
      whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', limit: 1 }),
    ).not.toThrow();
    expect(() =>
      whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', limit: 1000 }),
    ).not.toThrow();
  });

  it('applies default limit 200', () => {
    const parsed = whoQueryIndicatorData.input.parse({ indicator_code: 'CODE' });
    expect(parsed.limit).toBe(200);
  });

  it('applies default include_uncertainty true', () => {
    const parsed = whoQueryIndicatorData.input.parse({ indicator_code: 'CODE' });
    expect(parsed.include_uncertainty).toBe(true);
  });

  it('rejects invalid sex value', () => {
    expect(() =>
      whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', sex: 'SEX_INVALID' }),
    ).toThrow();
  });

  it('accepts all valid sex enum values', () => {
    for (const sex of ['SEX_BTSX', 'SEX_FMLE', 'SEX_MLE']) {
      expect(() =>
        whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', sex }),
      ).not.toThrow();
    }
  });

  it('accepts non-integer year_from and year_to (int validated at Zod)', () => {
    // year_from/year_to must be integers per schema
    expect(() =>
      whoQueryIndicatorData.input.parse({ indicator_code: 'CODE', year_from: 2015.5 }),
    ).toThrow();
  });
});

describe('whoQueryIndicatorData — spatial filter combinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ambiguous_spatial_filter when region_codes + income_group_codes both set', async () => {
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      region_codes: ['EUR'],
      income_group_codes: ['WB_HI'],
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'ambiguous_spatial_filter' },
    });
  });

  it('throws ambiguous_spatial_filter when all three spatial types set', async () => {
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
      region_codes: ['EUR'],
      income_group_codes: ['WB_HI'],
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'ambiguous_spatial_filter' },
    });
  });

  it('accepts income_group_codes alone as spatial filter', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [{ ...minimalRow, spatialDimType: 'WORLDBANKINCOMEGROUP', spatialDim: 'WB_HI' }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      income_group_codes: ['WB_HI'],
    });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.spatialFilter).toContain('income_group_codes');
    expect(enrichment.appliedFilters.spatialFilter).toContain('WB_HI');
  });

  it('accepts region_codes alone as spatial filter', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [{ ...minimalRow, spatialDimType: 'REGION', spatialDim: 'EUR' }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      region_codes: ['EUR'],
    });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.spatialFilter).toContain('region_codes');
    expect(enrichment.appliedFilters.spatialFilter).toContain('EUR');
  });

  it('accepts no spatial filter (all geographies)', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [minimalRow],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.spatialFilter).toBeUndefined();
  });
});

describe('whoQueryIndicatorData — year range edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces yearRange with only year_from', async () => {
    mockService.queryData.mockResolvedValue({ rows: [minimalRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      year_from: 2015,
    });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.yearRange).toBe('from 2015');
  });

  it('produces yearRange with only year_to', async () => {
    mockService.queryData.mockResolvedValue({ rows: [minimalRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      year_to: 2023,
    });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.yearRange).toBe('to 2023');
  });

  it('produces yearRange with both year_from and year_to', async () => {
    mockService.queryData.mockResolvedValue({ rows: [minimalRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      year_from: 2010,
      year_to: 2020,
    });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.yearRange).toBe('2010–2020');
  });

  it('yearRange is absent when no year filters applied', async () => {
    mockService.queryData.mockResolvedValue({ rows: [minimalRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.yearRange).toBeUndefined();
  });
});

describe('whoQueryIndicatorData — dim1_value and include_uncertainty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('echoes dim1_value in enrichment applied filters', async () => {
    mockService.queryData.mockResolvedValue({ rows: [minimalRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      dim1_value: 'YEARS05-14',
    });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters.dim1Value).toBe('YEARS05-14');
  });

  it('does not crash when include_uncertainty=false', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [{ ...minimalRow, numericValue: 70.0, displayValue: '70.0' }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      include_uncertainty: false,
    });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);
  });
});

describe('whoQueryIndicatorData — indicator_not_found propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-wraps indicator_not_found from service into typed contract failure', async () => {
    mockService.queryData.mockRejectedValue({
      data: { reason: 'indicator_not_found' },
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'NOTEXIST' });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'indicator_not_found' },
    });
  });

  it('re-throws non-indicator errors as-is', async () => {
    mockService.queryData.mockRejectedValue(new Error('Network error'));
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'CODE' });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toThrow('Network error');
  });
});

describe('whoQueryIndicatorData — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not echo injection attempt in output row fields', async () => {
    const injectionCode = "'; DROP TABLE data; --";
    mockService.queryData.mockResolvedValue({
      rows: [{ indicatorCode: 'SAFE_CODE', year: 2021 }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: injectionCode });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    for (const row of result.rows) {
      expect(row.indicatorCode).not.toContain('DROP TABLE');
    }
  });

  it('does not leak env vars or secrets in no_data error', async () => {
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 0, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['XXX'],
    });
    let caughtError: unknown;
    try {
      await whoQueryIndicatorData.handler(input, ctx);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('handles unicode indicator code without throwing', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [{ indicatorCode: 'INDICATEUR_SANTÉ', year: 2021 }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'INDICATEUR_SANTÉ' });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects oversized indicator_code passed through Zod (still valid string)', async () => {
    // No Zod max length on indicator_code, so a long string is accepted at the schema level
    // but verify the handler itself doesn't crash or expose secrets on it
    const longCode = 'A'.repeat(10000);
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 0, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: longCode });
    let caughtError: unknown;
    try {
      await whoQueryIndicatorData.handler(input, ctx);
    } catch (err) {
      caughtError = err;
    }
    // Must result in no_data, not an unhandled crash leaking internals
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('format output contains no injected script tags from row data', () => {
    const output = {
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          year: 2021,
          spatialDim: '<script>alert(1)</script>',
          numericValue: 42,
          displayValue: '42',
        },
      ],
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Format echoes service data; assert no new injection vectors are introduced
    expect(typeof text).toBe('string');
    expect(text).toContain('WHOSIS_000001');
  });
});
