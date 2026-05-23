/**
 * @fileoverview Tests for the who_list_dimension_values tool.
 * @module tests/tools/who-list-dimension-values.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListDimensionValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dimension values for a known dimension', async () => {
    mockService.listDimensionValues.mockResolvedValue([
      { code: 'AFR', label: 'African Region' },
      { code: 'EUR', label: 'European Region' },
    ]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'REGION' });
    const result = await whoListDimensionValues.handler(input, ctx);
    expect(result.dimension).toBe('REGION');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toMatchObject({ code: 'AFR', label: 'African Region' });
  });

  it('throws dimension_not_found when API returns empty', async () => {
    mockService.listDimensionValues.mockResolvedValue([]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'UNKNOWNDIM' });
    await expect(whoListDimensionValues.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'dimension_not_found' },
    });
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
});
