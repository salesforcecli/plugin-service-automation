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
import type { Connection, Org } from '@salesforce/core';
import { createDeploymentContext } from '../../src/services/deploymentContext.js';
import type { DeploymentMetadata } from '../../src/workspace/deploymentMetadata.js';
import type { TemplateDataExtract } from '../../src/workspace/templateData.js';

describe('deploymentContext', () => {
  const mockDeploymentMetadata: DeploymentMetadata = {
    version: '1',
    intakeFlow: { apiName: 'Intake', namespace: null, deploymentIntent: 'deploy', flowType: 'regular' },
    fulfillmentFlow: { apiName: 'Fulfill', namespace: null, deploymentIntent: 'deploy', flowType: 'regular' },
  };
  const mockTemplateExtract: TemplateDataExtract = {
    apexClassNames: [],
    customFields: [],
    name: 'SP',
    intakeFlowName: 'Intake',
    fulfillmentFlowType: 'regular',
  };

  function minimalOptions() {
    return {
      workspace: '/tmp/ws',
      inputZip: '/tmp/ws.zip',
      org: {} as Org,
      connection: {} as Connection,
      deploymentMetadata: mockDeploymentMetadata,
      templateDataExtract: mockTemplateExtract,
      filePaths: ['/tmp/ws/metadata/flows/a.flow-meta.xml'],
      needsDeployment: true,
      needsIntakeDeployment: true,
      needsFulfillmentDeployment: true,
      cleanupWorkspace: () => {},
    };
  }

  describe('createDeploymentContext', () => {
    it('returns context with all required fields and default rollback state', () => {
      const cleanup = (): void => {};
      const ctx = createDeploymentContext({ ...minimalOptions(), cleanupWorkspace: cleanup });
      expect(ctx.workspace).to.equal('/tmp/ws');
      expect(ctx.inputZip).to.equal('/tmp/ws.zip');
      expect(ctx.deploymentMetadata).to.deep.equal(mockDeploymentMetadata);
      expect(ctx.templateDataExtract).to.deep.equal(mockTemplateExtract);
      expect(ctx.filePaths).to.have.lengthOf(1);
      expect(ctx.needsDeployment).to.be.true;
      expect(ctx.needsIntakeDeployment).to.be.true;
      expect(ctx.needsFulfillmentDeployment).to.be.true;
      expect(ctx.rollback).to.deep.equal({ needed: false });
      expect(ctx.startTime).to.be.a('number');
      expect(ctx.phaseTimings).to.be.instanceOf(Map);
      expect(ctx.cleanupWorkspace).to.equal(cleanup);
    });

    it('recordPhaseTime stores duration in phaseTimings', () => {
      const ctx = createDeploymentContext(minimalOptions());
      ctx.recordPhaseTime('prepare', 100);
      expect(ctx.phaseTimings.get('prepare')).to.equal(100);
    });

    it('cleanup calls cleanupWorkspace', () => {
      let called = false;
      const ctx = createDeploymentContext({
        ...minimalOptions(),
        cleanupWorkspace: () => {
          called = true;
        },
      });
      ctx.cleanup();
      expect(called).to.be.true;
    });

    it('cleanup calls cleanupWorkspaceZip when set', () => {
      let workspaceCalled = false;
      let zipCalled = false;
      const ctx = createDeploymentContext({
        ...minimalOptions(),
        cleanupWorkspace: () => {
          workspaceCalled = true;
        },
      });
      ctx.cleanupWorkspaceZip = () => {
        zipCalled = true;
      };
      ctx.cleanup();
      expect(zipCalled).to.be.true;
      expect(workspaceCalled).to.be.true;
    });
  });
});
