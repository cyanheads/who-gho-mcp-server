/**
 * @fileoverview Shared offline upstream for the contract-integration lane. Boots the
 * real GhoService against an in-memory store and installs a strict fetch fake in front
 * of the GHO OData API, so `toolContractSuite` drives the whole definition → handler →
 * service → query-string path without a network call. Not a test file — the lane's
 * include glob is `*.test.ts`.
 * @module tests/integration/gho-upstream
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  createFetchMock,
  createInMemoryStorage,
  type FetchMockHarness,
  type FetchMockRoute,
} from '@cyanheads/mcp-ts-core/testing';
import { afterAll, beforeAll } from 'vitest';
import { initGhoService } from '@/services/gho/gho-service.js';

/** Matches the `baseUrl` default in src/config/server-config.ts, trailing slash stripped. */
export const BASE = 'https://ghoapi.azureedge.net/api';

/** Builds the OData envelope shape the GHO API returns for a collection. */
export function odata(value: unknown[], count = value.length): Response {
  return Response.json({ '@odata.count': count, value });
}

/**
 * Registers the routes as the only reachable upstream for the file, and initializes
 * the service singleton the tool handlers resolve through. Unrouted requests throw,
 * so a missed stub surfaces as a failing test rather than a live API call.
 */
export function useGhoUpstream(...routes: FetchMockRoute[]): FetchMockHarness {
  const upstream = createFetchMock(routes);
  beforeAll(() => {
    upstream.install();
    initGhoService({} as AppConfig, createInMemoryStorage());
  });
  afterAll(() => {
    upstream.restore();
  });
  return upstream;
}
