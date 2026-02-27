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

import type { ValidationContext, ValidationResult, Validator } from '../types.js';
import {
  MIN_SERVICE_PROCESS_API_VERSION,
  isApiVersionAtLeast,
  getUnsupportedApiVersionMessage,
} from '../../utils/apiVersion.js';

const NAME = 'MinApiVersion';

/**
 * Validates that the effective API version (--api-version or org default) is at least the required minimum
 * (e.g. 66.0). Fails with a clear message when the version is too low.
 */
export class MinApiVersionValidator {
  public static validate(ctx: ValidationContext): Promise<ValidationResult> {
    try {
      const effectiveVersion = ctx.expectedApiVersion ?? ctx.conn.getApiVersion();
      if (!isApiVersionAtLeast(effectiveVersion, MIN_SERVICE_PROCESS_API_VERSION)) {
        return Promise.resolve({
          name: NAME,
          status: 'FAIL',
          message: getUnsupportedApiVersionMessage(effectiveVersion, Boolean(ctx.expectedApiVersion)),
        });
      }
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: `API version ${effectiveVersion} meets minimum required (v${MIN_SERVICE_PROCESS_API_VERSION})`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Promise.resolve({ name: NAME, status: 'FAIL', message: `Error checking API version: ${message}` });
    }
  }
}

export const minApiVersionValidator: Validator = { validate: (ctx) => MinApiVersionValidator.validate(ctx) };
