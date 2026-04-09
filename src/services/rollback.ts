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
import { formatErrorResponseForLog } from '../utils/safeStringify.js';
import type { DeployedFlowInfo } from '../utils/flow/deployflow.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import type { CatalogItemGetResponse } from './catalogItemPatch.js';

/**
 * Rollback scenarios for deployment failures.
 */
export enum RollbackScenario {
  /** Scenario 1: Only Service Process exists, no flows deployed. */
  ServiceProcessOnly = 'ServiceProcessOnly',
  /** Scenario 2: Service Process + flows deployed, but not linked. */
  ServiceProcessAndFlows = 'ServiceProcessAndFlows',
}

/**
 * Data required for rollback operations.
 */
export type RollbackData = {
  targetServiceProcessId: string;
  deployedFlows?: DeployedFlowInfo[];
  deployedFlowNames?: DeployedFlowNames;
};

/**
 * Service for rolling back failed deployments.
 * Handles cleanup of Service Process and deployed flows when deployment fails.
 */
export class RollbackService {
  /**
   * Rollback Scenario 1: Unlink artifacts (if any), delete Service Process.
   * Use when flow deployment fails before any new flows are deployed.
   * Note: Unlinking is required because deployment API may have linked artifacts from templateData.json.
   */
  public static async rollbackServiceProcessOnly(
    connection: Connection,
    targetServiceProcessId: string,
    logger?: Logger,
    onProgress?: (step: string, status: 'start' | 'complete') => void
  ): Promise<void> {
    logger?.info('Starting Scenario 1 rollback: Unlink artifacts, delete Service Process');

    // Step 1: Check if unlinking is needed
    const needsUnlink = await this.needsUnlinking(connection, targetServiceProcessId);

    // Step 2: Unlink artifacts if any are linked (from deployment API)
    if (needsUnlink) {
      logger?.info('Artifacts are linked, unlinking before deletion...');
      onProgress?.('Unlinking components', 'start');
      await this.unlinkComponents(connection, targetServiceProcessId, logger);
      onProgress?.('Unlinking components', 'complete');
    } else {
      logger?.info('No artifacts linked, proceeding to deletion.');
    }

    // Step 3: Delete Service Process
    onProgress?.('Removing Service Process', 'start');
    await this.deleteServiceProcess(connection, targetServiceProcessId, logger);
    onProgress?.('Removing Service Process', 'complete');

    logger?.info('Scenario 1 rollback completed.');
  }

  /**
   * Rollback Scenario 2: Unlink artifacts, delete Service Process, delete newly deployed flows.
   * Use when new flows are deployed but linking to Service Process fails.
   * Note: Unlinking handles artifacts from both deployment API AND PATCH API.
   */
  public static async rollbackServiceProcessAndFlows(
    connection: Connection,
    rollbackData: RollbackData,
    logger?: Logger,
    onProgress?: (step: string, status: 'start' | 'complete') => void
  ): Promise<void> {
    logger?.info('Starting Scenario 2 rollback: Unlink artifacts, delete flows, delete Service Process');

    const { targetServiceProcessId, deployedFlows } = rollbackData;

    // Step 1: Check if unlinking is needed
    const needsUnlink = await this.needsUnlinking(connection, targetServiceProcessId);

    // Step 2: Unlink artifacts if any are linked (from deployment API or PATCH API)
    if (needsUnlink) {
      logger?.info('Artifacts are linked, unlinking before deletion...');
      onProgress?.('Unlinking components', 'start');
      await this.unlinkComponents(connection, targetServiceProcessId, logger);
      onProgress?.('Unlinking components', 'complete');
    } else {
      logger?.info('No artifacts linked, proceeding to deletion.');
    }

    // Step 3: Delete newly deployed flows
    if (deployedFlows && deployedFlows.length > 0) {
      onProgress?.('Deleting deployed flows', 'start');
      await this.deleteDeployedFlows(connection, deployedFlows, logger);
      onProgress?.('Deleting deployed flows', 'complete');
    } else {
      logger?.info('No flows to delete.');
    }

    // Step 4: Delete Service Process
    onProgress?.('Removing Service Process', 'start');
    await this.deleteServiceProcess(connection, targetServiceProcessId, logger);
    onProgress?.('Removing Service Process', 'complete');

    logger?.info('Scenario 2 rollback completed.');
  }

