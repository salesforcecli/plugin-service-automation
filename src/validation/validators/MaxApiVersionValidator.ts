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

const NAME = 'MaxApiVersion';

const parseVersion = (version: string): { major: number; minor: number } => {
  const [majorRaw = '0', minorRaw = '0'] = version.split('.');
  return {
    major: Number.parseInt(majorRaw, 10),
    minor: Number.parseInt(minorRaw, 10),
  };
};

const isVersionGreaterThan = (candidate: string, max: string): boolean => {
  const c = parseVersion(candidate);
  const m = parseVersion(max);
  if (c.major !== m.major) return c.major > m.major;
  return c.minor > m.minor;
};

/**
 * Validates that --api-version (when provided) is not greater than org-supported maximum API version.
 */
export class MaxApiVersionValidator {
  public static async validate(ctx: ValidationContext): Promise<ValidationResult> {
    try {
      if (!ctx.expectedApiVersion) {
        return {
          name: NAME,
          status: 'PASS',
          message: 'No --api-version provided; max API version check skipped',
        };
      }

      const maxApiVersion = await ctx.conn.retrieveMaxApiVersion();
      if (isVersionGreaterThan(ctx.expectedApiVersion, maxApiVersion)) {
        return {
          name: NAME,
          status: 'FAIL',
          message: `Invalid --api-version ${ctx.expectedApiVersion}. Maximum API version supported by org is ${maxApiVersion}.`,
        };
      }

      return {
        name: NAME,
        status: 'PASS',
        message: `API version ${ctx.expectedApiVersion} is within org maximum supported version (${maxApiVersion})`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: NAME,
        status: 'FAIL',
        message: `Error checking max API version: ${message}`,
      };
    }
  }
}

export const maxApiVersionValidator: Validator = { validate: (ctx) => MaxApiVersionValidator.validate(ctx) };
