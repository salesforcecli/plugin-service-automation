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

import { ValidationError } from '../errors.js';
import type { ValidationContext, ValidationResult, Validator } from './types.js';
import type { ValidatorWithMetadata } from './validators/index.js';

export type RunValidationsResult = {
  results: ValidationResult[];
  failures: ValidationResult[];
};

export class ValidationRunner {
  /**
   * Runs all validators in parallel. Does not throw.
   */
  public static async runValidations(ctx: ValidationContext, validators: Validator[]): Promise<RunValidationsResult> {
    const results = await Promise.all(validators.map((v) => v.validate(ctx)));
    const failures = results.filter((r) => r.status === 'FAIL');
    return { results, failures };
  }

  /**
   * Runs validations and throws if any have status FAIL.
   */
  public static async runValidationsOrThrow(
    ctx: ValidationContext,
    validators: Validator[]
  ): Promise<RunValidationsResult> {
    const { results, failures } = await ValidationRunner.runValidations(ctx, validators);
    if (failures.length > 0) {
      const message = failures.map((r) => `${r.name}: ${r.message ?? r.status}`).join('; ');
      throw new ValidationError(`Validation failed: ${message}`, failures);
    }
    return { results, failures };
  }

  /**
   * Runs validators with progress tracking in stages. Calls onValidatorStart and onValidatorComplete callbacks.
   * First runs fast validators (isLongRunning !== true) in parallel.
   * Only if all fast validators pass, runs long-running validators (isLongRunning === true).
   * This prevents wasting time on expensive validators when quick checks fail.
   * Throws ValidationError if any validators fail.
   */
  public static async runValidationsWithProgress(
    ctx: ValidationContext,
    validators: ValidatorWithMetadata[]
  ): Promise<RunValidationsResult> {
    // Explicitly separate FlowDeploymentValidator from other validators
    // FlowDeploymentValidator runs in Stage 2 because it's expensive (40-50s) and should only run if quick checks pass
    const quickValidators = validators.filter((v) => v.name !== 'FlowDeployment');
    const flowDeploymentValidator = validators.find((v) => v.name === 'FlowDeployment');

    const allResults: ValidationResult[] = [];

    // Stage 1: Run quick validators in parallel
    const quickValidatorPromises = quickValidators.map(async ({ validator, name, description }) => {
      ctx.onValidatorStart?.(name, description);
      try {
        const result = await validator.validate(ctx);
        ctx.onValidatorComplete?.(name, result.status === 'PASS');
        return result;
      } catch (error) {
        ctx.onValidatorComplete?.(name, false);
        throw error;
      }
    });

    const quickResults = await Promise.all(quickValidatorPromises);
    allResults.push(...quickResults);

    const quickFailures = quickResults.filter((r) => r.status === 'FAIL');

    // If any quick validator failed, don't run FlowDeploymentValidator
    if (quickFailures.length > 0) {
      const message = quickFailures.map((r) => `${r.name}: ${r.message ?? r.status}`).join('; ');
      throw new ValidationError(`Validation failed: ${message}`, quickFailures);
    }

    // Stage 2: Run FlowDeploymentValidator (only if quick checks passed)
    if (flowDeploymentValidator) {
      const { validator, name, description } = flowDeploymentValidator;
      ctx.onValidatorStart?.(name, description);
      try {
        const result = await validator.validate(ctx);
        ctx.onValidatorComplete?.(name, result.status === 'PASS');
        allResults.push(result);

        if (result.status === 'FAIL') {
          const message = `${result.name}: ${result.message ?? result.status}`;
          throw new ValidationError(`Validation failed: ${message}`, [result]);
        }
      } catch (error) {
        ctx.onValidatorComplete?.(name, false);
        throw error;
      }
    }

    return { results: allResults, failures: [] };
  }
}
