/**
 * @fileoverview Tests for the who_query_indicator_data tool.
 * @module tests/tools/who-query-indicator-data.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  queryData: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

const sampleRow = {
  indicatorCode: 'WHOSIS_000001',
  spatialDimType: 'COUNTRY',
  spatialDim: 'JPN',
  year: 2021,
  numericValue: 84.5,
  displayValue: '84.5',
};

describe('whoQueryIndicatorData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data rows for a valid query', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [sampleRow],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
    });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);
    expect(result.totalRows).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.truncatedNote).toBeUndefined();
  });

  it('includes truncatedNote when results are truncated', async () => {
    mockService.queryData.mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => ({ ...sampleRow, year: 2000 + i })),
      totalRows: 5000,
      truncated: true,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.truncated).toBe(true);
    expect(result.truncatedNote).toBeDefined();
    expect(result.truncatedNote).toContain('5000');
  });

  it('throws ambiguous_spatial_filter when multiple spatial types provided', async () => {
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
      region_codes: ['EUR'],
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'ambiguous_spatial_filter' },
    });
  });

  it('throws no_data when the service returns no rows', async () => {
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 0, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['XXX'],
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_data' },
    });
  });

  it('formats output with all row fields', () => {
    const output = {
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          spatialDimType: 'COUNTRY',
          spatialDim: 'JPN',
          spatialLabel: 'Western Pacific',
          year: 2021,
          dim1Type: 'SEX',
          dim1: 'SEX_BTSX',
          dim2Type: 'AGEGROUP',
          dim2: 'AGE_0-4',
          numericValue: 84.5,
          low: 84.0,
          high: 85.0,
          displayValue: '84.5 [84.0-85.0]',
          comments: 'Estimated',
        },
      ],
      totalRows: 1,
      truncated: false,
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('2021');
    expect(text).toContain('JPN');
    expect(text).toContain('84.5');
    expect(text).toContain('84.0');
    expect(text).toContain('85.0');
    expect(text).toContain('SEX_BTSX');
    expect(text).toContain('AGE_0-4');
    expect(text).toContain('Estimated');
  });

  it('formats sparse rows without optional fields', () => {
    const output = {
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          year: 2020,
        },
      ],
      totalRows: 1,
      truncated: false,
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('2020');
  });

  it('formats truncated output with note', () => {
    const output = {
      rows: [{ indicatorCode: 'CODE', year: 2020, numericValue: 1.0 }],
      totalRows: 5000,
      truncated: true,
      truncatedNote: 'Showing 200 of 5000 rows.',
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Showing 200 of 5000 rows');
  });
});
