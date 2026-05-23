/**
 * @fileoverview Tests for the who_list_dimensions tool.
 * @module tests/tools/who-list-dimensions.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListDimensions } from '@/mcp-server/tools/definitions/who-list-dimensions.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensions: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListDimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dimension list', async () => {
    mockService.listDimensions.mockResolvedValue([
      { code: 'COUNTRY', title: 'Country' },
      { code: 'SEX', title: 'Sex' },
    ]);
    const ctx = createMockContext();
    const input = whoListDimensions.input.parse({});
    const result = await whoListDimensions.handler(input, ctx);
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0]).toMatchObject({ code: 'COUNTRY', title: 'Country' });
  });

  it('formats output with all dimensions', () => {
    const output = {
      dimensions: [
        { code: 'COUNTRY', title: 'Country' },
        { code: 'SEX', title: 'Sex' },
      ],
    };
    const blocks = whoListDimensions.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('COUNTRY');
    expect(text).toContain('Country');
    expect(text).toContain('SEX');
    expect(text).toContain('2 total');
  });
});
