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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestContext } from '@salesforce/core/testSetup';
import { Connection } from '@salesforce/core';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import type { SinonStub } from 'sinon';
import JSZip from 'jszip';
import { PreflightValidator } from '../../../src/validation/PreflightValidator.js';
import { MaxApiVersionValidator } from '../../../src/validation/validators/MaxApiVersionValidator.js';
import ServiceProcessDeploy from '../../../src/commands/service-process/deploy.js';

describe('service-process deploy', () => {
  const $$ = new TestContext();
  let maxApiValidatorStub: SinonStub;

  beforeEach(() => {
    stubSfCommandUx($$.SANDBOX);
    $$.SANDBOX.stub(Connection.prototype, 'getApiVersion').returns('67.0');
    $$.SANDBOX.stub(PreflightValidator, 'validate').resolves();
    maxApiValidatorStub = $$.SANDBOX.stub(MaxApiVersionValidator, 'validate').resolves({
      name: 'MaxApiVersion',
      status: 'PASS' as const,
    });
  });

  afterEach(() => {
    $$.restore();
  });

  /** Create a zip containing only templateData.json (no flow files) for "no flow files" error tests. */
  async function createZipWithNoFlows(): Promise<{ zipPath: string; cleanup: () => void }> {
    const zip = new JSZip();
    zip.file('templateData.json', JSON.stringify({ name: 'Test', targetObject: 'Case' }));
    const buffer = await zip.generateAsync({ type: 'uint8array' });
    const zipPath = path.join(os.tmpdir(), `deploy-test-no-flows-${Date.now()}.zip`);
    fs.writeFileSync(zipPath, buffer);
    const cleanup = (): void => {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        // ignore
      }
    };
    return { zipPath, cleanup };
  }

  it('fails with clear error when input-zip has no flow files', async () => {
    const { zipPath, cleanup } = await createZipWithNoFlows();
    try {
      await ServiceProcessDeploy.run(['--target-org', 'test@org.com', '--input-zip', zipPath]);
      expect.fail('Expected command to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Now expects service-process.metadata.json error since we check for it first
      expect(message).to.include('service-process.metadata.json not found');
    } finally {
      cleanup();
    }
  });

  it('fails with clear error when input-zip has no flow files (--json)', async () => {
    const { zipPath, cleanup } = await createZipWithNoFlows();
    try {
      const result = await ServiceProcessDeploy.run(['--target-org', 'test@org.com', '--input-zip', zipPath, '--json']);
      // Command returns the result object (SfCommand wraps it with status/warnings)
      expect(result).to.have.property('package');
      expect(result).to.have.property('options');
      expect((result as { options: { linkIntake: boolean; linkFulfillment: boolean } }).options).to.deep.equal({
        linkIntake: false,
        linkFulfillment: false,
      });
      expect(result).to.have.property('serviceProcess', null);
      expect(result).to.have.property('errors');
      expect((result as { errors: Array<{ message: string }> }).errors).to.be.an('array');
      const errors = (result as { errors: Array<{ message: string }> }).errors;
      expect(errors[0].message).to.include('service-process.metadata.json not found');
    } finally {
      cleanup();
    }
  });

  it('fails when --api-version is above org max', async () => {
    const { zipPath, cleanup } = await createZipWithNoFlows();
    maxApiValidatorStub.resolves({
      name: 'MaxApiVersion',
      status: 'FAIL' as const,
      message: 'Invalid --api-version 67.0. Maximum API version supported by org is 66.0.',
    });
    try {
      await ServiceProcessDeploy.run(['--target-org', 'test@org.com', '--input-zip', zipPath, '--api-version', '67.0']);
      expect.fail('Expected command to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).to.include('Maximum API version supported by org is 66.0');
    } finally {
      cleanup();
    }
  });
});
