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

import { flowExistsByName } from '../../utils/flow/flowMetadata.js';
import type { ValidationContext, ValidationResult, Validator } from '../types.js';

const NAME = 'FulfillmentFlowUniquenessValidator';

/**
 * Validates that no flow with the same name as the fulfillment flow already exists in the target org
 * when deploymentIntent = 'deploy'. Checks uniqueness in target org's namespace context.
 * Skips (PASS) when no fulfillment flow or when deploymentIntent = 'link'.
 */
export class FulfillmentFlowUniquenessValidator {
  public static async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (!ctx.fulfillmentFlow) {
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: 'No fulfillment flow to validate (skipped)',
      });
    }

    if (ctx.fulfillmentFlow.deploymentIntent !== 'deploy') {
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: 'Fulfillment flow will be linked, not deployed (skipped)',
      });
    }

    try {
      // Check uniqueness in target org's namespace
      const exists = await flowExistsByName(
        ctx.conn,
        ctx.fulfillmentFlow.apiName,
        ctx.targetOrgNamespace,
        ctx.fulfillmentFlow.flowType
      );
      if (exists) {
        return await Promise.resolve({
          name: NAME,
          status: 'FAIL',
          message: `Flow '${ctx.fulfillmentFlow.apiName}' already exists in target org. Cannot deploy duplicate flow.`,
        });
      }
      return await Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: `Fulfillment flow name '${ctx.fulfillmentFlow.apiName}' is unique in target org`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Promise.resolve({
        name: NAME,
        status: 'FAIL',
        message: `Error checking fulfillment flow uniqueness: ${message}`,
      });
    }
  }
}

export const fulfillmentFlowUniquenessValidator: Validator = {
  validate: (ctx) => FulfillmentFlowUniquenessValidator.validate(ctx),
};
