/**
 * @fileoverview Tool-contract coverage for who_list_indicators — walking the catalog by
 * nextOffset through the real service's $top/$skip slice, clamped and unclamped, and the
 * past-the-end page, against a stubbed upstream.
 * @module tests/integration/who-list-indicators.int.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

/** One entry past two full clamped pages, so a clamped walk reaches a third page. */
const CATALOG = Array.from({ length: 1001 }, (_, i) => ({
  IndicatorCode: `IND_${String(i).padStart(4, '0')}`,
  IndicatorName: `Indicator ${i}`,
}));

const upstream = useGhoUpstream({
  match: (request) => request.url.startsWith(`${BASE}/Indicator?`),
  respond: (request) => {
    const query = new URL(request.url).searchParams;
    const skip = Number(query.get('$skip'));
    return odata(CATALOG.slice(skip, skip + Number(query.get('$top'))), CATALOG.length);
  },
});

interface ListPage {
  hasMore: boolean;
  indicators: { indicatorCode: string }[];
  nextOffset?: number;
  notice?: string;
  offset: number;
}

/** Follows nextOffset from offset 0 until a page omits it; bounded so a loop fails fast. */
async function walk(limit: number) {
  const before = upstream.calls.length;
  const pages: { page: ListPage; text: string }[] = [];
  let offset: number | undefined = 0;
  for (let i = 0; i < 10 && offset !== undefined; i++) {
    const result = await runToolContract(whoListIndicators, { limit, offset });
    expect(result.isError).toBeFalsy();
    const page = result.structuredContent as unknown as ListPage;
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    pages.push({ page, text });
    offset = page.nextOffset;
  }
  expect(offset).toBeUndefined();
  const requests = upstream.calls.slice(before).map(({ request }) => {
    const query = new URL(request.url).searchParams;
    return [query.get('$skip'), query.get('$top')];
  });
  return { pages, requests };
}

const more = (n: number, offset: number) =>
  `Showing ${n} of 1001 indicators (offset ${offset}). Request offset ${offset + n} for the next page, raise the limit (max 500), or use who_search_indicators to narrow by keyword.`;
const CLAMP = 'Requested limit 501; applied limit 500.';

describe('who_list_indicators paging walk', () => {
  it('reaches every catalog entry exactly once by following nextOffset', async () => {
    const { pages, requests } = await walk(400);
    expect(requests).toEqual([
      ['0', '400'],
      ['400', '400'],
      ['800', '400'],
    ]);
    expect(pages.map(({ page }) => [page.offset, page.nextOffset, page.hasMore])).toEqual([
      [0, 400, true],
      [400, 800, true],
      [800, undefined, false],
    ]);
    expect(pages.map(({ page }) => page.notice)).toEqual([more(400, 0), more(400, 400), undefined]);
    expect(pages.flatMap(({ page }) => page.indicators.map((i) => i.indicatorCode))).toEqual(
      CATALOG.map((i) => i.IndicatorCode),
    );
    for (const { page, text } of pages) {
      expect(text).toContain(`**offset:** ${page.offset}`);
      if (page.notice) expect(text).toContain(page.notice);
      else expect(text).not.toContain('nextOffset');
    }
  });

  it('composes the clamp notice onto every page of a clamped walk', async () => {
    const { pages, requests } = await walk(501);
    expect(requests).toEqual([
      ['0', '500'],
      ['500', '500'],
      ['1000', '500'],
    ]);
    expect(pages.map(({ page }) => [page.offset, page.indicators.length, page.nextOffset])).toEqual(
      [
        [0, 500, 500],
        [500, 500, 1000],
        [1000, 1, undefined],
      ],
    );
    expect(pages.map(({ page }) => page.notice)).toEqual([
      `${CLAMP} ${more(500, 0)}`,
      `${CLAMP} ${more(500, 500)}`,
      CLAMP,
    ]);
    for (const { page, text } of pages) expect(text).toContain(page.notice);
  });

  it.each([1001, 5000])(
    'returns an empty page with a past-the-end notice at offset %i',
    async (offset) => {
      const result = await runToolContract(whoListIndicators, { offset });
      expect(result.isError).toBeFalsy();
      const notice = `Offset ${offset} is at or beyond the 1001 indicators in the catalog; the last reachable offset is 1000.`;
      expect(result.structuredContent).toEqual({
        indicators: [],
        totalCount: 1001,
        offset,
        hasMore: false,
        pageInfo: `offset ${offset}, showing 0 of 1001`,
        notice,
      });
      expect(JSON.stringify(result.content)).toContain(notice);
      expect(
        new URL(upstream.calls[upstream.calls.length - 1]!.request.url).searchParams.get('$skip'),
      ).toBe(String(offset));
    },
  );
});
