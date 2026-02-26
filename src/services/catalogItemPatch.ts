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

import type { Connection } from '@salesforce/core';
import type { Logger } from '@salesforce/core';
import { buildCatalogItemPath } from '../constants.js';
import { getConnect, patchConnect } from '../utils/api/connectApi.js';
import type { DeployedFlowInfo } from '../utils/flow/deployflow.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';

export type CatalogItemGetResponse = {
  intakeForm?: { id?: string };
  fulfillmentFlow?: { id?: string };
  preProcessors?: Array<{ id?: string }>;
  contextDefinitionDevNameOrId?: string;
};

export class CatalogItemPatcher {
  /** Build catalog item PATCH body with intakeFormId and fulfillmentFlowId from deployed flow definition ids. */
  public static buildCatalogItemPatchBody(
    intakeFormDefinitionId: string | undefined,
    fulfillmentFlowDefinitionId: string | undefined,
    existingIntakeFormId: string | undefined,
    contextDefinitionDevNameOrId: string | undefined
  ): Record<string, unknown> {
    const intakeForm =
      intakeFormDefinitionId != null
        ? existingIntakeFormId != null
          ? {
              operationType: 'Update' as const,
              id: existingIntakeFormId,
              intakeFormId: intakeFormDefinitionId,
              type: 'Flow' as const,
            }
          : { operationType: 'Create' as const, intakeFormId: intakeFormDefinitionId, type: 'Flow' as const }
        : {};
    const body: Record<string, unknown> = {
      agentAction: {},
      associatedArticles: [],
      sections: [],
      eligibilityRules: [],
      fulfillmentFlow:
        fulfillmentFlowDefinitionId != null
          ? { fulfillmentFlowId: fulfillmentFlowDefinitionId, type: 'Flow', operationType: 'Create' }
          : {},
      intakeForm,
      integrations: [],
      isActive: false,
      name: '',
      preProcessors: [],
      productRequests: [],
      targetObject: 'Case',
      usedFor: 'ServiceProcess',
    };
    if (contextDefinitionDevNameOrId != null) {
      body.contextDefinitionDevNameOrId = contextDefinitionDevNameOrId;
    }
    return body;
  }

  /**
   * Patch the service-automation catalog item with deployed flow definition ids for intake and fulfillment.
   */
  public static async patchCatalogItemWithFlowIds(
    conn: Connection,
    targetServiceProcessId: string,
    deployedFlows: DeployedFlowInfo[],
    deployedFlowNames: DeployedFlowNames | undefined,
    logger?: Logger
  ): Promise<void> {
    const fullNameToDefId = new Map(
      deployedFlows
        .filter((f): f is typeof f & { definitionId: string } => f.definitionId != null)
        .map((f) => [f.fullName, f.definitionId] as const)
    );

    const intakeFormDefinitionId = deployedFlowNames?.intakeForm
      ? fullNameToDefId.get(deployedFlowNames.intakeForm.originalName)
      : undefined;
    const fulfillmentFlowDefinitionId = deployedFlowNames?.fulfillmentFlow
      ? fullNameToDefId.get(deployedFlowNames.fulfillmentFlow.originalName)
      : undefined;

    const catalogItemPath = buildCatalogItemPath(targetServiceProcessId);

    const catalogItem = await getConnect<CatalogItemGetResponse>(conn, catalogItemPath);
    const existingIntakeFormId = catalogItem?.intakeForm?.id;
    const contextDefinitionDevNameOrId = catalogItem?.contextDefinitionDevNameOrId;
    if (existingIntakeFormId) {
      logger?.debug('Fetched catalog item intakeForm.id: %s', existingIntakeFormId);
    }
    if (contextDefinitionDevNameOrId) {
      logger?.debug('Fetched catalog item contextDefinitionDevNameOrId: %s', contextDefinitionDevNameOrId);
    }

    const catalogItemBody = CatalogItemPatcher.buildCatalogItemPatchBody(
      intakeFormDefinitionId,
      fulfillmentFlowDefinitionId,
      existingIntakeFormId,
      contextDefinitionDevNameOrId
    );

    logger?.info('Patching catalog item: %s', catalogItemPath);
    logger?.debug('Request body %o', catalogItemBody);
    const patchResponse = await patchConnect(conn, catalogItemPath, catalogItemBody);
    logger?.debug('Patch response %o', patchResponse);
    logger?.info('Catalog item patched successfully.');
  }
}
