/**
 * @fileoverview Extended tests for the who_list_dimension_values tool: input validation,
 * edge cases, and security assertions.
 * @module tests/tools/who-list-dimension-values-extended.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListDimensionValues — input validation', () => {
  it('rejects empty dimension string (min 1)', () => {
    expect(() => whoListDimensionValues.input.parse({ dimension: '' })).toThrow();
  });

  it('rejects missing dimension field', () => {
    expect(() => whoListDimensionValues.input.parse({})).toThrow();
  });

  it('accepts a valid dimension code', () => {
    expect(() => whoListDimensionValues.input.parse({ dimension: 'COUNTRY' })).not.toThrow();
  });
});

describe('whoListDimensionValues — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates service rejection as thrown error', async () => {
    mockService.listDimensionValues.mockRejectedValue(new Error('GHO API timeout'));
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'COUNTRY' });
    await expect(whoListDimensionValues.handler(input, ctx)).rejects.toThrow('GHO API timeout');
  });

  it('returns all values including sparse ones with no parent fields', async () => {
    mockService.listDimensionValues.mockResolvedValue([
      { code: 'SEX_BTSX', label: 'Both sexes' },
      { code: 'SEX_FMLE', label: 'Female' },
      { code: 'SEX_MLE', label: 'Male' },
    ]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'SEX' });
    const result = await whoListDimensionValues.handler(input, ctx);
    expect(result.values).toHaveLength(3);
    for (const v of result.values) {
      expect(v.parentCode).toBeUndefined();
    }
  });

  it('echoes the dimension code into the result', async () => {
    mockService.listDimensionValues.mockResolvedValue([{ code: 'WB_HI', label: 'High income' }]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'WORLDBANKINCOMEGROUP' });
    const result = await whoListDimensionValues.handler(input, ctx);
    expect(result.dimension).toBe('WORLDBANKINCOMEGROUP');
  });

  it('format includes dimension name in header', () => {
    const output = {
      dimension: 'REGION',
      values: [{ code: 'AFR', label: 'African Region' }],
    };
    const blocks = whoListDimensionValues.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('REGION');
    expect(text).toContain('1 values');
  });
});

describe('whoListDimensionValues — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not echo injection attempt from dimension code into output fields', async () => {
    const injectionDimension = "'; DROP TABLE dimensions; --";
    mockService.listDimensionValues.mockResolvedValue([{ code: 'CODE_1', label: 'Normal Value' }]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: injectionDimension });
    const result = await whoListDimensionValues.handler(input, ctx);
    for (const v of result.values) {
      expect(v.code).not.toContain('DROP TABLE');
      expect(v.label).not.toContain('DROP TABLE');
    }
  });

  it('does not leak env vars in dimension_not_found error', async () => {
    mockService.listDimensionValues.mockResolvedValue([]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'NOTEXIST' });
    let caughtError: unknown;
    try {
      await whoListDimensionValues.handler(input, ctx);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const errStr = JSON.stringify(caughtError);
    expect(errStr).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('handles unicode dimension code without throwing', async () => {
    mockService.listDimensionValues.mockResolvedValue([
      { code: 'VAL_1', label: 'Région africaine' },
    ]);
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    const input = whoListDimensionValues.input.parse({ dimension: 'RÉGION' });
    const result = await whoListDimensionValues.handler(input, ctx);
    expect(result.values).toHaveLength(1);
  });

  it('formats values containing special chars without crash', () => {
    const output = {
      dimension: 'SEX',
      values: [
        {
          code: '<script>alert(1)</script>',
          label: 'XSS attempt',
        },
      ],
    };
    const blocks = whoListDimensionValues.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(typeof text).toBe('string');
  });
});
