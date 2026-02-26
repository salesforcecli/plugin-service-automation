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

import { SfError } from '@salesforce/core';
import type { ValidationResult } from './validation/types.js';

/** Base for deploy/validation domain errors; command can map to SfError with exit codes. */
export class DeployError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string = 'DeployError') {
    super(message);
    this.name = 'DeployError';
    this.code = code;
  }
}

/** Thrown when validation fails (e.g. runValidationsOrThrow). */
export class ValidationError extends DeployError {
  public readonly failures?: ValidationResult[];

  public constructor(message: string, failures?: ValidationResult[]) {
    super(message, 'ValidationFailed');
    this.name = 'ValidationError';
    this.failures = failures;
  }
}

/** Thrown when workspace/flow/template data is invalid or missing. */
export class TemplateDataError extends DeployError {
  public constructor(message: string) {
    super(message, 'InvalidTemplateData');
    this.name = 'TemplateDataError';
  }
}

/** Thrown when service-process.metadata.json is missing from the deploy input zip. */
export class MissingMetadataFileError extends DeployError {
  public constructor(message: string) {
    super(message, 'MissingMetadataFile');
    this.name = 'MissingMetadataFileError';
  }
}

export class ServiceProcessRetrieveError extends SfError {
  public constructor(message: string, name: string = 'ServiceProcessRetrieveError') {
    super(message, name);
  }
}

export class ServiceProcessRetrieveValidationError extends ServiceProcessRetrieveError {
  public constructor(message: string) {
    super(message, 'ValidationError');
  }
}

export class ServiceProcessDataRetrievalFailure extends ServiceProcessRetrieveError {
  public constructor(message: string) {
    super(message, 'ServiceProcessDataRetrievalFailure');
  }
}
