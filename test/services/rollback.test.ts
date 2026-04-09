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
import { RollbackService, RollbackScenario, type RollbackData } from '../../src/services/rollback.js';

/**
 * RollbackService.rollbackServiceProcessOnly and rollbackServiceProcessAndFlows call getConnect/patchConnect
 * from the connectApi ESM module. Sinon cannot stub ESM namespace exports ("ES Modules cannot be stubbed"),
 * so we only test the public enum and types here. Full rollback behavior is covered by integration tests
 * or would require dependency injection of the Connect API in the rollback module.
 */
describe('RollbackService', () => {
  describe('RollbackScenario enum', () => {
    it('exports ServiceProcessOnly and ServiceProcessAndFlows', () => {
      expect(RollbackScenario.ServiceProcessOnly).to.equal('ServiceProcessOnly');
      expect(RollbackScenario.ServiceProcessAndFlows).to.equal('ServiceProcessAndFlows');
    });
  });

  describe('RollbackData type', () => {
    it('accepts targetServiceProcessId and optional deployedFlows and deployedFlowNames', () => {
      const data: RollbackData = { targetServiceProcessId: '01txx0000008ABC' };
      expect(data.targetServiceProcessId).to.equal('01txx0000008ABC');
      const withFlows: RollbackData = {
        targetServiceProcessId: '01txx',
        deployedFlows: [{ id: '0FLOW', fullName: 'MyFlow', definitionId: '0DEF' }],
        deployedFlowNames: {
          intakeForm: { originalName: 'I', deployedName: 'I' },
          fulfillmentFlow: { originalName: 'F', deployedName: 'F' },
        },
      };
      expect(withFlows.deployedFlows).to.have.lengthOf(1);
      expect(withFlows.deployedFlowNames?.intakeForm?.originalName).to.equal('I');
    });
  });

  it('RollbackService is a class with static rollback methods', () => {
    expect(typeof RollbackService.rollbackServiceProcessOnly).to.equal('function');
    expect(typeof RollbackService.rollbackServiceProcessAndFlows).to.equal('function');
  });
});
