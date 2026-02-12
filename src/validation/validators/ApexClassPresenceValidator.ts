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

const NAME = 'ApexClassPresenceValidator';

/**
 * Validates that the given Apex class names exist in the org.
 * Returns a result; never throws. Skips (PASS) when context.apexClassNames is missing or empty.
 */
export const apexClassPresenceValidator: Validator = {
  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const classNames = ctx.apexClassNames;
    if (!classNames?.length) {
      return { name: NAME, status: 'PASS', message: 'No apexClassNames provided (skipped)' };
    }

    try {
      const quoted = classNames.map((n) => `'${String(n).replace(/'/g, "\\'")}'`).join(',');
      const soql = `SELECT Id, Name FROM ApexClass WHERE Name IN (${quoted})`;
      const result = await ctx.conn.tooling.query<{ Name: string }>(soql);
      const foundNames = new Set((result.records ?? []).map((r) => r.Name));
      const missing = classNames.filter((n) => !foundNames.has(n));

      if (missing.length > 0) {
        return {
          name: NAME,
          status: 'FAIL',
          message: `Apex classes not found in org: ${missing.join(', ')}`,
        };
      }
      return { name: NAME, status: 'PASS', message: `All ${classNames.length} Apex class(es) present` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: NAME, status: 'FAIL', message: `Error: ${message}` };
    }
  },
};
