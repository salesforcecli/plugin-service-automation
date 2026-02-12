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
import got from 'got';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Build the Connect API path. Callers must pass only the resource path under Connect
 * (e.g. 'appointments' or 'appointments/123'); leading slash is optional.
 */
function buildConnectPath(path: string, apiVersion: string): string {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `/services/data/v${apiVersion}/connect/${normalizedPath}`;
}

/**
 * Request the Connect API. path must be the resource path under Connect only
 * (e.g. 'appointments' or 'appointments/123'); the utility prepends /services/data/v{version}/connect/.
 */
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
  const relativePath = buildConnectPath(path, apiVersion);
  const url = connection.normalizeUrl(relativePath);
  const method = options?.method ?? 'GET';

  const { accessToken } = connection.getConnectionOptions();
  if (!accessToken) {
    throw new Error('Connection missing accessToken');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };

  const gotOptions: {
    method: HttpMethod;
    headers: Record<string, string>;
    body?: string | Buffer;
    json?: Record<string, unknown>;
  } = { method, headers };

  if (method !== 'GET' && options?.body !== undefined) {
    if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
      gotOptions.body = options.body;
    } else {
      gotOptions.json = options.body as Record<string, unknown>;
    }
  }

  const response = await got(url, gotOptions).json<T>();
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
