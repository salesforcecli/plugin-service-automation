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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DeploymentContext } from '../services/deploymentContext.js';
import type { DeployError, ValidationError } from '../errors.js';
import type {
  DeployJsonOutput,
  ArtifactInfo,
  ServiceProcessArtifacts,
  ErrorInfo,
  RollbackInfo,
} from '../types/jsonOutput.js';

/**
 * Formats successful deployment result as JSON output.
 */
export function formatSuccessJsonOutput(
  context: DeploymentContext,
  inputZip: string,
  linkIntake: boolean,
  linkFulfillment: boolean
): DeployJsonOutput {
  const artifacts = buildArtifactsForSuccess(context);

  return {
    status: 0,
    result: {
      package: {
        type: 'zip',
        path: inputZip,
      },
      options: {
        linkIntake,
        linkFulfillment,
      },
      serviceProcess: {
        id: context.targetServiceProcessId ?? 'Unknown',
        name: context.templateDataExtract.name ?? 'Unknown',
        created: true,
        artifacts,
      },
    },
    warnings: [],
  };
}

/**
 * Formats failed deployment result as JSON output.
 */
export function formatFailureJsonOutput(
  inputZip: string,
  error: Error,
  linkIntake: boolean,
  linkFulfillment: boolean,
  context?: DeploymentContext,
  rollbackAttempted?: boolean,
  rollbackSucceeded?: boolean
): DeployJsonOutput {
  const errors = buildErrorsFromException(error);

  // Build base result
  const result: DeployJsonOutput['result'] = {
    package: {
      type: 'zip',
      path: inputZip,
    },
    options: {
      linkIntake,
      linkFulfillment,
    },
    serviceProcess: null,
    errors,
  };

  // If Service Process was created before failure, include its info
  if (context?.targetServiceProcessId) {
    const artifacts = buildArtifactsForFailure(context);
    result.serviceProcess = {
      id: context.targetServiceProcessId,
      name: context.templateDataExtract.name ?? 'Unknown',
      created: true,
      artifacts,
    };
  }

  // Add rollback info if rollback was attempted
  if (rollbackAttempted !== undefined) {
    const rollback: RollbackInfo = {
      attempted: rollbackAttempted,
      succeeded: rollbackSucceeded ?? false,
    };
    if (!rollbackSucceeded) {
      rollback.manualCleanupRequired = true;
    }
    result.rollback = rollback;
  }

  return {
    status: 1,
    result,
    warnings: [],
  };
}

/**
 * Build artifacts info for successful deployment.
 * Shows which flows were deployed vs linked.
 */
function buildArtifactsForSuccess(context: DeploymentContext): ServiceProcessArtifacts {
  const artifacts: ServiceProcessArtifacts = {};

  // Intake flow
  if (context.deploymentMetadata.intakeFlow) {
    const isDeployed = context.deploymentMetadata.intakeFlow.deploymentIntent === 'deploy';
    const flow = context.deployedFlows?.find((f) => f.fullName === context.deploymentMetadata.intakeFlow?.apiName);

    artifacts.intakeFlow = {
      type: 'Flow',
      name: context.deploymentMetadata.intakeFlow.apiName,
      id: flow?.id,
      deployed: isDeployed,
      linked: true, // Always linked in success case
    };
  }

  // Fulfillment flow
  if (context.deploymentMetadata.fulfillmentFlow) {
    const isDeployed = context.deploymentMetadata.fulfillmentFlow.deploymentIntent === 'deploy';
    const flow = context.deployedFlows?.find((f) => f.fullName === context.deploymentMetadata.fulfillmentFlow?.apiName);

    artifacts.fulfillmentFlow = {
      type: 'Flow',
      name: context.deploymentMetadata.fulfillmentFlow.apiName,
      id: flow?.id,
      deployed: isDeployed,
      linked: true, // Always linked in success case
    };
  }

  // Preprocessor (from templateData.json if available)
  const preprocessor = getPreprocessorFromTemplateData(context);
  if (preprocessor) {
    artifacts.preprocessor = preprocessor;
  }

  return artifacts;
}

/**
 * Build artifacts info for failed deployment.
 * Shows partial state when deployment failed mid-way.
 */
