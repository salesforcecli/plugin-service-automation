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

const NAME = 'OrgApiVersionValidator';

/**
 * Validates that the API version in org-metadata.json matches the connected org's version
 * (or the --api-version flag if provided). Fails when org-metadata.json API version is not present.
 */
export class OrgApiVersionValidator {
  public static validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (ctx.metadataApiVersion == null || ctx.metadataApiVersion.length === 0) {
      return Promise.resolve({
        name: NAME,
        status: 'FAIL',
        message: 'org-metadata.json API version is required but not present',
      });
    }

    // Validate API version format (e.g., 65.0, 66.0)
    const versionPattern = /^\d+\.\d+$/;
    if (!versionPattern.test(ctx.metadataApiVersion)) {
      return Promise.resolve({
        name: NAME,
        status: 'FAIL',
        message: `org-metadata.json API version has invalid format: ${ctx.metadataApiVersion}. Expected format: X.Y (e.g., 65.0, 66.0)`,
      });
    }

    try {
      const referenceVersion = ctx.expectedApiVersion ?? ctx.conn.getApiVersion();
      if (ctx.metadataApiVersion !== referenceVersion) {
        const suffix = ctx.expectedApiVersion ? ' (--api-version)' : ' (target org version)';
        return Promise.resolve({
          name: NAME,
          status: 'FAIL',
          message: `API version mismatch: package v${ctx.metadataApiVersion} cannot be deployed to target org v${referenceVersion}${suffix}.`,
        });
      }
      return Promise.resolve({
        name: NAME,
        status: 'PASS',
        message: `org-metadata.json API version matches: ${ctx.metadataApiVersion}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Promise.resolve({ name: NAME, status: 'FAIL', message: `Error checking API version: ${message}` });
    }
  }
}

export const orgApiVersionValidator: Validator = { validate: (ctx) => OrgApiVersionValidator.validate(ctx) };
