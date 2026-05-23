/**
 * @fileoverview Tests for the who_list_indicators tool.
 * @module tests/tools/who-list-indicators.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

describe('whoListIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a page of indicators with pagination info', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [
        { indicatorCode: 'CODE_1', indicatorName: 'Indicator One' },
        { indicatorCode: 'CODE_2', indicatorName: 'Indicator Two' },
      ],
      total: 3059,
    });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 2, offset: 0 });
    const result = await whoListIndicators.handler(input, ctx);
    expect(result.indicators).toHaveLength(2);
    expect(result.total).toBe(3059);
    expect(result.hasMore).toBe(true);
  });

  it('sets hasMore false when at end of catalog', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'LAST', indicatorName: 'Last Indicator' }],
      total: 3,
    });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 50, offset: 2 });
    const result = await whoListIndicators.handler(input, ctx);
    expect(result.hasMore).toBe(false);
  });

  it('formats output with total and hasMore', () => {
    const output = {
      indicators: [{ indicatorCode: 'CODE_1', indicatorName: 'Indicator One' }],
      total: 3059,
      hasMore: true,
    };
    const blocks = whoListIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CODE_1');
    expect(text).toContain('Indicator One');
    expect(text).toContain('3059');
    expect(text).toContain('hasMore: true');
  });
});
