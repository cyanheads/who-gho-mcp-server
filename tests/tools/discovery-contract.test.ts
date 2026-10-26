/**
 * @fileoverview Discovery adapter contracts and literal Markdown rendering.
 * @module tests/tools/discovery-contract.test
 */
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoListDimensions } from '@/mcp-server/tools/definitions/who-list-dimensions.tool.js';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import * as service from '@/services/gho/gho-service.js';

const mockService = {
  listIndicators: vi.fn(),
  listDimensionValues: vi.fn(),
  listDimensions: vi.fn(),
  getIndicatorMetadata: vi.fn(),
};
vi.spyOn(service, 'getGhoService').mockReturnValue(mockService as never);

describe('discovery contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('characterizes independent optional parent fields on both surfaces', async () => {
    mockService.listDimensionValues.mockResolvedValue({
      values: [
        { code: 'A', label: 'Alpha', parentLabel: 'Parent label', parentDimension: 'REGION' },
      ],
      total: 1,
    });
    const result = await runToolContract(whoListDimensionValues, { dimension: 'COUNTRY' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      values: [{ parentLabel: 'Parent label', parentDimension: 'REGION' }],
    });
    expect(JSON.stringify(result.content)).toContain('parentLabel=Parent label');
    expect(JSON.stringify(result.content)).toContain('parentDimension=REGION');
  });

  it('rejects whitespace-only search before a service call', async () => {
    const result = await runToolContract(whoSearchIndicators, { query: ' \t\n ' });
    expect(result.isError).toBe(true);
    expect(mockService.listIndicators).not.toHaveBeenCalled();
  });

  it('uses canonical shared metadata without changing missing-code echoes', async () => {
    const indicators = [
      {
        indicatorCode: 'WHOSIS_000001',
        indicatorName: 'Life expectancy',
        dimensions: [{ dimension: 'SEX', dimensionName: 'Sex' }],
      },
    ];
    mockService.getIndicatorMetadata.mockResolvedValue({ indicators, notFound: ['missing'] });
    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: ['whosis_000001', 'missing'],
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ indicators, notFound: ['missing'] });
    expect(JSON.stringify(result.content)).toContain('WHOSIS_000001');
    expect(mockService.getIndicatorMetadata).toHaveBeenCalledWith(
      ['whosis_000001', 'missing'],
      expect.anything(),
    );
  });

  it('translates filtered dimension misses through the declared recovery contract', async () => {
    mockService.listDimensionValues.mockRejectedValue(
      notFound('Missing', { reason: 'dimension_not_found' }),
    );
    const result = await runToolContract(whoListDimensionValues, {
      dimension: 'NOT_REAL',
      parent_code: 'EUR',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('who_list_dimensions');
    expect(JSON.stringify(result.content)).toContain('dimension_not_found');
  });

  it('keeps caller text raw in notices and escapes only the rendered trailers', async () => {
    mockService.listIndicators.mockResolvedValue({ indicators: [], total: 1 });
    const search = await runToolContract(whoSearchIndicators, { query: '*query*', offset: 1 });
    expect(search.structuredContent).toMatchObject({
      effectiveQuery: '*query*',
      notice: expect.stringContaining('"*query*"'),
    });
    const searchText = search.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(searchText).toContain('\\*query\\*');
    expect(searchText).not.toContain('"*query*"');
    mockService.listDimensionValues.mockResolvedValue({ values: [], total: 0 });
    const dimensions = await runToolContract(whoListDimensionValues, {
      dimension: '*dimension*',
      parent_code: '[parent]',
    });
    expect(dimensions.structuredContent).toMatchObject({
      notice: expect.stringContaining('"[parent]"'),
    });
    const dimensionText = dimensions.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(dimensionText).toContain('\\*dimension\\*');
    expect(dimensionText).toContain('\\[parent\\]');
    expect(dimensionText).not.toContain('"[parent]"');
  });

  it('escapes all discovery formatter fields while retaining raw structured data', async () => {
    const hostile = '*x* [link](https://example.org) <b> &copy;\n# heading';
    const escaped = '\\*x\\* \\[link\\](https://example.org) \\<b> \\&copy;\\\n\\# heading';
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: hostile, indicatorName: hostile }],
      total: 1,
    });
    mockService.listDimensions.mockResolvedValue([{ code: hostile, title: hostile }]);
    mockService.listDimensionValues.mockResolvedValue({
      values: [
        {
          code: hostile,
          label: hostile,
          parentCode: hostile,
          parentLabel: hostile,
          parentDimension: hostile,
        },
      ],
      total: 1,
    });
    mockService.getIndicatorMetadata.mockResolvedValue({
      indicators: [
        {
          indicatorCode: hostile,
          indicatorName: hostile,
          dimensions: [{ dimension: hostile, dimensionName: hostile }],
          dimensionsNote: hostile,
        },
      ],
      notFound: [hostile],
    });
    for (const result of [
      await runToolContract(whoSearchIndicators, { query: hostile }),
      await runToolContract(whoListIndicators, {}),
      await runToolContract(whoListDimensions, {}),
      await runToolContract(whoListDimensionValues, { dimension: hostile }),
      await runToolContract(whoGetIndicatorMetadata, { indicator_codes: [hostile] }),
    ]) {
      expect(result.isError).toBeFalsy();
      const text = result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      expect(text).toContain(escaped);
      expect(text).not.toContain(hostile);
      expect(JSON.stringify(result.structuredContent)).toContain(
        JSON.stringify(hostile).slice(1, -1),
      );
    }
  });
});
