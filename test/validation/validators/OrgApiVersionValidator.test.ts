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
import { OrgApiVersionValidator } from '../../../src/validation/validators/OrgApiVersionValidator.js';

describe('OrgApiVersionValidator', () => {
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

  it('returns FAIL when metadataApiVersion is null', async () => {
    const result = await OrgApiVersionValidator.validate(ctx({ metadataApiVersion: undefined }));
    expect(result.name).to.equal('OrgApiVersionValidator');
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('required but not present');
  });

  it('returns FAIL when metadataApiVersion is empty string', async () => {
    const result = await OrgApiVersionValidator.validate(ctx({ metadataApiVersion: '' }));
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('required but not present');
  });

  it('returns FAIL when metadataApiVersion has invalid format', async () => {
    const result = await OrgApiVersionValidator.validate(ctx({ metadataApiVersion: '66' }));
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('invalid format');
    expect(result.message).to.include('X.Y');
  });

  it('returns FAIL when metadataApiVersion does not match org version', async () => {
    const result = await OrgApiVersionValidator.validate(
      ctx({ metadataApiVersion: '65.0', connGetApiVersion: () => '66.0' })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('mismatch');
    expect(result.message).to.include('65.0');
    expect(result.message).to.include('66.0');
    expect(result.message).to.include('org version');
  });

  it('returns FAIL when metadataApiVersion does not match expectedApiVersion (from flag)', async () => {
    const result = await OrgApiVersionValidator.validate(
      ctx({ metadataApiVersion: '66.0', expectedApiVersion: '67.0' })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('--api-version');
  });

  it('returns PASS when metadataApiVersion matches org version', async () => {
    const result = await OrgApiVersionValidator.validate(
      ctx({ metadataApiVersion: '66.0', connGetApiVersion: () => '66.0' })
    );
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('matches');
    expect(result.message).to.include('66.0');
  });

  it('returns PASS when metadataApiVersion matches expectedApiVersion', async () => {
    const result = await OrgApiVersionValidator.validate(
      ctx({ metadataApiVersion: '67.0', expectedApiVersion: '67.0' })
    );
    expect(result.status).to.equal('PASS');
  });

  it('returns FAIL when getApiVersion throws', async () => {
    const result = await OrgApiVersionValidator.validate(
      ctx({
        metadataApiVersion: '66.0',
        connGetApiVersion: () => {
          throw new Error('API error');
        },
      })
    );
    expect(result.status).to.equal('FAIL');
    expect(result.message).to.include('Error checking API version');
  });
});
