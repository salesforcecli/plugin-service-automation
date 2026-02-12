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

import { Connection } from '@salesforce/core';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type RequestBody = string | Buffer;

function buildConnectUrl(path: string, apiVersion: string): string {
  // Absolute path already fully qualified
  if (path.startsWith('/services/data/')) {
    return path;
  }

  // Starts with /connect
  if (path.startsWith('/connect/')) {
    return `/services/data/v${apiVersion}${path}`;
  }

  // Generic path cases
  if (path.startsWith('/')) {
    return `/services/data/v${apiVersion}/connect${path}`;
  }

  return `/services/data/v${apiVersion}/connect/${path}`;
}

export async function requestConnectApi<T = unknown>(
  connection: Connection,
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    apiVersion?: string;
    headers?: Record<string, string>;
  }
): Promise<T> {
  const apiVersion = options?.apiVersion ?? connection.getApiVersion();
  const url = buildConnectUrl(path, apiVersion);
  const method = options?.method ?? 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };

  let requestBody: RequestBody | undefined;
  if (method !== 'GET') {
    if (options?.body === undefined) {
      requestBody = undefined;
    } else if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
      requestBody = options.body;
    } else {
      requestBody = JSON.stringify(options.body);
    }
  }

  // Connection.request will inject Authorization automatically
  const response = await connection.request<T>({
    method,
    url,
    headers,
    // Only include body for non-GET to avoid issues on some endpoints
    body: requestBody,
  });

  return response;
}

export function getConnect<T = unknown>(connection: Connection, path: string, apiVersion?: string): Promise<T> {
  return requestConnectApi<T>(connection, path, { method: 'GET', apiVersion });
}

export function postConnect<T = unknown>(
  connection: Connection,
  path: string,
  body?: unknown,
  apiVersion?: string
): Promise<T> {
  return requestConnectApi<T>(connection, path, { method: 'POST', body, apiVersion });
}

export function patchConnect<T = unknown>(
  connection: Connection,
  path: string,
  body?: unknown,
  apiVersion?: string
): Promise<T> {
  return requestConnectApi<T>(connection, path, { method: 'PATCH', body, apiVersion });
}
