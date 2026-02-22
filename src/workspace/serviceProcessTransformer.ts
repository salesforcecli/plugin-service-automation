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
import { TEMPLATE_DATA_FILENAME } from '../constants.js';
import type { DeploymentMetadata } from './deploymentMetadata.js';

/** Tracking for a flow's original name and deployed name (e.g. after template deploy). */
export type FlowNameTracking = {
  originalName: string;
  deployedName: string;
};

/** Stored flow names from templateData.json before nulling for upload. */
export type DeployedFlowNames = {
  intakeForm?: FlowNameTracking;
  fulfillmentFlow?: FlowNameTracking;
};

/**
 * Transforms templateData.json in a workspace: captures intakeForm and fulfillmentFlow
 * into DeployedFlowNames (deployedName = originalName for now), handles flows based on
 * deployment intent (set to null for "deploy", keep as-is for "link"), adjusts preprocessor
 * namespace to target org, and writes it back. Only modifies the workspace copy.
 */
export class ServiceProcessTransformer {
  /**
   * Reads templateData.json from the workspace, captures intakeForm and fulfillmentFlow,
   * handles them based on deployment intent, and returns the captured flow names.
   *
   * @param workspacePath Path to the workspace containing templateData.json
   * @param deploymentMetadata Deployment metadata with flow deployment intents
   * @param targetOrgNamespace Target org's namespace for preprocessor namespace adjustment
   */
  public static transform(
    workspacePath: string,
    deploymentMetadata?: DeploymentMetadata,
    targetOrgNamespace?: string | null
  ): DeployedFlowNames {
    const templatePath = path.join(workspacePath, TEMPLATE_DATA_FILENAME);
    if (!fs.existsSync(templatePath)) {
      return {};
    }

    const raw = fs.readFileSync(templatePath, 'utf-8');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }

    const getFlowName = (value: unknown): string | undefined => {
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      if (
        value &&
        typeof value === 'object' &&
        'apiName' in value &&
        typeof (value as { apiName: unknown }).apiName === 'string'
      ) {
        return (value as { apiName: string }).apiName.trim();
      }
      return undefined;
    };

    const intakeFormName = getFlowName(data.intakeForm);
    const fulfillmentFlowName = getFlowName(data.fulfillmentFlow);

    const result: DeployedFlowNames = {};
    if (intakeFormName) {
      result.intakeForm = { originalName: intakeFormName, deployedName: intakeFormName };
    }
    if (fulfillmentFlowName) {
      result.fulfillmentFlow = {
        originalName: fulfillmentFlowName,
        deployedName: fulfillmentFlowName,
      };
    }

    // Handle intakeForm based on deployment intent
    if (data.intakeForm && typeof data.intakeForm === 'object') {
      const deployIntent = deploymentMetadata?.intakeFlow?.deploymentIntent;

      if (deployIntent != 'link') {
        data.intakeForm = null;
      }
    }

    // Handle fulfillmentFlow based on deployment intent
    if (data.fulfillmentFlow && typeof data.fulfillmentFlow === 'object') {
      const deployIntent = deploymentMetadata?.fulfillmentFlow?.deploymentIntent;

      if (deployIntent != 'link') {
        data.fulfillmentFlow = null;
      }
    }

    // Handle preprocessors - update namespace only (no intent filtering)
    if (Array.isArray(data.preProcessors)) {
      data.preProcessors = data.preProcessors.map((preprocessor): unknown => {
        if (preprocessor && typeof preprocessor === 'object') {
          const ppObj = preprocessor as Record<string, unknown>;
          // Update namespace to target org's namespace
          return {
            ...ppObj,
            namespacePrefix: targetOrgNamespace ?? null,
          };
        }
        return preprocessor as unknown;
      });
    }

    fs.writeFileSync(templatePath, JSON.stringify(data, null, 2), 'utf-8');

    return result;
  }
}
