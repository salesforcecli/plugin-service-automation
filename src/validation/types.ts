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

import type { Connection, Org } from '@salesforce/core';

/**
 * Result of a single validation run. Validators return this; they never throw.
 */
export type ValidationResult = {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message?: string;
};

/** Reference to a custom field (object + field) for validation. */
export type CustomFieldRef = {
  objectApiName: string;
  fieldApiName: string;
};

/** Optional logger for JSON output (e.g. deploy response). Passed from command through service to validators/utils. */
export type LogJsonFn = (data: unknown) => void;

/**
 * Context passed into the validation layer. Validators read only; never mutate.
 */
export type ValidationContext = {
  conn: Connection;
  /** Required for FlowDeploymentValidator: runs checkOnly deploy to verify flow deployment would succeed. */
  org?: Org;
  /** Absolute paths to .flow-meta.xml files for flow deployment validation. */
  flowFilePaths?: string[];
  apexClassNames?: string[];
  customFields?: CustomFieldRef[];
  /** Optional: used by FlowDeploymentValidator and deploy to log JSON (e.g. deploy response). */
  logJson?: LogJsonFn;
};

/**
 * A validator: takes context, returns a result. Does not throw or mutate shared state.
 */
export type Validator = {
  validate(ctx: ValidationContext): Promise<ValidationResult>;
};
