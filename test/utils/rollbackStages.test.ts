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
import { RollbackScenario } from '../../src/services/rollback.js';
import { RollbackStages, ROLLBACK_SECTION_HEADER, ROLLBACK_STEP_NAMES } from '../../src/utils/rollbackStages.js';

describe('rollbackStages', () => {
  describe('ROLLBACK_SECTION_HEADER', () => {
    it('is a string containing Rollback', () => {
      expect(ROLLBACK_SECTION_HEADER).to.be.a('string');
      expect(ROLLBACK_SECTION_HEADER).to.include('Rollback');
    });
  });

  describe('ROLLBACK_STEP_NAMES', () => {
    it('includes Unlinking components, Deleting deployed flows, Removing Service Process', () => {
      expect(ROLLBACK_STEP_NAMES).to.include('Unlinking components');
      expect(ROLLBACK_STEP_NAMES).to.include('Deleting deployed flows');
      expect(ROLLBACK_STEP_NAMES).to.include('Removing Service Process');
    });
  });

  describe('RollbackStages', () => {
    const command = {
      jsonEnabled: () => true,
    } as unknown as import('@salesforce/sf-plugins-core').SfCommand<unknown>;

    it('constructs with ServiceProcessOnly scenario', () => {
      const stages = new RollbackStages(command, RollbackScenario.ServiceProcessOnly);
      expect(stages).to.be.instanceOf(RollbackStages);
      stages.start();
      stages.gotoStage('Removing Service Process');
      stages.succeedStage('Removing Service Process');
      stages.finish(100);
    });

    it('constructs with ServiceProcessAndFlows scenario', () => {
      const stages = new RollbackStages(command, RollbackScenario.ServiceProcessAndFlows);
      expect(stages).to.be.instanceOf(RollbackStages);
      stages.start();
      stages.finish(200);
    });

    it('fail() does not throw when jsonEnabled is true', () => {
      const stages = new RollbackStages(command, RollbackScenario.ServiceProcessOnly);
      stages.fail(new Error('Test error'));
    });
  });
});
