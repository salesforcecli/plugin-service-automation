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
import { publishLifecycleMetric } from '../utils/lifecycleMetrics.js';
import { formatErrorResponseForLog } from '../utils/safeStringify.js';
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
    contextDefinitionDevNameOrId: string | undefined,
    serviceProcessName?: string
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
      name: serviceProcessName ?? '',
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
  // eslint-disable-next-line complexity
  public static async patchCatalogItemWithFlowIds(
    conn: Connection,
    targetServiceProcessId: string,
    deployedFlows: DeployedFlowInfo[],
    deployedFlowNames: DeployedFlowNames | undefined,
    serviceProcessName: string | undefined,
    logger?: Logger,
    runId?: string
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

    logger?.debug(`Fetching catalog item (path=${catalogItemPath})`);
    const getStart = Date.now();
    let catalogItem: CatalogItemGetResponse;
    try {
      catalogItem = await getConnect<CatalogItemGetResponse>(conn, catalogItemPath);
      logger?.debug(`Catalog item GET completed in ${Date.now() - getStart}ms`);
      logger?.debug(`Catalog item GET full response: ${JSON.stringify(catalogItem)}`);
    } catch (error) {
      logger?.error(`Catalog item GET failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Catalog item GET error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Catalog item GET failed in ${Date.now() - getStart}ms`);
      throw error;
    }

    const existingIntakeFormId = catalogItem?.intakeForm?.id;
    const contextDefinitionDevNameOrId = catalogItem?.contextDefinitionDevNameOrId;
    logger?.debug(`Fetched catalog item intakeForm.id: ${existingIntakeFormId ?? 'none'}`);
    logger?.debug(`Fetched catalog item contextDefinitionDevNameOrId: ${contextDefinitionDevNameOrId ?? 'none'}`);

    const catalogItemBody = CatalogItemPatcher.buildCatalogItemPatchBody(
      intakeFormDefinitionId,
      fulfillmentFlowDefinitionId,
      existingIntakeFormId,
      contextDefinitionDevNameOrId,
      serviceProcessName
    );

    logger?.info(`Patching catalog item: ${catalogItemPath}`);
    logger?.debug(
      `Catalog item PATCH start (path=${catalogItemPath}, intakeFormDefId=${
        intakeFormDefinitionId ?? 'none'
      }, fulfillmentDefId=${fulfillmentFlowDefinitionId ?? 'none'})`
    );
    const patchStart = Date.now();
    try {
      const patchResponse = await patchConnect(conn, catalogItemPath, catalogItemBody);
      await publishLifecycleMetric(logger, 'spTargetOrgFlowLinking', {
        runId,
        spId: targetServiceProcessId,
        intakeFlowId: intakeFormDefinitionId ?? null,
        fulfillmentFlowId: fulfillmentFlowDefinitionId ?? null,
        stepExecutionDurationMs: Date.now() - patchStart,
        status: 'SUCCESS',
      });
      logger?.debug(`Catalog item PATCH completed in ${Date.now() - patchStart}ms`);
      logger?.debug(`Catalog item PATCH full response: ${JSON.stringify(patchResponse)}`);
      logger?.info('Catalog item patched successfully.');
      logger?.info(
        `Linked Service Process ${targetServiceProcessId} to intake ${intakeFormDefinitionId ?? 'none'}, fulfillment ${
          fulfillmentFlowDefinitionId ?? 'none'
        }`
      );
    } catch (error) {
      await publishLifecycleMetric(logger, 'spTargetOrgFlowLinking', {
        runId,
        spId: targetServiceProcessId,
        intakeFlowId: intakeFormDefinitionId ?? null,
        fulfillmentFlowId: fulfillmentFlowDefinitionId ?? null,
        stepExecutionDurationMs: Date.now() - patchStart,
        status: 'FAILURE',
        errorTrigger: error instanceof Error ? error.message : String(error),
      });
      logger?.error(`Catalog item PATCH failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Catalog item PATCH error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Catalog item PATCH failed in ${Date.now() - patchStart}ms`);
      throw error;
    }
  }
}
