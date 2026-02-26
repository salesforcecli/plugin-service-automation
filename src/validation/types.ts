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
import type { Logger as SfCoreLogger } from '@salesforce/core';

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

/** Reference to a flow with deployment metadata. */
export type FlowReference = {
  apiName: string;
  namespace: string | null;
  deploymentIntent: 'link' | 'deploy';
  flowType: 'regular' | 'orchestrator';
};

/** Optional logger for JSON output (e.g. deploy response). Passed from command through service to validators/utils. */
export type LogJsonFn = (data: unknown) => void;

/** Optional logger: text and/or JSON. Pass from command through service; no console in library code. */
export type Logger = {
  log?: (msg: string) => void;
  logJson?: LogJsonFn;
};

/**
 * Context passed into the validation layer. Validators read only; never mutate.
 */
export type ValidationContext = {
  conn: Connection;
  /** Required for FlowDeploymentValidator: runs checkOnly deploy to verify flow deployment would succeed. */
  org?: Org;
  /** Optional: when set, used as reference version (e.g. from --api-version flag); otherwise org's API version is used. */
  expectedApiVersion?: string;
  /** Optional: API version from org-metadata.json in the zip; validated against expectedApiVersion or org version. */
  metadataApiVersion?: string;
  /** Absolute paths to .flow-meta.xml files for flow deployment validation. */
  flowFilePaths?: string[];
  apexClassNames?: string[];
  customFields?: CustomFieldRef[];
  /** Optional: used by FlowDeploymentValidator to log check-only deploy response at debug level. */
  logger?: SfCoreLogger;
  /** Optional: intake flow reference with deployment intent; validated based on link/deploy mode. */
  intakeFlow?: FlowReference;
  /** Optional: fulfillment flow reference with deployment intent; validated based on link/deploy mode. */
  fulfillmentFlow?: FlowReference;
  /** Optional: target org namespace for deployment uniqueness checks. */
  targetOrgNamespace?: string | null;
  /** Optional: callback when a validator starts executing. */
  onValidatorStart?: (validatorName: string, description: string) => void;
  /** Optional: callback when a validator completes (success or failure). */
  onValidatorComplete?: (validatorName: string, success: boolean) => void;
};

/**
 * A validator: takes context, returns a result. Does not throw or mutate shared state.
 */
export type Validator = {
  validate(ctx: ValidationContext): Promise<ValidationResult>;
};
