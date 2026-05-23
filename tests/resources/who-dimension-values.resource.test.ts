/**
 * @fileoverview Tests for the who://dimension/{dimensionCode}/values resource.
 * @module tests/resources/who-dimension-values.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoDimensionValuesResource } from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoDimensionValuesResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns values for a known dimension', async () => {
    mockService.listDimensionValues.mockResolvedValue([
      { code: 'SEX_BTSX', label: 'Both sexes' },
      { code: 'SEX_FMLE', label: 'Female' },
      { code: 'SEX_MLE', label: 'Male' },
    ]);
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params.parse({ dimensionCode: 'SEX' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.dimension).toBe('SEX');
    expect(result.values).toHaveLength(3);
    expect(result.values[0]).toMatchObject({ code: 'SEX_BTSX', label: 'Both sexes' });
  });

  it('throws not found for unknown dimension code', async () => {
    mockService.listDimensionValues.mockResolvedValue([]);
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params.parse({ dimensionCode: 'NOTEXIST' });
    await expect(whoDimensionValuesResource.handler(params, ctx)).rejects.toThrow(
      /not exist|not found/i,
    );
  });

  it('returns sparse values without parent fields', async () => {
    mockService.listDimensionValues.mockResolvedValue([{ code: 'AFR', label: 'African Region' }]);
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params.parse({ dimensionCode: 'REGION' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.values[0]).toMatchObject({ code: 'AFR', label: 'African Region' });
    expect(result.values[0]?.parentCode).toBeUndefined();
  });
});
