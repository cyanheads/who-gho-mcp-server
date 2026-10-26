/** Tests bounded read acceptance and metadata continuation at the response seam. */
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import { whoDimensionValuesByParentResource } from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import * as service from '@/services/gho/gho-service.js';

const listIndicators = vi.fn();
const getIndicatorMetadata = vi.fn();
const listDimensionValues = vi.fn();
const queryData = vi.fn();
vi.spyOn(service, 'getGhoService').mockReturnValue({
  listIndicators,
  getIndicatorMetadata,
  listDimensionValues,
  queryData,
} as never);
beforeEach(() => vi.clearAllMocks());

it('preserves the default list page and metadata all_not_found recovery', async () => {
  expect(whoListIndicators.input.parse({})).toEqual({ limit: 50, offset: 0 });
  getIndicatorMetadata.mockResolvedValue({ indicators: [], notFound: ['MISSING'] });
  const result = await runToolContract(whoGetIndicatorMetadata, { indicator_codes: ['MISSING'] });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ error: { data: { reason: 'all_not_found' } } });
  expect(JSON.stringify(result.content)).toContain('who_search_indicators');
});

it('clamps a list page and renders its requested and applied limits', async () => {
  listIndicators.mockResolvedValue({ indicators: [], total: 0 });
  const result = await runToolContract(whoListIndicators, { limit: 501 });
  expect(result.isError).toBeFalsy();
  expect(listIndicators).toHaveBeenCalledWith({ limit: 500, offset: 0 }, expect.anything());
  expect(result.structuredContent).toMatchObject({ notice: expect.stringContaining('501') });
  expect(JSON.stringify(result.content)).toContain('500');
});

it('processes only ten metadata positions and preserves duplicate continuation', async () => {
  const prefix = Array.from({ length: 10 }, (_, i) => `M${i}`);
  getIndicatorMetadata.mockResolvedValue({ indicators: [], notFound: prefix });
  const result = await runToolContract(whoGetIndicatorMetadata, {
    indicator_codes: [...prefix, 'M0', 'LAST'],
  });
  expect(result.isError).toBeFalsy();
  expect(getIndicatorMetadata).toHaveBeenCalledWith(prefix, expect.anything());
  expect(result.structuredContent).toMatchObject({
    indicators: [],
    notFound: prefix,
    unprocessedCodes: ['M0', 'LAST'],
  });
  expect(JSON.stringify(result.content)).toContain('LAST');
  expect(JSON.stringify(result.content)).toContain('next');
});

it('composes search clamping with middle, final and exhausted page notices', async () => {
  const indicators = [{ indicatorCode: 'X', indicatorName: 'X' }];
  for (const offset of [1, 2, 3]) {
    listIndicators.mockResolvedValue({ indicators: offset < 3 ? indicators : [], total: 3 });
    const result = await runToolContract(whoSearchIndicators, { query: 'X', limit: 101, offset });
    expect(result.isError).toBeFalsy();
    expect(listIndicators).toHaveBeenLastCalledWith(
      { query: 'X', limit: 100, offset },
      expect.anything(),
    );
    expect(result.structuredContent).toMatchObject({
      hasMore: offset === 1,
      notice: expect.stringContaining('Requested limit 101; applied limit 100.'),
    });
    if (offset === 1) expect(JSON.stringify(result.content)).toContain('offset 2');
    if (offset === 3) expect(JSON.stringify(result.content)).toContain('last reachable offset');
  }
});

it('composes dimension clamping with an empty parent filter on both surfaces', async () => {
  listDimensionValues.mockResolvedValue({ values: [], total: 0 });
  const result = await runToolContract(whoListDimensionValues, {
    dimension: 'COUNTRY',
    parent_code: 'NO',
    limit: 501,
  });
  expect(result.isError).toBeFalsy();
  expect(listDimensionValues).toHaveBeenCalledWith(
    { dimensionCode: 'COUNTRY', parentCode: 'NO', limit: 500, offset: 0 },
    expect.anything(),
  );
  expect(result.structuredContent).toMatchObject({
    notice: expect.stringContaining('applied limit 500.'),
  });
  expect(JSON.stringify(result.content)).toContain('filter matched nothing');
});

it('composes query clamping with ignored filter and pagination notices', async () => {
  queryData.mockResolvedValue({
    rows: [{ indicatorCode: 'X', year: 2020 }],
    totalRows: 2,
    truncated: true,
  });
  const result = await runToolContract(whoQueryIndicatorData, {
    indicator_code: 'X',
    country_codes: [],
    limit: 1001,
  });
  expect(result.isError).toBeFalsy();
  expect(queryData).toHaveBeenCalledWith(
    expect.objectContaining({ limit: 1000 }),
    expect.anything(),
  );
  expect(result.structuredContent).toMatchObject({
    nextOffset: 1,
    notice: expect.stringContaining('applied limit 1000.'),
  });
  const text = JSON.stringify(result.content);
  expect(text).toContain('Ignored country');
  expect(text).toContain('next page');
});

it('clamps resource pages and composes their exhausted-page notice', async () => {
  listDimensionValues.mockResolvedValue({ values: [], total: 2 });
  const ctx = createMockContext();
  const result = await whoDimensionValuesByParentResource.handler(
    whoDimensionValuesByParentResource.params!.parse({
      dimensionCode: 'COUNTRY',
      parentCode: 'EUR',
      limit: '501',
      offset: '2',
    }),
    ctx,
  );
  expect(listDimensionValues).toHaveBeenCalledWith(
    { dimensionCode: 'COUNTRY', parentCode: 'EUR', limit: 500, offset: 2 },
    ctx,
  );
  expect(result).toMatchObject({
    hasMore: false,
    notice: expect.stringContaining('Requested limit 501; applied limit 500.'),
  });
  expect(result.notice).toContain('last reachable offset');
});

it('does not return continuation at ten and rejects more than 1000 before any lookup', async () => {
  getIndicatorMetadata.mockResolvedValue({
    indicators: [{ indicatorCode: 'X', indicatorName: 'X', dimensions: [] }],
    notFound: [],
  });
  const result = await runToolContract(whoGetIndicatorMetadata, {
    indicator_codes: Array(10).fill('X'),
  });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).not.toHaveProperty('unprocessedCodes');
  getIndicatorMetadata.mockClear();
  const invalid = await runToolContract(whoGetIndicatorMetadata, {
    indicator_codes: Array(1001).fill('X'),
  });
  expect(invalid.isError).toBe(true);
  expect(getIndicatorMetadata).not.toHaveBeenCalled();
  expect(JSON.stringify(invalid.content)).toContain('1000');
});
