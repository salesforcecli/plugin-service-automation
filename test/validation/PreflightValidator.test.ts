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

import { TestContext } from '@salesforce/core/testSetup';
import type { Connection, Org } from '@salesforce/core';
import { expect } from 'chai';
import { InsufficientAccessError } from '../../src/errors.js';
import { PreflightValidator } from '../../src/validation/PreflightValidator.js';

describe('PreflightValidator', () => {
  const $$ = new TestContext();

  let connection: Connection;
  let org: Org;

  beforeEach(() => {
    const queryStub = $$.SANDBOX.stub();
    connection = { query: queryStub } as unknown as Connection;
    org = { getUsername: () => 'user@example.com' } as unknown as Org;
  });

  afterEach(() => {
    $$.restore();
  });

  it('throws InsufficientAccessError when no permission set records returned', async () => {
    (connection.query as ReturnType<typeof $$.SANDBOX.stub>).resolves({ records: [] });

    try {
      await PreflightValidator.validate(connection, org);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(InsufficientAccessError);
      expect((err as Error).message).to.include('UnifiedCatalogAddOn');
    }
  });

  it('throws InsufficientAccessError when user query returns no records', async () => {
    (connection.query as ReturnType<typeof $$.SANDBOX.stub>)
      .onFirstCall()
      .resolves({ records: [{ Id: '0PSxx', Name: 'UnifiedCatalogAdminPsl' }] })
      .onSecondCall()
      .resolves({ records: [] });

    try {
      await PreflightValidator.validate(connection, org);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(InsufficientAccessError);
      expect((err as Error).message).to.include('Permission Set is missing on the context user');
    }
  });

  it('throws InsufficientAccessError when user has no permission set assignment', async () => {
    (connection.query as ReturnType<typeof $$.SANDBOX.stub>)
      .onFirstCall()
      .resolves({ records: [{ Id: '0PSxx', Name: 'UnifiedCatalogAdminPsl' }] })
      .onSecondCall()
      .resolves({ records: [{ Id: '005xx' }] })
      .onThirdCall()
      .resolves({ records: [] });

    try {
      await PreflightValidator.validate(connection, org);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(InsufficientAccessError);
      expect((err as Error).message).to.include('Permission Set is missing on the context user');
    }
  });

  it('does not throw when user has permission set and assignment', async () => {
    (connection.query as ReturnType<typeof $$.SANDBOX.stub>)
      .onFirstCall()
      .resolves({ records: [{ Id: '0PSxx', Name: 'UnifiedCatalogAdminPsl' }] })
      .onSecondCall()
      .resolves({ records: [{ Id: '005UserId' }] })
      .onThirdCall()
      .resolves({ records: [{ Id: '0PAxx', AssigneeId: '005UserId' }] });

    await PreflightValidator.validate(connection, org);
  });
});