function buildArtifactsForFailure(context: DeploymentContext): ServiceProcessArtifacts {
  const artifacts: ServiceProcessArtifacts = {};

  // Intake flow - check if it was deployed and/or linked
  if (context.deploymentMetadata.intakeFlow) {
    const isDeployed = context.deploymentMetadata.intakeFlow.deploymentIntent === 'deploy';
    const flow = context.deployedFlows?.find((f) => f.fullName === context.deploymentMetadata.intakeFlow?.apiName);
    const wasDeployed = isDeployed && flow != null;

    artifacts.intakeFlow = {
      type: 'Flow',
      name: context.deploymentMetadata.intakeFlow.apiName,
      id: flow?.id,
      deployed: wasDeployed,
      linked: false, // Linking failed if we're in error state
    };
  }

  // Fulfillment flow - check if it was deployed and/or linked
  if (context.deploymentMetadata.fulfillmentFlow) {
    const isDeployed = context.deploymentMetadata.fulfillmentFlow.deploymentIntent === 'deploy';
    const flow = context.deployedFlows?.find((f) => f.fullName === context.deploymentMetadata.fulfillmentFlow?.apiName);
    const wasDeployed = isDeployed && flow != null;

    artifacts.fulfillmentFlow = {
      type: 'Flow',
      name: context.deploymentMetadata.fulfillmentFlow.apiName,
      id: flow?.id,
      deployed: wasDeployed,
      linked: false, // Linking failed if we're in error state
    };
  }

  // Preprocessor (if any)
  const preprocessor = getPreprocessorFromTemplateData(context);
  if (preprocessor) {
    artifacts.preprocessor = preprocessor;
  }

  return artifacts;
}

/**
 * Get preprocessor info from templateData.json if available.
 * Returns the first preprocessor (spec shows singular, but templateData has array).
 */
function getPreprocessorFromTemplateData(context: DeploymentContext): ArtifactInfo | undefined {
  try {
    const templateDataPath = path.join(context.workspace, 'templateData.json');
    if (!fs.existsSync(templateDataPath)) {
      return undefined;
    }

    const templateData: unknown = JSON.parse(fs.readFileSync(templateDataPath, 'utf-8'));
    if (
      templateData &&
      typeof templateData === 'object' &&
      'preProcessors' in templateData &&
      Array.isArray(templateData.preProcessors) &&
      templateData.preProcessors.length > 0
    ) {
      const firstItem: unknown = templateData.preProcessors[0];
      if (firstItem && typeof firstItem === 'object' && 'apiName' in firstItem) {
        const first = firstItem as { apiName: unknown };
        if (typeof first.apiName === 'string') {
          return {
            type: 'Preprocessor',
            name: first.apiName,
            deployed: false,
            linked: true, // Preprocessors are always linked from templateData
          };
        }
      }
    }
  } catch {
    // Ignore errors reading templateData
  }
  return undefined;
}

/**
 * Build error info array from an exception.
 * Handles ValidationError with multiple failures and standard errors.
 */
function buildErrorsFromException(error: Error): ErrorInfo[] {
  const errors: ErrorInfo[] = [];

  // Check if it's a ValidationError with failures
  if ('failures' in error && Array.isArray((error as ValidationError).failures)) {
    const validationError = error as ValidationError;
    if (validationError.failures && validationError.failures.length > 0) {
      for (const failure of validationError.failures) {
        if (failure.status === 'FAIL') {
          errors.push({
            type: 'ValidationError',
            message: failure.message ?? `Validation failed: ${failure.name}`,
          });
        }
      }
    } else {
      // ValidationError but no failures array
      errors.push({
        type: 'ValidationError',
        message: error.message || 'Deployment validation failed.',
      });
    }
  } else if ('code' in error && typeof (error as DeployError).code === 'string') {
    // DeployError with code
    const deployError = error as DeployError;
    errors.push({
      type: deployError.code,
      message: error.message,
    });
  } else {
    // Generic error
    errors.push({
      type: error.name || 'DeployError',
      message: error.message || 'Deployment failed.',
    });
  }

  return errors;
}
