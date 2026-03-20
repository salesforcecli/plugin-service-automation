/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { inspect } from 'node:util';

/**
 * Serialize a value for debug logging. Uses JSON.stringify when possible;
 * falls back to util.inspect for circular refs (e.g. HTTP IncomingMessage).
 */
export function safeStringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return inspect(value, { depth: 2, compact: true, breakLength: 80 });
  }
}

/**
 * Format an HTTP error response for debug logging. Logs only safe fields
 * (statusCode, statusMessage, body) to avoid dumping the full IncomingMessage.
 * If the value is not response-like, falls back to safeStringifyForLog.
 */
export function formatErrorResponseForLog(response: unknown): string {
  if (response === null || typeof response !== 'object') {
    return safeStringifyForLog(response);
  }
  const res = response as Record<string, unknown>;
  const statusCode = res.statusCode ?? res.status;
  const statusMessage = res.statusMessage ?? res.statusText;
  const body = res.body;
  if (statusCode !== undefined || statusMessage !== undefined || body !== undefined) {
    const parts: string[] = [];
    if (statusCode !== undefined) parts.push(`statusCode=${String(statusCode)}`);
    if (statusMessage !== undefined) parts.push(`statusMessage=${String(statusMessage)}`);
    if (body !== undefined) {
      const bodyStr =
        typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf-8') : safeStringifyForLog(body);
      parts.push(`body=${bodyStr}`);
    }
    return parts.join(', ');
  }
  return safeStringifyForLog(response);
}
