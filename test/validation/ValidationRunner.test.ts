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
import type { ValidationContext, Validator } from '../../src/validation/types.js';
import { ValidationRunner } from '../../src/validation/ValidationRunner.js';
import type { ValidatorWithMetadata } from '../../src/validation/validators/index.js';

describe('ValidationRunner', () => {
  const fakeConn = { getApiVersion: () => '66.0' } as ValidationContext['conn'];

  function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return { conn: fakeConn, ...overrides };
  }

  const passValidator: Validator = {
    validate: async () => ({ name: 'Pass', status: 'PASS', message: 'ok' }),
  };
  const failValidator: Validator = {
    validate: async () => ({ name: 'Fail', status: 'FAIL', message: 'failed' }),
  };

  describe('runValidations', () => {
    it('returns results and empty failures when all validators PASS', async () => {
      const validators: Validator[] = [passValidator, passValidator];
      const { results, failures } = await ValidationRunner.runValidations(ctx(), validators);
      expect(results).to.have.lengthOf(2);
      expect(results.every((r) => r.status === 'PASS')).to.be.true;
      expect(failures).to.have.lengthOf(0);
    });

    it('returns failures when some validators FAIL', async () => {
      const validators: Validator[] = [passValidator, failValidator, passValidator];
      const { results, failures } = await ValidationRunner.runValidations(ctx(), validators);
      expect(results).to.have.lengthOf(3);
      expect(failures).to.have.lengthOf(1);
      expect(failures[0].name).to.equal('Fail');
      expect(failures[0].status).to.equal('FAIL');
      expect(failures[0].message).to.equal('failed');
    });

    it('passes context to each validator', async () => {
      let receivedCtx: ValidationContext | undefined;
      const spyValidator: Validator = {
        validate: async (c) => {
          receivedCtx = c;
          return { name: 'Spy', status: 'PASS', message: 'ok' };
        },
      };
      const context = ctx({ metadataApiVersion: '66.0' });
      await ValidationRunner.runValidations(context, [spyValidator]);
      expect(receivedCtx).to.equal(context);
      expect(receivedCtx!.metadataApiVersion).to.equal('66.0');
    });
  });

  describe('runValidationsOrThrow', () => {
    it('returns results when all PASS and does not throw', async () => {
      const { results, failures } = await ValidationRunner.runValidationsOrThrow(ctx(), [passValidator]);
      expect(results).to.have.lengthOf(1);
      expect(failures).to.have.lengthOf(0);
    });

    it('throws ValidationError with failures when any validator FAIL', async () => {
      const validators: Validator[] = [passValidator, failValidator];
      try {
        await ValidationRunner.runValidationsOrThrow(ctx(), validators);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.failures).to.have.lengthOf(1);
        expect(ve.failures![0].name).to.equal('Fail');
        expect(ve.message).to.include('Validation failed');
        expect(ve.message).to.include('Fail');
      }
    });
  });

  describe('runValidationsWithProgress', () => {
    it('runs quick validators and returns when no FlowDeployment validator', async () => {
      const validators: ValidatorWithMetadata[] = [
        { validator: passValidator, name: 'A', description: 'Check A' },
        { validator: passValidator, name: 'B', description: 'Check B' },
      ];
      const started: string[] = [];
      const completed: Array<{ name: string; success: boolean }> = [];
      const context = ctx({
        onValidatorStart: (name) => started.push(name),
        onValidatorComplete: (name, success) => completed.push({ name, success }),
      });
      const { results, failures } = await ValidationRunner.runValidationsWithProgress(context, validators);
      expect(results).to.have.lengthOf(2);
      expect(failures).to.have.lengthOf(0);
      expect(started).to.deep.equal(['A', 'B']);
      expect(completed).to.deep.equal([
        { name: 'A', success: true },
        { name: 'B', success: true },
      ]);
    });

    it('throws when a quick validator FAIL and does not run FlowDeployment', async () => {
      const validators: ValidatorWithMetadata[] = [
        { validator: failValidator, name: 'QuickCheck', description: 'Quick' },
        { validator: passValidator, name: 'FlowDeployment', description: 'Flow' },
      ];
      try {
        await ValidationRunner.runValidationsWithProgress(ctx(), validators);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.failures).to.have.lengthOf(1);
        expect(ve.failures![0].name).to.equal('Fail');
      }
    });

    it('runs FlowDeployment validator when all quick validators PASS', async () => {
      const flowValidator: Validator = {
        validate: async () => ({ name: 'FlowDeployment', status: 'PASS', message: 'flow ok' }),
      };
      const validators: ValidatorWithMetadata[] = [
        { validator: passValidator, name: 'Quick', description: 'Quick' },
        { validator: flowValidator, name: 'FlowDeployment', description: 'Flow check' },
      ];
      const started: string[] = [];
      const context = ctx({
        onValidatorStart: (name) => started.push(name),
      });
      const { results } = await ValidationRunner.runValidationsWithProgress(context, validators);
      expect(results).to.have.lengthOf(2);
      expect(started).to.include('FlowDeployment');
      expect(results.some((r) => r.name === 'FlowDeployment')).to.be.true;
    });

    it('throws when FlowDeployment validator FAIL', async () => {
      const flowFail: Validator = {
        validate: async () => ({ name: 'FlowDeployment', status: 'FAIL', message: 'flow failed' }),
      };
      const validators: ValidatorWithMetadata[] = [
        { validator: passValidator, name: 'Quick', description: 'Quick' },
        { validator: flowFail, name: 'FlowDeployment', description: 'Flow' },
      ];
      try {
        await ValidationRunner.runValidationsWithProgress(ctx(), validators);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.failures).to.have.lengthOf(1);
        expect(ve.failures![0].name).to.equal('FlowDeployment');
      }
    });
  });
});
