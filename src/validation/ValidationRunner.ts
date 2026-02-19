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
      throw new ValidationError(`Validation failed: ${message}`);
    }
    return { results, failures };
  }
}
