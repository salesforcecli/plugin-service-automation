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
import type { DeploymentContext } from '../../src/services/deploymentContext.js';
import { ValidationError } from '../../src/errors.js';
import { formatSuccessJsonOutput, formatFailureJsonOutput } from '../../src/utils/deployJsonFormatter.js';

function minimalContext(overrides: Partial<DeploymentContext> = {}): DeploymentContext {
  return {
    workspace: '/nonexistent-workspace-' + Date.now(),
    inputZip: '/tmp/input.zip',
    org: {} as DeploymentContext['org'],
    connection: {} as DeploymentContext['connection'],
    deploymentMetadata: { version: '1' },
    templateDataExtract: { apexClassNames: [], customFields: [], name: 'TestProcess' },
    filePaths: [],
    needsDeployment: true,
    needsIntakeDeployment: false,
    needsFulfillmentDeployment: false,
    rollback: { needed: false },
    cleanupWorkspace: () => {},
    startTime: Date.now(),
    phaseTimings: new Map(),
    recordPhaseTime: () => {},
    cleanup: () => {},
    ...overrides,
  };
}

describe('deployJsonFormatter', () => {
  describe('formatSuccessJsonOutput', () => {
    it('returns status 0 and result with package, options, serviceProcess', () => {
      const ctx = minimalContext({ targetServiceProcessId: '01txx0000008ABC' });
      const out = formatSuccessJsonOutput(ctx, '/path/to.zip', true, false);
      expect(out.status).to.equal(0);
      expect(out.result.package).to.deep.equal({ type: 'zip', path: '/path/to.zip' });
      expect(out.result.options).to.deep.equal({ linkIntake: true, linkFulfillment: false });
      expect(out.result.serviceProcess?.id).to.equal('01txx0000008ABC');
      expect(out.result.serviceProcess?.name).to.equal('TestProcess');
      expect(out.result.serviceProcess?.created).to.be.true;
      expect(out.warnings).to.deep.equal([]);
    });

    it('includes intake and fulfillment artifacts when deploymentMetadata has flows', () => {
      const ctx = minimalContext({
        targetServiceProcessId: '01t',
        deploymentMetadata: {
          version: '1',
          intakeFlow: {
            apiName: 'IntakeFlow',
            namespace: null,
            deploymentIntent: 'deploy',
            flowType: 'regular',
          },
          fulfillmentFlow: {
            apiName: 'FulfillFlow',
            namespace: null,
            deploymentIntent: 'link',
            flowType: 'regular',
          },
        },
        deployedFlows: [{ id: '0FLOW1', fullName: 'IntakeFlow', definitionId: '0DEF1' }],
      });
      const out = formatSuccessJsonOutput(ctx, '/z.zip', true, true);
      expect(out.result.serviceProcess?.artifacts?.intakeFlow).to.deep.include({
        type: 'Flow',
        name: 'IntakeFlow',
        id: '0FLOW1',
        deployed: true,
        linked: true,
      });
      expect(out.result.serviceProcess?.artifacts?.fulfillmentFlow).to.deep.include({
        type: 'Flow',
        name: 'FulfillFlow',
        deployed: false,
        linked: true,
      });
    });
  });

  describe('formatFailureJsonOutput', () => {
    it('returns status 1 and result with errors when no context', () => {
      const err = new Error('Deployment failed');
      const out = formatFailureJsonOutput('/path/to.zip', err, false, false);
      expect(out.status).to.equal(1);
      expect(out.result.serviceProcess).to.be.null;
      expect(out.result.errors).to.have.lengthOf(1);
      expect(out.result.errors?.[0].type).to.equal('Error');
      expect(out.result.errors?.[0].message).to.equal('Deployment failed');
    });

    it('includes serviceProcess when context has targetServiceProcessId', () => {
      const ctx = minimalContext({ targetServiceProcessId: '01txx0000008ABC' });
      const err = new Error('Linking failed');
      const out = formatFailureJsonOutput('/p.zip', err, true, false, ctx);
      expect(out.result.serviceProcess).to.not.be.null;
      expect(out.result.serviceProcess?.id).to.equal('01txx0000008ABC');
      expect(out.result.serviceProcess?.name).to.equal('TestProcess');
      expect(out.result.serviceProcess?.created).to.be.true;
    });

    it('includes rollback info when rollbackAttempted is true', () => {
      const err = new Error('Failed');
      const out = formatFailureJsonOutput('/p.zip', err, false, false, undefined, true, false);
      expect(out.result.rollback).to.deep.equal({
        attempted: true,
        succeeded: false,
        manualCleanupRequired: true,
      });
    });

    it('builds errors from ValidationError with failures', () => {
      const err = new ValidationError('Validation failed', [
        { name: 'MinApiVersion', status: 'FAIL', message: 'API 65.0 required' },
      ]);
      const out = formatFailureJsonOutput('/p.zip', err, false, false);
      expect(out.result.errors).to.have.lengthOf(1);
      expect(out.result.errors?.[0].type).to.equal('ValidationError');
      expect(out.result.errors?.[0].message).to.equal('API 65.0 required');
    });
  });
});
