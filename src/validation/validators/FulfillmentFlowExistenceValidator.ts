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

const NAME = 'FulfillmentFlowExistenceValidator';

/**
 * Validates that the fulfillment flow EXISTS in the target org when deploymentIntent = 'link'.
 * Checks with exact namespace match.
 * Skips (PASS) when no fulfillment flow or when deploymentIntent = 'deploy'.
 */
export class FulfillmentFlowExistenceValidator {
  public static async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (!ctx.fulfillmentFlow) {
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: 'No fulfillment flow to validate (skipped)',
      });
    }

    if (ctx.fulfillmentFlow.deploymentIntent !== 'link') {
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: 'Fulfillment flow will be deployed, not linked (skipped)',
      });
    }

    try {
      const exists = await flowExistsByName(
        ctx.conn,
        ctx.fulfillmentFlow.apiName,
        ctx.fulfillmentFlow.namespace,
        ctx.fulfillmentFlow.flowType
      );

      if (!exists) {
        const namespaceStr = ctx.fulfillmentFlow.namespace
          ? ` (namespace: ${ctx.fulfillmentFlow.namespace})`
          : ' (no namespace)';
        return await Promise.resolve({
          name: NAME,
          status: 'FAIL',
          message: `Fulfillment flow '${ctx.fulfillmentFlow.apiName}'${namespaceStr} not found in target org. Cannot link to non-existent flow.`,
        });
      }

      return await Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: `Fulfillment flow '${ctx.fulfillmentFlow.apiName}' exists in target org`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Promise.resolve({
        name: NAME,
        status: 'FAIL',
        message: `Error checking fulfillment flow existence: ${message}`,
      });
    }
  }
}

export const fulfillmentFlowExistenceValidator: Validator = {
  validate: (ctx) => FulfillmentFlowExistenceValidator.validate(ctx),
};
