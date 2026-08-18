/**
 * @fileoverview Extended tests for the who://dimension/{dimensionCode}/values resource:
 * security and edge case assertions.
 * @module tests/resources/who-dimension-values-extended.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  whoDimensionValuesPageResource,
  whoDimensionValuesResource,
} from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

/** The service returns one page plus the unpaged total. */
const page = <T>(values: T[], total = values.length) => ({ values, total });

describe('whoDimensionValuesResource — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates service rejection as thrown error', async () => {
    mockService.listDimensionValues.mockRejectedValue(new Error('GHO API timeout'));
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'COUNTRY' });
    await expect(whoDimensionValuesResource.handler(params, ctx)).rejects.toThrow(
      'GHO API timeout',
    );
  });

  it('echoes dimensionCode into result.dimension field', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'SEX_BTSX', label: 'Both sexes' }]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'SEX' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.dimension).toBe('SEX');
  });

  it('returns all parent fields when upstream includes them', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([
        {
          code: 'JPN',
          label: 'Japan',
          parentCode: 'WPR',
          parentLabel: 'Western Pacific',
          parentDimension: 'REGION',
        },
      ]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'COUNTRY' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.values[0]).toMatchObject({
      code: 'JPN',
      label: 'Japan',
      parentCode: 'WPR',
      parentLabel: 'Western Pacific',
      parentDimension: 'REGION',
    });
  });
});

describe('whoDimensionValuesPageResource — input validation', () => {
  it('rejects a non-numeric limit', () => {
    expect(() =>
      whoDimensionValuesPageResource.params!.parse({
        dimensionCode: 'COUNTRY',
        limit: 'many',
        offset: '0',
      }),
    ).toThrow();
  });

  it('rejects a negative offset', () => {
    expect(() =>
      whoDimensionValuesPageResource.params!.parse({
        dimensionCode: 'COUNTRY',
        limit: '10',
        offset: '-1',
      }),
    ).toThrow();
  });

  it('rejects a limit above the ceiling', () => {
    expect(() =>
      whoDimensionValuesPageResource.params!.parse({
        dimensionCode: 'COUNTRY',
        limit: '501',
        offset: '0',
      }),
    ).toThrow();
  });
});

describe('whoDimensionValuesResource — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not leak env vars or secrets in not-found error', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'NOTEXIST' });
    let caughtError: unknown;
    try {
      await whoDimensionValuesResource.handler(params, ctx);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('handles injection attempt in dimensionCode without crashing', async () => {
    const injectionCode = "'; DROP TABLE dim; --";
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'SAFE', label: 'Safe Value' }]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: injectionCode });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    for (const v of result.values) {
      expect(v.code).not.toContain('DROP TABLE');
    }
  });

  it('handles unicode dimensionCode without throwing', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'AFR', label: 'Région africaine' }]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'RÉGION' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.values).toHaveLength(1);
  });
});
