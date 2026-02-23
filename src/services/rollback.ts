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
import { buildCatalogItemPath } from '../constants.js';
import { getConnect, patchConnect } from '../utils/api/connectApi.js';
import type { DeployedFlowInfo } from '../utils/flow/deployflow.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import type { Logger } from '../validation/types.js';
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
    logger?: Logger
  ): Promise<void> {
    logger?.log?.('Starting Scenario 1 rollback: Unlink artifacts, delete Service Process');

    // Step 1: Check if unlinking is needed
    const needsUnlink = await this.needsUnlinking(connection, targetServiceProcessId);

    // Step 2: Unlink artifacts if any are linked (from deployment API)
    if (needsUnlink) {
      logger?.log?.('Artifacts are linked, unlinking before deletion...');
      await this.unlinkComponents(connection, targetServiceProcessId, logger);
    } else {
      logger?.log?.('No artifacts linked, proceeding to deletion.');
    }

    // Step 3: Delete Service Process
    await this.deleteServiceProcess(connection, targetServiceProcessId, logger);

    logger?.log?.('Scenario 1 rollback completed.');
  }

  /**
   * Rollback Scenario 2: Unlink artifacts, delete Service Process, delete newly deployed flows.
   * Use when new flows are deployed but linking to Service Process fails.
   * Note: Unlinking handles artifacts from both deployment API AND PATCH API.
   */
  public static async rollbackServiceProcessAndFlows(
    connection: Connection,
    rollbackData: RollbackData,
    logger?: Logger
  ): Promise<void> {
    logger?.log?.('Starting Scenario 2 rollback: Unlink artifacts, delete flows, delete Service Process');

    const { targetServiceProcessId, deployedFlows } = rollbackData;

    // Step 1: Check if unlinking is needed
    const needsUnlink = await this.needsUnlinking(connection, targetServiceProcessId);

    // Step 2: Unlink artifacts if any are linked (from deployment API or PATCH API)
    if (needsUnlink) {
      logger?.log?.('Artifacts are linked, unlinking before deletion...');
      await this.unlinkComponents(connection, targetServiceProcessId, logger);
    } else {
      logger?.log?.('No artifacts linked, proceeding to deletion.');
    }

    // Step 3: Delete newly deployed flows
    if (deployedFlows && deployedFlows.length > 0) {
      await this.deleteDeployedFlows(connection, deployedFlows, logger);
    } else {
      logger?.log?.('No flows to delete.');
    }

    // Step 4: Delete Service Process
    await this.deleteServiceProcess(connection, targetServiceProcessId, logger);

    logger?.log?.('Scenario 2 rollback completed.');
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
    const catalogItem = await getConnect<CatalogItemGetResponse>(connection, catalogItemPath);

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
      logger?.log?.(`Unlinking intake form (ID: ${catalogItem.intakeForm.id})`);
    }

    if (catalogItem?.fulfillmentFlow?.id) {
      unlinkBody.fulfillmentFlow = {
        operationType: 'Delete',
        id: catalogItem.fulfillmentFlow.id,
      };
      logger?.log?.(`Unlinking fulfillment flow (ID: ${catalogItem.fulfillmentFlow.id})`);
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
      logger?.log?.(`Unlinking ${catalogItem.preProcessors.length} preprocessor(s)`);
    }

    if (catalogItem?.contextDefinitionDevNameOrId) {
      unlinkBody.contextDefinitionDevNameOrId = catalogItem.contextDefinitionDevNameOrId;
    }

    logger?.log?.(`Patching catalog item to unlink components: ${catalogItemPath}`);
    logger?.log?.('Unlink request body:');
    logger?.logJson?.(unlinkBody);

    try {
      const patchResponse = await patchConnect(connection, catalogItemPath, unlinkBody);
      logger?.log?.('Unlink response:');
      logger?.logJson?.(patchResponse);
      logger?.log?.('All components unlinked successfully.');
    } catch (error) {
      logger?.log?.(`Unlink PATCH failed with error: ${error instanceof Error ? error.message : String(error)}`);
      if (error && typeof error === 'object' && 'response' in error) {
        logger?.log?.('Error response body:');
        logger?.logJson?.(error.response);
      }
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
    logger?.log?.(`Deleting Service Process via Product2 sobject: ${targetServiceProcessId}`);

    try {
      const deleteResult = await connection.sobject('Product2').destroy(targetServiceProcessId);

      logger?.log?.('Delete result:');
      logger?.logJson?.(deleteResult);

      if (!deleteResult.success) {
        const errors = Array.isArray(deleteResult.errors)
          ? deleteResult.errors.join(', ')
          : JSON.stringify(deleteResult.errors);
        logger?.log?.(`Delete failed: ${errors}`);
        throw new Error(`Failed to delete Service Process: ${errors}`);
      }

      logger?.log?.('Service Process deleted successfully.');
    } catch (error) {
      logger?.log?.(`Delete operation failed with error: ${error instanceof Error ? error.message : String(error)}`);
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
      logger?.log?.('No flow IDs to delete (flows may not have been deployed).');
      return;
    }

    logger?.log?.(`Deleting ${flowsToDelete.length} deployed flow(s) via Tooling API...`);

    let successCount = 0;
    let failureCount = 0;

    // Delete flows one by one (sequential for better error logging)
    // eslint-disable-next-line no-await-in-loop
    for (const flow of flowsToDelete) {
      logger?.log?.(`Deleting flow: ${flow.fullName} (InteractionDefinitionVersion ID: ${flow.id})`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const deleteResult = await connection.tooling.destroy('Flow', flow.id);
        logger?.log?.(`Delete result for ${flow.id}:`);
        logger?.logJson?.(deleteResult);

        if (deleteResult.success) {
          logger?.log?.(`  ✓ Successfully deleted ${flow.fullName}`);
          successCount++;
        } else {
          const errors = Array.isArray(deleteResult.errors)
            ? deleteResult.errors.join(', ')
            : JSON.stringify(deleteResult.errors);
          logger?.log?.(`  ✗ Failed to delete ${flow.fullName}: ${errors}`);
          failureCount++;
        }
      } catch (error) {
        logger?.log?.(`  ✗ Error deleting ${flow.fullName}: ${error instanceof Error ? error.message : String(error)}`);
        failureCount++;
      }
    }

    logger?.log?.(`Flow deletion summary: ${successCount} succeeded, ${failureCount} failed`);
  }
}
