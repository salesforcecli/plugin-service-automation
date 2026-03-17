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
import { Connection } from '@salesforce/core';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { PreflightValidator } from '../../../src/validation/PreflightValidator.js';
import { MinApiVersionValidator } from '../../../src/validation/validators/MinApiVersionValidator.js';
import ServiceProcessList from '../../../src/commands/service-process/list.js';

describe('service-process list', () => {
  const $$ = new TestContext();

  beforeEach(() => {
    stubSfCommandUx($$.SANDBOX);
    $$.SANDBOX.stub(Connection.prototype, 'getApiVersion').returns('66.0');
    $$.SANDBOX.stub(PreflightValidator, 'validate').resolves();
    $$.SANDBOX.stub(MinApiVersionValidator, 'validate').resolves({
      name: 'MinApiVersion',
      status: 'PASS' as const,
    });

    const countResult = { done: true, records: [], totalSize: 2 };
    const selectResult = {
      done: true,
      records: [
        { Id: '01txx000000001', Name: 'Service Process One', Description: 'First', IsActive: true },
        { Id: '01txx000000002', Name: 'Service Process Two', Description: undefined, IsActive: false },
      ],
      totalSize: 2,
    };
    $$.SANDBOX.stub(Connection.prototype, 'query')
      .onFirstCall()
      .resolves(countResult)
      .onSecondCall()
      .resolves(selectResult);
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs list command and returns service processes', async () => {
    const result = await ServiceProcessList.run(['--target-org', 'test@org.com']);
    expect(result).to.have.property('serviceProcesses').that.is.an('array');
    expect(result.serviceProcesses).to.have.lengthOf(2);
    expect(result.serviceProcesses[0]).to.include({
      id: '01txx000000001',
      name: 'Service Process One',
      status: 'Active',
    });
    expect(result.serviceProcesses[1]).to.include({
      id: '01txx000000002',
      name: 'Service Process Two',
      status: 'Inactive',
    });
    expect(result).to.include({ count: 2, total: 2 });
  });

  it('runs list command with --json', async () => {
    const result = await ServiceProcessList.run(['--target-org', 'test@org.com', '--json']);
    expect(result).to.have.property('serviceProcesses').that.is.an('array');
    expect(result.serviceProcesses[0]).to.have.keys('id', 'name', 'description', 'status');
  });
});
