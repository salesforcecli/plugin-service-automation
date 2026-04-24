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

import { expect } from 'chai';
import type { ValidationContext } from '../../../src/validation/types.js';
import { MinApiVersionValidator } from '../../../src/validation/validators/MinApiVersionValidator.js';
import { MIN_SERVICE_PROCESS_API_VERSION } from '../../../src/utils/apiVersion.js';

describe('MinApiVersionValidator', () => {
  /** Build context with a fake conn.getApiVersion so we don't stub Connection.prototype (avoids conflict with deploy tests). */
  function ctx(overrides: Partial<ValidationContext> & { connGetApiVersion?: () => string } = {}): ValidationContext {
    const { connGetApiVersion, ...rest } = overrides as Partial<ValidationContext> & {
      connGetApiVersion?: () => string;
    };
    return {
      conn: {
        getApiVersion: connGetApiVersion ?? (() => '66.0'),
      } as ValidationContext['conn'],
      ...rest,
    };
  }

  it('returns PASS when org API version meets minimum', async () => {
    const result = await MinApiVersionValidator.validate(ctx());
    expect(result.name).to.equal('MinApiVersion');
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include(MIN_SERVICE_PROCESS_API_VERSION);
  });

  it('returns PASS when expectedApiVersion (from flag) meets minimum', async () => {
    const result = await MinApiVersionValidator.validate(
      ctx({ expectedApiVersion: '67.0', connGetApiVersion: () => '65.0' })
    );
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('67.0');
  });

  it('returns FAIL when org API version is below minimum', async () => {
    const result = await MinApiVersionValidator.validate(ctx({ connGetApiVersion: () => '65.0' }));
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('65.0');
    expect(result.message).to.include(MIN_SERVICE_PROCESS_API_VERSION);
    expect(result.message).to.include('Target org');
  });

  it('returns FAIL when expectedApiVersion is below minimum', async () => {
    const result = await MinApiVersionValidator.validate(
      ctx({ expectedApiVersion: '64.0', connGetApiVersion: () => '66.0' })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('--api-version');
  });

  it('returns FAIL when getApiVersion throws', async () => {
    const result = await MinApiVersionValidator.validate(
      ctx({
        connGetApiVersion: () => {
          throw new Error('Connection error');
        },
      })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('Error checking API version');
    expect(result.message).to.include('Connection error');
  });
});
