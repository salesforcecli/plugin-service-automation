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
import { ValidationError } from '../../src/errors.js';
import { DeploymentLogger } from '../../src/utils/deploymentLogger.js';

function createCommandStub(jsonEnabled = false): {
  log: (msg?: string) => void;
  spinner: { start: (msg: string) => void; stop: (msg?: string) => void };
  jsonEnabled: () => boolean;
} {
  const logStub = (): void => {};
  return {
    log: logStub,
    spinner: { start: (): void => {}, stop: (): void => {} },
    jsonEnabled: () => jsonEnabled,
  };
}

describe('DeploymentLogger', () => {
  it('constructs with command and verbose flag', () => {
    const command = createCommandStub();
    const logger = new DeploymentLogger(command as never, false);
    expect(logger).to.be.instanceOf(DeploymentLogger);
  });

  it('isVerbose returns true when constructed with verbose true', () => {
    const logger = new DeploymentLogger(createCommandStub() as never, true);
    expect(logger.isVerbose()).to.be.true;
  });

  it('isVerbose returns false when constructed with verbose false', () => {
    const logger = new DeploymentLogger(createCommandStub() as never, false);
    expect(logger.isVerbose()).to.be.false;
  });

  describe('when jsonEnabled is false (shouldLog true)', () => {
    it('logHeader calls command.log with title and optional orgUrl', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logHeader('My Title', 'https://org.salesforce.com');
      expect(logs).to.include('');
      expect(logs).to.include('My Title');
      expect(logs).to.include('Org Connected: https://org.salesforce.com');
    });

    it('startPhase starts spinner', () => {
      let started = '';
      const command = {
        ...createCommandStub(false),
        spinner: {
          start: (msg: string): void => {
            started = msg;
          },
          stop: (): void => {},
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.startPhase('Validating');
      expect(started).to.equal('Validating');
    });

    it('succeedPhase stops spinner and logs duration', () => {
      const stopped: string[] = [];
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
        spinner: {
          start: (): void => {},
          stop: (msg?: string): void => {
            if (msg) stopped.push(msg);
          },
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.startPhase('Phase');
      logger.succeedPhase('Phase');
      expect(stopped.length).to.equal(1);
      expect(stopped[0]).to.include('Phase');
    });

    it('succeedPhase with details logs items and verbose when verbose', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
        spinner: { start: (): void => {}, stop: (): void => {} },
      };
      const logger = new DeploymentLogger(command as never, true);
      logger.startPhase('P');
      logger.succeedPhase('P', {
        items: [{ label: 'L', value: 'V', condition: true }],
        verbose: { key: 'val' },
      });
      expect(logs.some((l) => l.includes('L') && l.includes('V'))).to.be.true;
      expect(logs.some((l) => l.includes('key') && l.includes('val'))).to.be.true;
    });

    it('failPhase logs ValidationError via formatter', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
        spinner: { start: (): void => {}, stop: (): void => {} },
      };
      const logger = new DeploymentLogger(command as never, false);
      const err = new ValidationError('Failed', [{ name: 'MinApiVersion', status: 'FAIL', message: 'v65 required' }]);
      logger.startPhase('Validate');
      logger.failPhase('Validate', err);
      expect(logs.some((l) => l.includes('API version') || l.includes('v65'))).to.be.true;
    });

    it('failPhase logs plain Error message', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
        spinner: { start: (): void => {}, stop: (): void => {} },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.startPhase('P');
      logger.failPhase('P', new Error('Network error'));
      expect(logs.some((l) => l.includes('ERROR') && l.includes('Network error'))).to.be.true;
    });

    it('logItem logs label and value when condition true', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logItem('Name', 'MyFlow', true);
      expect(logs.some((l) => l.includes('Name') && l.includes('MyFlow'))).to.be.true;
    });

    it('logItem does not log when condition false', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logItem('Name', 'Val', false);
      expect(logs.length).to.equal(0);
    });

    it('logItems logs single value or multiple with nesting', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logItems('Flows', ['A', 'B'], true);
      expect(logs.some((l) => l.includes('Flows') && l.includes('2'))).to.be.true;
    });

    it('logTreeStructure logs name and tree items', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logTreeStructure('MyFlow', [{ label: 'Id', value: '0FLOW' }]);
      expect(logs.some((l) => l.includes('Name') && l.includes('MyFlow'))).to.be.true;
      expect(logs.some((l) => l.includes('Id') && l.includes('0FLOW'))).to.be.true;
    });

    it('logSuccess logs green check and message', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logSuccess('Done');
      expect(logs.some((l) => l.includes('Done'))).to.be.true;
    });

    it('logSummary logs status, service process, record id, components, total time', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logSummary({
        status: 'SUCCESS',
        serviceProcessName: 'SP',
        serviceProcessId: '01txx',
        deployedCount: 1,
        linkedCount: 0,
        duration: 1000,
      });
      expect(logs.some((l) => l.includes('Summary'))).to.be.true;
      expect(logs.some((l) => l.includes('SUCCESS'))).to.be.true;
      expect(logs.some((l) => l.includes('01txx'))).to.be.true;
    });

    it('logVerbose logs key/value when verbose', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(false),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, true);
      logger.logVerbose('key', 'value');
      expect(logs.some((l) => l.includes('key') && l.includes('value'))).to.be.true;
    });
  });

  describe('when jsonEnabled is true (shouldLog false)', () => {
    it('logHeader does not call log', () => {
      const logs: string[] = [];
      const command = {
        ...createCommandStub(true),
        log: (msg = ''): void => {
          logs.push(msg);
        },
      };
      const logger = new DeploymentLogger(command as never, false);
      logger.logHeader('Title', 'https://org.com');
      expect(logs.length).to.equal(0);
    });

    it('startPhase and succeedPhase do not throw', () => {
      const command = createCommandStub(true);
      const logger = new DeploymentLogger(command as never, false);
      logger.startPhase('P');
      logger.succeedPhase('P');
    });
  });
});
