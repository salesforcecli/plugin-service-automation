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
import { MaxApiVersionValidator } from '../../../src/validation/validators/MaxApiVersionValidator.js';

describe('MaxApiVersionValidator', () => {
  function ctx(
    overrides: Partial<ValidationContext> & {
      connRetrieveMaxApiVersion?: () => Promise<string>;
    } = {}
  ): ValidationContext {
    const { connRetrieveMaxApiVersion, ...rest } = overrides as Partial<ValidationContext> & {
      connRetrieveMaxApiVersion?: () => Promise<string>;
    };
    return {
      conn: {
        retrieveMaxApiVersion: connRetrieveMaxApiVersion ?? (async () => '67.0'),
      } as ValidationContext['conn'],
      ...rest,
    };
  }

  it('returns PASS when --api-version is not provided', async () => {
    const result = await MaxApiVersionValidator.validate(ctx());
    expect(result.name).to.equal('MaxApiVersion');
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('skipped');
  });

  it('returns PASS when expectedApiVersion is equal to org max', async () => {
    const result = await MaxApiVersionValidator.validate(ctx({ expectedApiVersion: '67.0' }));
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('67.0');
  });

  it('returns PASS when expectedApiVersion is below org max', async () => {
    const result = await MaxApiVersionValidator.validate(ctx({ expectedApiVersion: '66.0' }));
    expect(result.status).to.equal('PASS');
  });

  it('returns FAIL when expectedApiVersion is above org max', async () => {
    const result = await MaxApiVersionValidator.validate(ctx({ expectedApiVersion: '68.0' }));
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('Invalid --api-version 68.0');
    expect(result.message).to.include('67.0');
  });

  it('returns FAIL when retrieveMaxApiVersion throws', async () => {
    const result = await MaxApiVersionValidator.validate(
      ctx({
        expectedApiVersion: '67.0',
        connRetrieveMaxApiVersion: async () => {
          throw new Error('Connection error');
        },
      })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('Error checking max API version');
    expect(result.message).to.include('Connection error');
  });
});
