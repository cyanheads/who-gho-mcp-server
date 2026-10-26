/**
 * @fileoverview Shared bounded-read schema and clamp telemetry for tools and resources.
 * @module utils/read-limit
 */
import { type Context, z } from '@cyanheads/mcp-ts-core';
import { createCounter } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';

const clamps = createCounter(
  'gho.read_limit.clamps',
  'Read requests limited to a processing ceiling',
  '{clamps}',
);

/** Keep oversized positive integers visible to handlers so notices retain the request. */
export function readLimitSchema(ceiling: number, coerce = false) {
  const schema = (coerce ? z.coerce.number() : z.number()).int().min(1);
  // Zod's int() also advertises MAX_SAFE_INTEGER; callers need no per-call maximum.
  return getServerConfig().clampLimits ? schema.meta({ maximum: undefined }) : schema.max(ceiling);
}

/** Record each bounded request once; return a notice for composition with other notices. */
export function applyReadLimit(
  requested: number,
  ceiling: number,
  operation: string,
  ctx: Context,
) {
  const limit = Math.min(requested, ceiling);
  if (limit === requested) return { limit, notice: undefined };
  ctx.log.notice('Clamped read limit', { operation, requested, applied: limit });
  clamps.add(1, { operation });
  return { limit, notice: `Requested limit ${requested}; applied limit ${limit}.` };
}
