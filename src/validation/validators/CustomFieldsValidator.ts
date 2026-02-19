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

const NAME = 'CustomFieldsValidator';

/**
 * Validates that each custom field (object + field) exists in the org.
 * Returns a result; never throws. Skips (PASS) when context.customFields is missing or empty.
 */
export class CustomFieldsValidator {
  public static async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const refs = ctx.customFields;
    if (!refs?.length) {
      return { name: NAME, status: 'PASS', message: 'No customFields provided (skipped)' };
    }

    const missing: Array<{ object: string; field: string }> = [];
    try {
      const byObject = new Map<string, string[]>();
      for (const ref of refs) {
        const list = byObject.get(ref.objectApiName) ?? [];
        if (!list.includes(ref.fieldApiName)) list.push(ref.fieldApiName);
        byObject.set(ref.objectApiName, list);
      }

      const entries = Array.from(byObject.entries());
      const describes = await Promise.all(entries.map(([objectApiName]) => ctx.conn.sobject(objectApiName).describe()));

      for (let i = 0; i < entries.length; i++) {
        const [objectApiName, fieldNames] = entries[i];
        const describe = describes[i];
        const existingNames = new Set((describe.fields ?? []).map((f: { name: string }) => f.name));
        for (const fieldApiName of fieldNames) {
          if (!existingNames.has(fieldApiName)) {
            missing.push({ object: objectApiName, field: fieldApiName });
          }
        }
      }

      if (missing.length > 0) {
        const msg = missing.map((m) => `${m.object}.${m.field}`).join(', ');
        return { name: NAME, status: 'FAIL', message: `Custom fields missing: ${msg}` };
      }
      return { name: NAME, status: 'PASS', message: `All ${refs.length} custom field(s) present` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: NAME, status: 'FAIL', message: `Error: ${message}` };
    }
  }
}

export const customFieldsValidator: Validator = { validate: (ctx) => CustomFieldsValidator.validate(ctx) };
