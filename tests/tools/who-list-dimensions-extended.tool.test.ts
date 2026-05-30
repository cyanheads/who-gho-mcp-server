/**
 * @fileoverview Extended tests for the who_list_dimensions tool: edge cases and security assertions.
 * @module tests/tools/who-list-dimensions-extended.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListDimensions } from '@/mcp-server/tools/definitions/who-list-dimensions.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensions: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListDimensions — input validation', () => {
  it('accepts empty object (no required fields)', () => {
    expect(() => whoListDimensions.input.parse({})).not.toThrow();
  });

  it('ignores unknown fields (Zod strips extras)', () => {
    expect(() => whoListDimensions.input.parse({ unexpected: 'value' })).not.toThrow();
  });
});

describe('whoListDimensions — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty dimensions array when service returns none', async () => {
    mockService.listDimensions.mockResolvedValue([]);
    const ctx = createMockContext();
    const input = whoListDimensions.input.parse({});
    const result = await whoListDimensions.handler(input, ctx);
    expect(result.dimensions).toHaveLength(0);
  });

  it('propagates service rejection as thrown error', async () => {
    mockService.listDimensions.mockRejectedValue(new Error('GHO API unavailable'));
    const ctx = createMockContext();
    const input = whoListDimensions.input.parse({});
    await expect(whoListDimensions.handler(input, ctx)).rejects.toThrow('GHO API unavailable');
  });

  it('returns all dimensions from service faithfully', async () => {
    const dims = Array.from({ length: 20 }, (_, i) => ({
      code: `DIM_${i}`,
      title: `Dimension ${i}`,
    }));
    mockService.listDimensions.mockResolvedValue(dims);
    const ctx = createMockContext();
    const input = whoListDimensions.input.parse({});
    const result = await whoListDimensions.handler(input, ctx);
    expect(result.dimensions).toHaveLength(20);
    expect(result.dimensions[0]).toMatchObject({ code: 'DIM_0', title: 'Dimension 0' });
  });

  it('formats empty dimensions list without crashing', () => {
    const output = { dimensions: [] };
    const blocks = whoListDimensions.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('0 total');
  });

  it('format count matches actual array length', () => {
    const output = {
      dimensions: [
        { code: 'COUNTRY', title: 'Country' },
        { code: 'SEX', title: 'Sex' },
        { code: 'AGEGROUP', title: 'Age Group' },
      ],
    };
    const blocks = whoListDimensions.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('3 total');
    expect(text).toContain('COUNTRY');
    expect(text).toContain('SEX');
    expect(text).toContain('AGEGROUP');
  });
});

describe('whoListDimensions — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not leak env vars or secrets in output', async () => {
    mockService.listDimensions.mockResolvedValue([{ code: 'COUNTRY', title: 'Country' }]);
    const ctx = createMockContext();
    const input = whoListDimensions.input.parse({});
    const result = await whoListDimensions.handler(input, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/process\.env|API_KEY|SECRET|password/i);
  });

  it('format handles unicode dimension titles without throwing', () => {
    const output = {
      dimensions: [
        { code: 'PAYS', title: 'Pays (Région)' },
        { code: 'SEXE', title: '性別' },
      ],
    };
    const blocks = whoListDimensions.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('PAYS');
    expect(text).toContain('SEXE');
  });
});
