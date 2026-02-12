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

import { deployFlows } from '../../utils/flow/deployflow.js';
import type { ValidationContext, ValidationResult, Validator } from '../types.js';

const NAME = 'FlowDeploymentValidator';

/**
 * Validates that flow deployment would succeed by running a checkOnly deploy.
 * Uses context.org and context.flowFilePaths. Returns FAIL if the checkOnly deploy fails.
 * Skips (PASS) when org or flowFilePaths are missing or empty.
 */
export const flowDeploymentValidator: Validator = {
  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const { org, flowFilePaths } = ctx;
    if (!org || !flowFilePaths?.length) {
      return { name: NAME, status: 'PASS', message: 'No org or flow file paths provided (skipped)' };
    }

    try {
      await deployFlows(org, flowFilePaths, { checkOnly: true, logJson: ctx.logJson });
      return {
        name: NAME,
        status: 'PASS',
        message: `Flow deployment check passed (${flowFilePaths.length} flow(s))`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: NAME,
        status: 'FAIL',
        message: `Flow deployment would fail: ${message}`,
      };
    }
  },
};