  /**
   * Check if any components are linked to the Service Process.
   * Returns true if unlinking is needed, false otherwise.
   */
  private static async needsUnlinking(connection: Connection, targetServiceProcessId: string): Promise<boolean> {
    try {
      const catalogItemPath = buildCatalogItemPath(targetServiceProcessId);
      const catalogItem = await getConnect<CatalogItemGetResponse>(connection, catalogItemPath);

      // Check if any components are linked (from deployment API or PATCH API)
      return !!(
        catalogItem?.intakeForm?.id ??
        catalogItem?.fulfillmentFlow?.id ??
        (catalogItem?.preProcessors && Array.isArray(catalogItem.preProcessors) && catalogItem.preProcessors.length > 0)
      );
    } catch (error) {
      // If we can't query the catalog item, assume no unlinking needed
      return false;
    }
  }

  /**
   * Unlink flows/preprocessors from Service Process via PATCH API with operationType: "Delete".
   */
  private static async unlinkComponents(
    connection: Connection,
    targetServiceProcessId: string,
    logger?: Logger
  ): Promise<void> {
    const catalogItemPath = buildCatalogItemPath(targetServiceProcessId);
    logger?.debug(`Unlink: fetching catalog item (path=${catalogItemPath})`);
    const getStart = Date.now();
    let catalogItem: CatalogItemGetResponse | undefined;
    try {
      catalogItem = await getConnect<CatalogItemGetResponse>(connection, catalogItemPath);
      logger?.debug(`Unlink catalog item GET completed in ${Date.now() - getStart}ms`);
      logger?.debug(`Unlink catalog item GET full response: ${JSON.stringify(catalogItem)}`);
    } catch (error) {
      logger?.error(`Unlink: catalog item GET failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Unlink: catalog item GET error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Unlink catalog item GET failed in ${Date.now() - getStart}ms`);
      throw error;
    }

    const unlinkBody: Record<string, unknown> = {
      agentAction: {},
      associatedArticles: [],
      sections: [],
      eligibilityRules: [],
      integrations: [],
      isActive: false,
      name: '',
      productRequests: [],
      targetObject: 'Case',
      usedFor: 'ServiceProcess',
    };

    // Add Delete operations for linked components (from deployment API or PATCH API)
    // Note: API does not accept "type" field in Delete operations
    // Note: intakeForm uses "Update" operation to unlink, not "Delete"
    if (catalogItem?.intakeForm?.id) {
      unlinkBody.intakeForm = {
        operationType: 'Update',
        id: catalogItem.intakeForm.id,
      };
      logger?.debug(`Unlinking intake form (ID: ${catalogItem.intakeForm.id})`);
    }

    if (catalogItem?.fulfillmentFlow?.id) {
      unlinkBody.fulfillmentFlow = {
        operationType: 'Delete',
        id: catalogItem.fulfillmentFlow.id,
      };
      logger?.debug(`Unlinking fulfillment flow (ID: ${catalogItem.fulfillmentFlow.id})`);
    }

    if (
      catalogItem?.preProcessors &&
      Array.isArray(catalogItem.preProcessors) &&
      catalogItem.preProcessors.length > 0
    ) {
      unlinkBody.preProcessors = catalogItem.preProcessors.map((pp) => ({
        operationType: 'Delete',
        id: pp.id,
      }));
      logger?.debug(`Unlinking ${catalogItem.preProcessors.length} preprocessor(s)`);
    }

    if (catalogItem?.contextDefinitionDevNameOrId) {
      unlinkBody.contextDefinitionDevNameOrId = catalogItem.contextDefinitionDevNameOrId;
    }

    logger?.debug(`Unlink: PATCH start (path=${catalogItemPath})`);
    const patchStart = Date.now();
    try {
      const patchResponse = await patchConnect(connection, catalogItemPath, unlinkBody);
      logger?.debug(`Unlink PATCH completed in ${Date.now() - patchStart}ms`);
      logger?.debug(`Unlink PATCH full response: ${JSON.stringify(patchResponse)}`);
      logger?.info('All components unlinked successfully.');
    } catch (error) {
      logger?.error(`Unlink PATCH failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error && typeof error === 'object' && 'response' in error) {
        logger?.debug(
          `Unlink: PATCH error full response: ${formatErrorResponseForLog((error as { response: unknown }).response)}`
        );
      }
      logger?.debug(`Unlink PATCH failed in ${Date.now() - patchStart}ms`);
      throw error;
    }
  }

  /**
   * Delete Service Process using Tooling API.
   * Note: Connect API DELETE is not supported (returns 405), so we use Tooling API instead.
   */
  private static async deleteServiceProcess(
    connection: Connection,
    targetServiceProcessId: string,
    logger?: Logger
  ): Promise<void> {
    logger?.info(`Deleting Service Process via Product2 sobject: ${targetServiceProcessId}`);
    logger?.debug(`Delete Service Process start (id=${targetServiceProcessId})`);
    const deleteStart = Date.now();

    try {
      const deleteResult = await connection.sobject('Product2').destroy(targetServiceProcessId);
      logger?.debug(`Delete Service Process completed in ${Date.now() - deleteStart}ms`);
      logger?.debug(`Delete Service Process full response: ${JSON.stringify(deleteResult)}`);

      if (!deleteResult.success) {
        const errors = Array.isArray(deleteResult.errors)
          ? deleteResult.errors.join(', ')
          : JSON.stringify(deleteResult.errors);
        logger?.error(`Delete failed: ${errors}`);
        throw new Error(`Failed to delete Service Process: ${errors}`);
      }

      logger?.info('Service Process deleted successfully.');
    } catch (error) {
      logger?.error(`Delete operation failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Delete Service Process error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Delete Service Process failed in ${Date.now() - deleteStart}ms`);
      throw error;
    }
  }

  /**
   * Delete deployed flows using Tooling API.
   * Deletes InteractionDefinitionVersion records by their IDs (not definition IDs).
   */
  private static async deleteDeployedFlows(
    connection: Connection,
    deployedFlows: DeployedFlowInfo[],
    logger?: Logger
  ): Promise<void> {
    // Use the InteractionDefinitionVersion IDs (f.id), not the definition IDs
    const flowsToDelete = deployedFlows.filter((f) => f.id != null);

    if (flowsToDelete.length === 0) {
      logger?.info('No flow IDs to delete (flows may not have been deployed).');
      return;
    }

    logger?.info(`Deleting ${flowsToDelete.length} deployed flow(s) via Tooling API...`);
    logger?.debug(`Delete flows start: ${flowsToDelete.length} flow(s)`);
    const deleteFlowsStart = Date.now();

    let successCount = 0;
    let failureCount = 0;

    // Delete flows one by one (sequential for better error logging)
    // eslint-disable-next-line no-await-in-loop
    for (const flow of flowsToDelete) {
      logger?.debug(`Deleting flow: ${flow.fullName} (InteractionDefinitionVersion ID: ${flow.id})`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const deleteResult = await connection.tooling.destroy('Flow', flow.id);
        logger?.debug(`Delete result for ${flow.id} full response: ${JSON.stringify(deleteResult)}`);

        if (deleteResult.success) {
          logger?.debug(`Successfully deleted ${flow.fullName}`);
          successCount++;
        } else {
          const errors = Array.isArray(deleteResult.errors)
            ? deleteResult.errors.join(', ')
            : JSON.stringify(deleteResult.errors);
          logger?.warn(`Failed to delete ${flow.fullName}: ${errors}`);
          failureCount++;
        }
      } catch (error) {
        logger?.error(`Error deleting ${flow.fullName}: ${error instanceof Error ? error.message : String(error)}`);
        const err = error as Error & { response?: unknown };
        if (logger && err.response !== undefined) {
          logger.debug(`Delete flow ${flow.fullName} error full response: ${formatErrorResponseForLog(err.response)}`);
        }
        failureCount++;
      }
    }

    const deleteFlowsDuration = Date.now() - deleteFlowsStart;
    logger?.info(
      `Flow deletion completed in ${deleteFlowsDuration}ms (${successCount} succeeded, ${failureCount} failed)`
    );
    if (failureCount > 0) {
      throw new Error(`Failed to delete ${failureCount} flow(s) during rollback (${successCount} succeeded).`);
    }
  }
}
