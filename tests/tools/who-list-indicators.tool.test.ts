/**
 * @fileoverview Tests for the who_list_indicators tool.
 * @module tests/tools/who-list-indicators.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns a page of indicators with enrichment', async () => {
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

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(3059);
    expect(enrichment.hasMore).toBe(true);
    expect(enrichment.pageInfo).toContain('3059');
  });

  it('sets hasMore false and pageInfo correct at end of catalog', async () => {
    mockService.listIndicators.mockResolvedValue({
      indicators: [{ indicatorCode: 'LAST', indicatorName: 'Last Indicator' }],
      total: 3,
    });
    const ctx = createMockContext();
    const input = whoListIndicators.input.parse({ limit: 50, offset: 2 });
    await whoListIndicators.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.hasMore).toBe(false);
    expect(enrichment.totalCount).toBe(3);
  });

  it('formats output with indicator codes and names', () => {
    const output = {
      indicators: [{ indicatorCode: 'CODE_1', indicatorName: 'Indicator One' }],
    };
    const blocks = whoListIndicators.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('CODE_1');
    expect(text).toContain('Indicator One');
  });
});
