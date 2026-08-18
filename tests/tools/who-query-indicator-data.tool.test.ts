/**
 * @fileoverview Tests for the who_query_indicator_data tool.
 * @module tests/tools/who-query-indicator-data.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns data rows with enrichment for a valid query', async () => {
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

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalRows).toBe(1);
    expect(enrichment.appliedFilters).toMatchObject({
      indicatorCode: 'WHOSIS_000001',
      spatialFilter: 'country_codes: JPN',
    });
    expect(enrichment.notice).toBeUndefined();
  });

  it('sets truncation notice in enrichment when results are truncated', async () => {
    mockService.queryData.mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => ({ ...sampleRow, year: 2000 + i })),
      totalRows: 5000,
      truncated: true,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(200);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalRows).toBe(5000);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('5000');
  });

  it('echoes year range and sex filters in enrichment', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      year_from: 2010,
      year_to: 2020,
      sex: 'SEX_FMLE',
    });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters).toMatchObject({
      yearRange: '2010–2020',
      sex: 'SEX_FMLE',
    });
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
          parentLocation: 'Western Pacific',
          parentLocationCode: 'WPR',
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

  it('format labels the parent region instead of slash-joining it onto the location (#15)', () => {
    const blocks = whoQueryIndicatorData.format!({
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          spatialDimType: 'COUNTRY',
          spatialDim: 'JPN',
          parentLocation: 'Western Pacific',
          parentLocationCode: 'WPR',
          year: 2021,
        },
      ],
    });
    const text = (blocks[0] as { type: 'text'; text: string }).text;

    expect(text).toContain('COUNTRY / JPN — parent: Western Pacific (WPR)');
    // The old rendering read as though Western Pacific sat under Japan.
    expect(text).not.toContain('JPN / Western Pacific');
  });

  it('format omits the parent segment on a region row (#15)', () => {
    const blocks = whoQueryIndicatorData.format!({
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          spatialDimType: 'REGION',
          spatialDim: 'EUR',
          year: 2021,
          numericValue: 79.3,
        },
      ],
    });
    const text = (blocks[0] as { type: 'text'; text: string }).text;

    expect(text).toContain('REGION / EUR');
    expect(text).not.toContain('parent:');
    expect(text).not.toContain('undefined');
  });

  it('format renders the parent segment per row across a mixed page (#15)', () => {
    const blocks = whoQueryIndicatorData.format!({
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          spatialDimType: 'COUNTRY',
          spatialDim: 'JPN',
          parentLocation: 'Western Pacific',
          parentLocationCode: 'WPR',
          year: 2021,
        },
        {
          indicatorCode: 'WHOSIS_000001',
          spatialDimType: 'WORLDBANKINCOMEGROUP',
          spatialDim: 'WB_HI',
          year: 2021,
        },
      ],
    });
    const lines = (blocks[0] as { type: 'text'; text: string }).text.split('\n');

    expect(lines.filter((line) => line.includes('parent:'))).toHaveLength(1);
    expect(lines.find((line) => line.includes('WB_HI'))).not.toContain('parent:');
  });

  it('carries the parent fields onto structuredContent (#15)', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [
        { ...sampleRow, parentLocation: 'Western Pacific', parentLocationCode: 'WPR' },
        { ...sampleRow, spatialDimType: 'REGION', spatialDim: 'EUR' },
      ],
      totalRows: 2,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);

    // Both consumption paths carry the same data: structuredContent here, content[] above.
    expect(whoQueryIndicatorData.output.parse(result).rows).toMatchObject([
      { parentLocation: 'Western Pacific', parentLocationCode: 'WPR' },
      {},
    ]);
    expect(result.rows[1]).not.toHaveProperty('parentLocation');
  });

  it('formats sparse rows without optional fields', () => {
    const output = {
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
          year: 2020,
        },
      ],
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).toContain('2020');
  });

  it('formats rows with absent year using em dash placeholder', () => {
    const output = {
      rows: [
        {
          indicatorCode: 'WHOSIS_000001',
        },
      ],
    };
    const blocks = whoQueryIndicatorData.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('WHOSIS_000001');
    expect(text).not.toContain('undefined');
    expect(text).toContain('**—**');
  });

  it('passes rows with absent year through handler without error', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [{ indicatorCode: 'WHOSIS_000001' }],
      totalRows: 1,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.year).toBeUndefined();
  });
});

describe('whoQueryIndicatorData — ordering (#13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads the default most-recent-first ordering into the service call', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    await whoQueryIndicatorData.handler(input, ctx);

    expect(mockService.queryData).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'TimeDim desc,SpatialDim,Dim1,Id' }),
      ctx,
    );
  });

  it('threads the ascending ordering when sort=year_asc', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      sort: 'year_asc',
    });
    await whoQueryIndicatorData.handler(input, ctx);

    expect(mockService.queryData).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'TimeDim asc,SpatialDim,Dim1,Id' }),
      ctx,
    );
  });

  it('echoes the applied ordering in appliedFilters on both consumption paths', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      sort: 'year_asc',
    });
    await whoQueryIndicatorData.handler(input, ctx);

    // structuredContent surface
    const filters = getEnrichment(ctx).appliedFilters as { ordering?: string };
    expect(filters.ordering).toBe('earliest first (year_asc)');

    // content[] surface — the trailer render is what a content-only client reads
    const trailer = whoQueryIndicatorData.enrichmentTrailer!.appliedFilters!.render!(
      filters as never,
    );
    expect(trailer).toContain('Ordering:');
    expect(trailer).toContain('earliest first (year_asc)');
  });

  it('names the returned slice in the truncation notice', async () => {
    mockService.queryData.mockResolvedValue({
      rows: Array.from({ length: 200 }, () => sampleRow),
      totalRows: 12936,
      truncated: true,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    await whoQueryIndicatorData.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('most recent 200 of 12936 rows');
  });

  it('sorts a row with an absent year alongside dated rows without crashing', async () => {
    mockService.queryData.mockResolvedValue({
      rows: [sampleRow, { indicatorCode: 'WHOSIS_000001', numericValue: 1 }],
      totalRows: 2,
      truncated: false,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    const result = await whoQueryIndicatorData.handler(input, ctx);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]!.year).toBeUndefined();
    const text = (
      whoQueryIndicatorData.format!(result as never)[0] as { type: 'text'; text: string }
    ).text;
    expect(text).not.toContain('undefined');
  });
});

describe('whoQueryIndicatorData — offset paging (#8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const page = (start: number, size: number) =>
    Array.from({ length: size }, (_, i) => ({ ...sampleRow, year: 2000 + start + i }));

  it('defaults offset to 0 and reproduces single-page behavior', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    await whoQueryIndicatorData.handler(input, ctx);

    expect(mockService.queryData).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }), ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toBeUndefined();
  });

  it('threads a non-zero offset through and advertises a reachable next page', async () => {
    mockService.queryData.mockResolvedValue({
      rows: page(200, 200),
      totalRows: 12936,
      truncated: true,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      offset: 200,
    });
    await whoQueryIndicatorData.handler(input, ctx);

    expect(mockService.queryData).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 200, limit: 200 }),
      ctx,
    );
    const enrichment = getEnrichment(ctx);
    expect(enrichment.offset).toBe(200);
    expect(enrichment.hasMore).toBe(true);
    expect(enrichment.nextOffset).toBe(400);
    expect(enrichment.pageInfo).toBe('offset 200, showing 200 of 12936');
    // Never advertise an offset that cannot return a row.
    expect(enrichment.nextOffset as number).toBeLessThan(enrichment.totalRows as number);
  });

  it('returns disjoint rows across two pages of the same query', async () => {
    const ctxA = createMockContext({ errors: whoQueryIndicatorData.errors });
    mockService.queryData.mockResolvedValue({ rows: page(0, 3), totalRows: 9, truncated: true });
    const first = await whoQueryIndicatorData.handler(
      whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001', limit: 3 }),
      ctxA,
    );

    const ctxB = createMockContext({ errors: whoQueryIndicatorData.errors });
    mockService.queryData.mockResolvedValue({ rows: page(3, 3), totalRows: 9, truncated: true });
    const second = await whoQueryIndicatorData.handler(
      whoQueryIndicatorData.input.parse({
        indicator_code: 'WHOSIS_000001',
        limit: 3,
        offset: getEnrichment(ctxA).nextOffset as number,
      }),
      ctxB,
    );

    expect(getEnrichment(ctxA).nextOffset).toBe(3);
    const firstYears = first.rows.map((r) => r.year);
    const secondYears = second.rows.map((r) => r.year);
    expect(firstYears.some((y) => secondYears.includes(y))).toBe(false);
    expect(getEnrichment(ctxB).pageInfo).toBe('offset 3, showing 3 of 9');
  });

  it('returns an empty page (not no_data) when the offset runs past the end', async () => {
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 66, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      offset: 200,
    });
    const result = await whoQueryIndicatorData.handler(input, ctx);

    expect(result.rows).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice).toContain('66 rows');
    expect(enrichment.notice).toContain('last reachable offset is 65');
    // format() sees only the domain payload, so the disclosure has to live in the notice.
    const text = (
      whoQueryIndicatorData.format!(result as never)[0] as { type: 'text'; text: string }
    ).text;
    expect(text).toContain('Rows returned: 0');
  });

  it('treats an offset exactly equal to totalRows as past the end', async () => {
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 66, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      offset: 66,
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).resolves.toMatchObject({ rows: [] });
    expect(getEnrichment(ctx).notice).toContain('last reachable offset is 65');
  });

  it('still throws no_data when nothing matched the filters at all', async () => {
    mockService.queryData.mockResolvedValue({ rows: [], totalRows: 0, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      offset: 200,
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_data' },
    });
  });

  it('writes exactly one notice carrying every applicable segment', async () => {
    mockService.queryData.mockResolvedValue({
      rows: page(0, 200),
      totalRows: 12936,
      truncated: true,
    });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: 'WHOSIS_000001' });
    await whoQueryIndicatorData.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    // truncated + paging guidance must coexist in one string; the framework's
    // enrich.truncated() default text must not have clobbered the composed notice.
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.notice).toContain('most recent 200 of 12936 rows');
    expect(enrichment.notice).toContain('Request offset 200 for the next page');
    expect(enrichment.notice).not.toContain('Results capped at');
  });
});

describe('whoQueryIndicatorData — inverted year range (#9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects year_from > year_to before querying upstream', async () => {
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
      year_from: 2025,
      year_to: 2020,
      limit: 5,
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_year_range' },
    });
    expect(mockService.queryData).not.toHaveBeenCalled();
  });

  it('accepts year_from === year_to as a single-year query', async () => {
    mockService.queryData.mockResolvedValue({ rows: [sampleRow], totalRows: 1, truncated: false });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      year_from: 2021,
      year_to: 2021,
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).resolves.toMatchObject({
      rows: [sampleRow],
    });
  });

  it('still fails on ambiguous_spatial_filter first when both checks are violated', async () => {
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
      region_codes: ['EUR'],
      year_from: 2025,
      year_to: 2020,
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'ambiguous_spatial_filter' },
    });
  });
});

describe('whoQueryIndicatorData — rejected query propagation (#12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-wraps a service invalid_query into the typed contract failure with a recovery hint', async () => {
    mockService.queryData.mockRejectedValue({ data: { reason: 'invalid_query' } });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ["J'PN"],
    });
    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'invalid_query',
        recovery: { hint: expect.stringContaining('who_list_dimension_values') },
      },
    });
  });

  it('does not echo the upstream query string in the client-facing failure', async () => {
    mockService.queryData.mockRejectedValue({ data: { reason: 'invalid_query' } });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({
      indicator_code: 'WHOSIS_000001',
      country_codes: ["J'PN"],
    });
    const err = await Promise.resolve(whoQueryIndicatorData.handler(input, ctx)).catch(
      (e: unknown) => e,
    );
    const serialized = JSON.stringify(err);
    expect(serialized).not.toContain('%24');
    expect(serialized).not.toContain('ghoapi');
  });
});

describe('whoQueryIndicatorData — malformed indicator code (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-wraps a service malformed_identifier into the typed contract failure', async () => {
    mockService.queryData.mockRejectedValue({ data: { reason: 'malformed_identifier' } });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: '\uD800' });

    await expect(whoQueryIndicatorData.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'malformed_identifier',
        // The service names its own parameter; the tool names the input field the
        // caller actually set.
        recovery: { hint: expect.stringContaining('indicator_code') },
      },
    });
  });

  it('does not echo the rejected code back to the client', async () => {
    mockService.queryData.mockRejectedValue({ data: { reason: 'malformed_identifier' } });
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    const input = whoQueryIndicatorData.input.parse({ indicator_code: '\uD800' });

    const err = await Promise.resolve(whoQueryIndicatorData.handler(input, ctx)).catch(
      (e: unknown) => e,
    );
    expect(JSON.stringify(err)).not.toContain('\\ud800');
  });
});
