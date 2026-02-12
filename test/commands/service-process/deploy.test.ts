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
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import ServiceProcessDeploy from '../../../src/commands/service-process/deploy.js';

describe('service-process deploy', () => {
  const $$ = new TestContext();

  beforeEach(() => {
    stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('fails with clear error when input-zip has no flow files', async () => {
    try {
      await ServiceProcessDeploy.run(['--target-org', 'test@org.com', '--input-zip', './schemas']);
      expect.fail('Expected command to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).to.include('No flow files found');
      expect(message).to.include('templateData.json');
      expect(message).to.include('.flow-meta.xml');
    }
  });

  it('fails with clear error when input-zip has no flow files (--json)', async () => {
    try {
      await ServiceProcessDeploy.run(['--target-org', 'test@org.com', '--input-zip', './schemas', '--json']);
      expect.fail('Expected command to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).to.include('No flow files found');
    }
  });
});
