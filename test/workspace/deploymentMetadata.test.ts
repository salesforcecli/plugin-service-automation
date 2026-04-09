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
import { expect } from 'chai';
import type { ServiceProcessMetadata } from '../../src/workspace/deploymentMetadata.js';
import {
  readServiceProcessMetadata,
  readDeploymentMetadata,
  writeServiceProcessMetadata,
  writeDeploymentMetadata,
} from '../../src/workspace/deploymentMetadata.js';
import { SERVICE_PROCESS_METADATA_FILENAME } from '../../src/constants.js';

describe('deploymentMetadata', () => {
  let packageDir: string;

  beforeEach(async () => {
    packageDir = path.join(os.tmpdir(), `deploy-metadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(packageDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(packageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('readServiceProcessMetadata', () => {
    it('returns null when file does not exist', async () => {
      const result = await readServiceProcessMetadata(packageDir);
      expect(result).to.be.null;
    });

    it('returns parsed metadata when file exists', async () => {
      const metadata = {
        version: '1',
        org: { instanceUrl: 'https://test.salesforce.com', id: '00Dxx', apiVersion: '66.0' },
        serviceProcess: {
          intakeFlow: { apiName: 'Intake', namespace: null, deploymentIntent: 'deploy', flowType: 'regular' },
          fulfillmentFlow: { apiName: 'Fulfill', namespace: null, deploymentIntent: 'deploy', flowType: 'regular' },
        },
      };
      await fs.promises.writeFile(
        path.join(packageDir, SERVICE_PROCESS_METADATA_FILENAME),
        JSON.stringify(metadata),
        'utf-8'
      );
      const result = await readServiceProcessMetadata(packageDir);
      expect(result).to.not.be.null;
      expect(result!.version).to.equal('1');
      expect(result!.org.apiVersion).to.equal('66.0');
      expect(result!.serviceProcess.intakeFlow?.apiName).to.equal('Intake');
    });

    it('throws when file exists but is invalid JSON', async () => {
      await fs.promises.writeFile(path.join(packageDir, SERVICE_PROCESS_METADATA_FILENAME), 'not json', 'utf-8');
      try {
        await readServiceProcessMetadata(packageDir);
        expect.fail('should have thrown');
      } catch {
        // expected
      }
    });
  });

  describe('readDeploymentMetadata', () => {
    it('returns null when service-process.metadata.json does not exist', async () => {
      const result = await readDeploymentMetadata(packageDir);
      expect(result).to.be.null;
    });

    it('returns deployment shape with version and flows from service-process.metadata.json', async () => {
      const full = {
        version: '1',
        org: { instanceUrl: 'https://test.salesforce.com', id: '00Dxx', apiVersion: '66.0' },
        serviceProcess: {
          intakeFlow: { apiName: 'I', namespace: null, deploymentIntent: 'deploy', flowType: 'regular' },
          fulfillmentFlow: { apiName: 'F', namespace: null, deploymentIntent: 'deploy', flowType: 'orchestrator' },
        },
      };
      await fs.promises.writeFile(
        path.join(packageDir, SERVICE_PROCESS_METADATA_FILENAME),
        JSON.stringify(full),
        'utf-8'
      );
      const result = await readDeploymentMetadata(packageDir);
      expect(result).to.not.be.null;
      expect(result!.version).to.equal('1');
      expect(result!.intakeFlow?.apiName).to.equal('I');
      expect(result!.fulfillmentFlow?.apiName).to.equal('F');
    });
  });

  describe('writeServiceProcessMetadata', () => {
    it('writes service-process.metadata.json', async () => {
      const metadata = {
        version: '1',
        org: { instanceUrl: 'https://test.salesforce.com', id: '00Dxx', apiVersion: '66.0' },
        serviceProcess: {},
      };
      await writeServiceProcessMetadata(packageDir, metadata);
      const content = await fs.promises.readFile(path.join(packageDir, SERVICE_PROCESS_METADATA_FILENAME), 'utf-8');
      const parsed = JSON.parse(content) as ServiceProcessMetadata;
      expect(parsed.version).to.equal('1');
      expect(parsed.org.apiVersion).to.equal('66.0');
    });
  });

  describe('writeDeploymentMetadata', () => {
    it('writes deployment-metadata.json with legacy shape', async () => {
      const metadata = {
        version: '1',
        intakeFlow: {
          apiName: 'I',
          namespace: null,
          deploymentIntent: 'deploy' as const,
          flowType: 'regular' as const,
        },
        fulfillmentFlow: {
          apiName: 'F',
          namespace: null,
          deploymentIntent: 'deploy' as const,
          flowType: 'regular' as const,
        },
      };
      await writeDeploymentMetadata(packageDir, metadata);
      const content = await fs.promises.readFile(path.join(packageDir, 'deployment-metadata.json'), 'utf-8');
      const parsed = JSON.parse(content) as { version: string; intakeFlow?: { apiName: string } };
      expect(parsed.version).to.equal('1');
      expect(parsed.intakeFlow?.apiName).to.equal('I');
    });
  });
});
