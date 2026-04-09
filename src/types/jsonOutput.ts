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

/**
 * JSON output contract for sf service-process deploy command.
 * Only returned when --json flag is passed.
 */

/** Package information (zip file) */
export type PackageInfo = {
  type: 'zip';
  path: string;
};

/** Artifact information (flow, preprocessor, etc.) */
export type ArtifactInfo = {
  type: string;
  name: string;
  id?: string;
  deployed: boolean;
  linked: boolean;
};

/** Artifacts attached to the Service Process */
export type ServiceProcessArtifacts = {
  intakeFlow?: ArtifactInfo;
  fulfillmentFlow?: ArtifactInfo;
  preprocessor?: ArtifactInfo;
};

/** Service Process information */
export type ServiceProcessInfo = {
  id: string;
  name: string;
  created: boolean;
  artifacts: ServiceProcessArtifacts;
};

/** Error information (only on failure) */
export type ErrorInfo = {
  type: string;
  message: string;
};

/** Rollback information (only on failure after partial changes) */
export type RollbackInfo = {
  attempted: boolean;
  succeeded: boolean;
  manualCleanupRequired?: boolean;
};

/** Deploy options (CLI flags) */
export type DeployOptions = {
  linkIntake: boolean;
  linkFulfillment: boolean;
};

/** Result object (success or failure) */
export type DeployResult = {
  package: PackageInfo;
  options: DeployOptions;
  serviceProcess: ServiceProcessInfo | null;
  errors?: ErrorInfo[];
  rollback?: RollbackInfo;
};

/** Top-level JSON output structure */
export type DeployJsonOutput = {
  status: number; // 0 = success, 1 = failure
  result: DeployResult;
  warnings: string[];
};
