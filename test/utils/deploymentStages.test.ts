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
import { DeploymentStages } from '../../src/utils/deploymentStages.js';
import { ValidationError } from '../../src/errors.js';

describe('DeploymentStages', () => {
  const commandJson = {
    jsonEnabled: () => true,
    log: () => {},
  } as unknown as import('@salesforce/sf-plugins-core').SfCommand<unknown>;

  it('constructs with command, title, orgUrl', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    expect(stages).to.be.instanceOf(DeploymentStages);
  });

  it('shouldLog returns false when command.jsonEnabled() is true', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    expect(stages.shouldLog()).to.be.false;
  });

  it('start does not throw when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.start();
  });

  it('startPhase and succeedPhase no-op when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.setValidatorCount(3);
    stages.startPhase('Validating deployment');
    stages.succeedPhase('Validating deployment');
  });

  it('failPhase does not throw when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.failPhase('Creating Service Process', new Error('Test error'));
  });

  it('failPhase with ValidationError does not throw when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    const err = new ValidationError('Validation failed', [
      { name: 'MinApiVersion', status: 'FAIL', message: 'v65 required' },
    ]);
    stages.failPhase('Validating deployment', err);
  });

  it('skipToPhase does not throw when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.skipToPhase('Done');
  });

  it('setValidatorCount and startValidatorSubstage/completeValidatorSubstage no-op when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.setValidatorCount(2);
    stages.startValidatorSubstage('V1', 'Checking API version');
    stages.completeValidatorSubstage('V1', true);
    stages.completeValidatorSubstage('V2', false);
  });

  it('setDeployingMetadataItems and logTreeStructure no-op when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.setDeployingMetadataItems([{ label: 'Flow', value: 'MyFlow' }]);
    stages.logTreeStructure('Flows', [{ label: 'Intake', value: 'IntakeFlow' }]);
    stages.clearTreeStructure();
  });

  it('logSummary does not throw when jsonEnabled', () => {
    const stages = new DeploymentStages(commandJson, 'Deploy', 'https://test.salesforce.com');
    stages.logSummary({
      status: 'SUCCESS',
      serviceProcessName: 'MyProcess',
      serviceProcessId: '01txx',
      deployedCount: 1,
      linkedCount: 1,
      duration: 5000,
    });
  });
});
