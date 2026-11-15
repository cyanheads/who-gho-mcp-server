/**
 * @fileoverview Tests for the who_list_indicators tool.
 * @module tests/tools/who-list-indicators.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listIndicators: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

/** `n` catalog entries starting at position `start`. */
const page = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    indicatorCode: `CODE_${start + i}`,
    indicatorName: `Indicator ${start + i}`,
  }));

/** Runs the tool through the production parse against a catalog page of `n` of `total`. */
async function listPage(input: Record<string, unknown>, n: number, total: number) {
  const offset = (input.offset as number | undefined) ?? 0;
  mockService.listIndicators.mockResolvedValue({ indicators: page(offset, n), total });
  const result = await runToolContract(whoListIndicators, input);
  const text = result.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { result, structured: result.structuredContent as Record<string, unknown>, text };
}

describe('whoListIndicators — current paging surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads limit and offset to the service and renders the page position on both surfaces', async () => {
    const { result, structured, text } = await listPage({ limit: 10, offset: 30 }, 10, 100);
    expect(result.isError).toBeFalsy();
    expect(mockService.listIndicators).toHaveBeenCalledWith(
      { limit: 10, offset: 30 },
      expect.anything(),
    );
    expect(structured).toMatchObject({
      totalCount: 100,
      hasMore: true,
      pageInfo: 'offset 30, showing 10 of 100',
    });
    expect(text).toContain('**100 total**');
    expect(text).toContain('**hasMore:** true');
    expect(text).toContain('offset 30, showing 10 of 100');
  });

  it('carries no notice on an unclamped final page', async () => {
    const { result, structured } = await listPage({ limit: 50, offset: 90 }, 10, 100);
    expect(result.isError).toBeFalsy();
    expect(structured.hasMore).toBe(false);
    expect(structured).not.toHaveProperty('notice');
  });

  it('returns an empty page with no notice and no error when the catalog is empty', async () => {
    const { result, structured } = await listPage({}, 0, 0);
    expect(result.isError).toBeFalsy();
    expect(structured).toMatchObject({ indicators: [], totalCount: 0, hasMore: false });
    expect(structured).not.toHaveProperty('notice');
  });

  it('carries the clamp notice alone on a clamped final page', async () => {
    const { result, structured, text } = await listPage({ limit: 501, offset: 3000 }, 92, 3092);
    expect(result.isError).toBeFalsy();
    expect(mockService.listIndicators).toHaveBeenCalledWith(
      { limit: 500, offset: 3000 },
      expect.anything(),
    );
    expect(structured.hasMore).toBe(false);
    expect(structured.notice).toBe('Requested limit 501; applied limit 500.');
    expect(text).toContain('Requested limit 501; applied limit 500.');
  });
});

describe('whoListIndicators — offset, nextOffset, and paging notices (#42)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const MORE_DEFAULT =
    'Showing 50 of 3092 indicators (offset 0). Request offset 50 for the next page, raise the limit (max 500), or use who_search_indicators to narrow by keyword.';
  const MORE_CLAMPED =
    'Showing 500 of 3092 indicators (offset 0). Request offset 500 for the next page, raise the limit (max 500), or use who_search_indicators to narrow by keyword.';
  const PAST_99999 =
    'Offset 99999 is at or beyond the 3092 indicators in the catalog; the last reachable offset is 3091.';
  const CLAMP = 'Requested limit 501; applied limit 500.';

  it.each([
    {
      name: 'default page',
      input: {},
      n: 50,
      total: 3092,
      offset: 0,
      nextOffset: 50,
      notice: MORE_DEFAULT,
    },
    {
      name: 'middle page',
      input: { limit: 10, offset: 30 },
      n: 10,
      total: 100,
      offset: 30,
      nextOffset: 40,
      notice:
        'Showing 10 of 100 indicators (offset 30). Request offset 40 for the next page, raise the limit (max 500), or use who_search_indicators to narrow by keyword.',
    },
    { name: 'final partial page', input: { offset: 3050 }, n: 42, total: 3092, offset: 3050 },
    {
      name: 'offset equal to totalCount',
      input: { offset: 3092 },
      n: 0,
      total: 3092,
      offset: 3092,
      notice:
        'Offset 3092 is at or beyond the 3092 indicators in the catalog; the last reachable offset is 3091.',
    },
    {
      name: 'past-the-end page',
      input: { offset: 99999 },
      n: 0,
      total: 3092,
      offset: 99999,
      notice: PAST_99999,
    },
    { name: 'zero-total page', input: {}, n: 0, total: 0, offset: 0 },
    { name: 'zero-total page at an offset', input: { offset: 5 }, n: 0, total: 0, offset: 5 },
    {
      name: 'clamped middle page',
      input: { limit: 501 },
      n: 500,
      total: 3092,
      offset: 0,
      nextOffset: 500,
      notice: `${CLAMP} ${MORE_CLAMPED}`,
    },
    {
      name: 'clamped past-the-end page',
      input: { limit: 501, offset: 99999 },
      n: 0,
      total: 3092,
      offset: 99999,
      notice: `${CLAMP} ${PAST_99999}`,
    },
    {
      name: 'clamped final page',
      input: { limit: 501, offset: 3000 },
      n: 92,
      total: 3092,
      offset: 3000,
      notice: CLAMP,
    },
    {
      name: 'clamped zero-total page',
      input: { limit: 501 },
      n: 0,
      total: 0,
      offset: 0,
      notice: CLAMP,
    },
  ] as {
    name: string;
    input: Record<string, unknown>;
    n: number;
    total: number;
    offset: number;
    nextOffset?: number;
    notice?: string;
  }[])('$name carries the same paging fields on both surfaces', async (c) => {
    const { result, structured, text } = await listPage(c.input, c.n, c.total);
    expect(result.isError).toBeFalsy();
    expect(structured.indicators).toHaveLength(c.n);
    expect(structured.offset).toBe(c.offset);
    expect(structured.hasMore).toBe(c.nextOffset !== undefined);
    expect(text).toContain(`**offset:** ${c.offset}`);

    if (c.nextOffset === undefined) {
      expect(structured).not.toHaveProperty('nextOffset');
      expect(text).not.toContain('nextOffset');
    } else {
      expect(structured.nextOffset).toBe(c.nextOffset);
      expect(text).toContain(`**nextOffset:** ${c.nextOffset}`);
    }

    if (c.notice === undefined) {
      expect(structured).not.toHaveProperty('notice');
    } else {
      expect(structured.notice).toBe(c.notice);
      // Written once, after any clamp segment, and rendered as plain text like the sibling.
      expect(text.split(c.notice)).toHaveLength(2);
      expect(text).not.toContain(`> ${c.notice}`);
    }
    for (const segment of ['Showing ', 'is at or beyond']) {
      if (!c.notice?.includes(segment)) expect(text).not.toContain(segment);
    }
  });
});

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
