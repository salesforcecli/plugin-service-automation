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

/* eslint-disable prefer-arrow-callback -- Mocha: this.skip(), this.timeout() */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import type { RetrieveResult } from '../../../src/services/retrieveServiceProcessService.js';
import type { DeployResult } from '../../../src/types/jsonOutput.js';
import {
  getDeployInputZipPath,
  getTestkitOrgUsername,
  getTestkitServiceProcessId,
  isServiceProcessE2ENutsEnabled,
} from '../integration/env.js';

type ListCommandJsonResult = {
  serviceProcesses: Array<{ id: string; name: string; description?: string; status: string }>;
  count: number;
  total: number;
};

function logDeployNuts(
  context: string,
  org: string,
  zip: string,
  jsonOutput: { status?: number; result: DeployResult }
): void {
  const { result } = jsonOutput;
  const sp = result.serviceProcess;
  // eslint-disable-next-line no-console -- org NUT: correlate deploy success with Product2 (Unified Catalog) in the org
  console.log(
    `[service-process-org.nut] ${context} | org=${org} | zip=${zip} | serviceProcess.id=${sp?.id ?? 'null'} | name=${
      sp?.name ?? 'n/a'
    } | created=${sp?.created ?? 'n/a'}`
  );
}

describe('service-process org NUTs (TESTKIT_ORG_USERNAME)', function () {
  this.timeout(600_000);
  // Commands use --json; assertions validate structured CLI output via jsonOutput.

  let session: TestSession;
  /** Snapshot for SF_USE_GENERIC_UNIX_KEYCHAIN — testkit forces `true`, which breaks decrypt for macOS keychain–backed auth when using TESTKIT_HOMEDIR. */
  let sfKeychainSnapshot: { previous: string | undefined } | undefined;
  let useProfileKeychain = false;

  before(function () {
    if (!getTestkitOrgUsername()) {
      this.skip();
    }
  });

  before(async function () {
    useProfileKeychain = Boolean(process.env.TESTKIT_HOMEDIR);
    sfKeychainSnapshot = { previous: process.env.SF_USE_GENERIC_UNIX_KEYCHAIN };
    session = await TestSession.create({
      devhubAuthStrategy: 'AUTO',
      scratchOrgs: [
        {
          executable: 'sf',
          duration: 1,
          setDefault: true,
        },
      ],
    });
    // cli-plugins-testkit sets SF_USE_GENERIC_UNIX_KEYCHAIN=true so scratch/JWT auth uses file-based crypto.
    // Real ~/.sf auth on macOS is often tied to the OS keychain; keeping `true` causes AuthDecryptError for --target-org.
    if (useProfileKeychain && sfKeychainSnapshot) {
      if (sfKeychainSnapshot.previous === undefined) {
        delete process.env.SF_USE_GENERIC_UNIX_KEYCHAIN;
      } else {
        process.env.SF_USE_GENERIC_UNIX_KEYCHAIN = sfKeychainSnapshot.previous;
      }
    }
  });

  after(async function () {
    await session?.clean();
    if (sfKeychainSnapshot && useProfileKeychain) {
      if (sfKeychainSnapshot.previous === undefined) {
        delete process.env.SF_USE_GENERIC_UNIX_KEYCHAIN;
      } else {
        process.env.SF_USE_GENERIC_UNIX_KEYCHAIN = sfKeychainSnapshot.previous;
      }
    }
  });

  it('lists service processes (empty list is valid)', function () {
    const org = getTestkitOrgUsername()!;
    const { jsonOutput } = execCmd<ListCommandJsonResult>(`service-process list --target-org ${org} --json`, {
      ensureExitCode: 0,
    });
    expect(jsonOutput?.status).to.equal(0);
    const result = jsonOutput!.result;
    expect(result).to.have.property('serviceProcesses').that.is.an('array');
    expect(result).to.have.property('count').that.is.a('number');
    expect(result).to.have.property('total').that.is.a('number');
    expect(result.count).to.equal(result.serviceProcesses.length);
    for (const row of result.serviceProcesses) {
      expect(row).to.have.property('id').that.is.a('string');
      expect(row).to.have.property('name').that.is.a('string');
      expect(row)
        .to.have.property('status')
        .that.matches(/Active|Inactive/);
    }
  });

  describe('retrieve (requires TESTKIT_SERVICE_PROCESS_ID)', function () {
    before(function () {
      if (!getTestkitServiceProcessId()) {
        this.skip();
      }
    });

    it('retrieves service process package', function () {
      const org = getTestkitOrgUsername()!;
      const serviceProcessId = getTestkitServiceProcessId()!;
      const outputDir = path.join(session.dir, 'retrieve-nut-output');
      fs.mkdirSync(outputDir, { recursive: true });

      const { jsonOutput } = execCmd<RetrieveResult>(
        `service-process retrieve --target-org ${org} --service-process-id ${serviceProcessId} --output-dir ${outputDir} --json`,
        { ensureExitCode: 0 }
      );

      expect(jsonOutput?.status).to.equal(0);
      const result = jsonOutput!.result;
      expect(result.success).to.equal(true);
      expect(result.serviceProcess.id).to.equal(serviceProcessId);
      expect(result.zipFilePath).to.be.a('string');
      expect(result.files).to.be.an('array').that.is.not.empty;
      expect(fs.existsSync(result.zipFilePath), result.zipFilePath).to.equal(true);
    });
  });

  describe('deploy (requires TESTKIT_DEPLOY_INPUT_ZIP)', function () {
    before(function () {
      const zip = getDeployInputZipPath();
      if (!zip || !fs.existsSync(zip)) {
        this.skip();
      }
    });

    it('deploys from zip', function () {
      const org = getTestkitOrgUsername()!;
      const zip = getDeployInputZipPath()!;

      const { jsonOutput } = execCmd<DeployResult>(
        `service-process deploy --target-org ${org} --input-zip ${zip} --json`,
        {
          ensureExitCode: 0,
        }
      );

      expect(jsonOutput?.status).to.equal(0);
      const result = jsonOutput!.result;
      expect(result.package.type).to.equal('zip');
      expect(result.serviceProcess).to.not.equal(null);
      expect(result.serviceProcess!.id).to.be.a('string');
      expect(result.errors).to.equal(undefined);
    });
  });

  describe('E2E: deploy then list then retrieve (SERVICE_PROCESS_NUT_E2E + zip)', function () {
    let deployedId: string;

    before(function () {
      if (!isServiceProcessE2ENutsEnabled()) {
        this.skip();
      }
      const zip = getDeployInputZipPath();
      if (!zip || !fs.existsSync(zip)) {
        this.skip();
      }
    });

    it('step 1: deploys and records service process id', function () {
      const org = getTestkitOrgUsername()!;
      const zip = getDeployInputZipPath()!;

      const { jsonOutput } = execCmd<DeployResult>(
        `service-process deploy --target-org ${org} --input-zip ${zip} --json`,
        {
          ensureExitCode: 0,
        }
      );

      expect(jsonOutput?.result.serviceProcess).to.not.equal(null);
      deployedId = jsonOutput!.result.serviceProcess!.id;
      logDeployNuts('E2E step 1 deploy', org, zip, jsonOutput!);
      expect(deployedId).to.match(/^01t/i);
    });

    it('step 2: list includes deployed service process id', function () {
      const org = getTestkitOrgUsername()!;
      const { jsonOutput } = execCmd<ListCommandJsonResult>(`service-process list --target-org ${org} --json`, {
        ensureExitCode: 0,
      });
      const ids = jsonOutput!.result.serviceProcesses.map((r) => r.id);
      expect(ids).to.include(deployedId);
    });

    it('step 3: retrieves deployed service process', function () {
      const org = getTestkitOrgUsername()!;
      const outputDir = path.join(session.dir, 'retrieve-e2e-output');
      fs.mkdirSync(outputDir, { recursive: true });

      const { jsonOutput } = execCmd<RetrieveResult>(
        `service-process retrieve --target-org ${org} --service-process-id ${deployedId} --output-dir ${outputDir} --json`,
        { ensureExitCode: 0 }
      );

      expect(jsonOutput?.result.success).to.equal(true);
      expect(jsonOutput?.result.serviceProcess.id).to.equal(deployedId);
      expect(fs.existsSync(jsonOutput!.result.zipFilePath)).to.equal(true);
    });
  });
});
