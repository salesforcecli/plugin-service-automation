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
import ServiceProcessRetrieve from '../../../src/commands/service-process/retrieve.js';

describe('service-process retrieve', () => {
  const $$ = new TestContext();

  beforeEach(() => {
    stubSfCommandUx($$.SANDBOX);
    $$.SANDBOX.stub(Connection.prototype, 'getApiVersion').returns('66.0');
    $$.SANDBOX.stub(PreflightValidator, 'validate').resolves();
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs retrieve command', async () => {
    const result = await ServiceProcessRetrieve.run([
      '--service-process-id',
      '01txx0000008ABC',
      '--target-org',
      'test@org.com',
    ]);
    expect(result).to.have.property('success', true);
    expect(result).to.have.property('serviceProcess');
    expect(result.serviceProcess).to.have.property('id');
    expect(result.serviceProcess).to.have.property('name');
    expect(result).to.have.property('zipFilePath').that.is.a('string');
    expect(result).to.have.property('files').that.is.an('array');
  });

  it('runs retrieve command with --json', async () => {
    const result = await ServiceProcessRetrieve.run([
      '--service-process-id',
      '01txx0000008ABC',
      '--target-org',
      'test@org.com',
      '--json',
    ]);
    expect(result).to.have.property('success', true);
    expect(result).to.have.property('serviceProcess');
    expect(result.serviceProcess).to.have.keys('id', 'name');
    expect(result).to.have.property('zipFilePath').that.is.a('string');
    expect(result).to.have.property('files').that.is.an('array');
    expect(result.files[0]).to.have.property('name');
    expect(result.files[0]).to.have.property('type');
    expect(result.files[0]).to.have.property('filePath');
  });
});
