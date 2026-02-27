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

import type { Validator } from '../types.js';
import { minApiVersionValidator } from './MinApiVersionValidator.js';
import { customFieldsValidator } from './CustomFieldsValidator.js';
import { flowDeploymentValidator } from './FlowDeploymentValidator.js';
import { apexClassPresenceValidator } from './ApexClassPresenceValidator.js';
import { orgApiVersionValidator } from './OrgApiVersionValidator.js';
import { intakeFlowUniquenessValidator } from './IntakeFlowUniquenessValidator.js';
import { fulfillmentFlowUniquenessValidator } from './FulfillmentFlowUniquenessValidator.js';
import { intakeFlowExistenceValidator } from './IntakeFlowExistenceValidator.js';
import { fulfillmentFlowExistenceValidator } from './FulfillmentFlowExistenceValidator.js';

export { minApiVersionValidator } from './MinApiVersionValidator.js';
export { customFieldsValidator } from './CustomFieldsValidator.js';
export { flowDeploymentValidator } from './FlowDeploymentValidator.js';
export { apexClassPresenceValidator } from './ApexClassPresenceValidator.js';
export { orgApiVersionValidator } from './OrgApiVersionValidator.js';
export { intakeFlowUniquenessValidator } from './IntakeFlowUniquenessValidator.js';
export { fulfillmentFlowUniquenessValidator } from './FulfillmentFlowUniquenessValidator.js';
export { intakeFlowExistenceValidator } from './IntakeFlowExistenceValidator.js';
export { fulfillmentFlowExistenceValidator } from './FulfillmentFlowExistenceValidator.js';

/**
 * Built-in validators: org API version, custom fields, flow deployment (checkOnly), Apex class presence,
 * intake flow uniqueness (deploy mode), intake flow existence (link mode),
 * fulfillment flow uniqueness (deploy mode), fulfillment flow existence (link mode).
 */
export const builtInValidators: Validator[] = [
  minApiVersionValidator,
  orgApiVersionValidator,
  customFieldsValidator,
  flowDeploymentValidator,
  apexClassPresenceValidator,
  intakeFlowUniquenessValidator,
  intakeFlowExistenceValidator,
  fulfillmentFlowUniquenessValidator,
  fulfillmentFlowExistenceValidator,
];

/**
 * Validator with metadata for progress tracking and display.
 */
export type ValidatorWithMetadata = {
  validator: Validator;
  name: string;
  description: string;
};

/**
 * Built-in validators with metadata for progress display.
 * These are used when running validations with progress callbacks.
 */
export const builtInValidatorsWithMetadata: ValidatorWithMetadata[] = [
  {
    validator: minApiVersionValidator,
    name: 'MinApiVersion',
    description: 'Minimum API version check',
  },
  {
    validator: orgApiVersionValidator,
    name: 'OrgApiVersion',
    description: 'Org API compatibility check',
  },
  {
    validator: customFieldsValidator,
    name: 'CustomFields',
    description: 'Custom field validation',
  },
  {
    validator: flowDeploymentValidator,
    name: 'FlowDeployment',
    description: 'Flow deployment check',
  },
  {
    validator: apexClassPresenceValidator,
    name: 'ApexClass',
    description: 'Apex class verification',
  },
  {
    validator: intakeFlowUniquenessValidator,
    name: 'IntakeFlowUniqueness',
    description: 'Intake flow uniqueness check',
  },
  {
    validator: intakeFlowExistenceValidator,
    name: 'IntakeFlowExistence',
    description: 'Intake flow existence check',
  },
  {
    validator: fulfillmentFlowUniquenessValidator,
    name: 'FulfillmentFlowUniqueness',
    description: 'Fulfillment flow uniqueness check',
  },
  {
    validator: fulfillmentFlowExistenceValidator,
    name: 'FulfillmentFlowExistence',
    description: 'Fulfillment flow existence check',
  },
];
