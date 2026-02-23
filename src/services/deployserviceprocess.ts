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
import type { Connection, Org } from '@salesforce/core';
import { METADATA_FLOWS_RELATIVE_PATH } from '../constants.js';
import { DeployError, TemplateDataError } from '../errors.js';
import { type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { getFlowDefinitionIds, getOrgNamespace } from '../utils/flow/flowMetadata.js';
import { DeployWorkspace } from '../workspace/deployWorkspace.js';
import { FlowTransformer } from '../workspace/flowTransformer.js';
import { FlowPathResolver } from '../workspace/flowPath.js';
import { TemplateDataReader } from '../workspace/templateData.js';
import { readDeploymentMetadata, type DeploymentMetadata } from '../workspace/deploymentMetadata.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import { ValidationRunner, builtInValidators } from '../validation/index.js';
import type { LogJsonFn, Logger, ValidationContext } from '../validation/types.js';
import { defaults, type DeployServiceProcessDependencies } from './deployDependencies.js';
import { CatalogItemPatcher } from './catalogItemPatch.js';
import { RollbackService, RollbackScenario, type RollbackData } from './rollback.js';

export type { DeployedFlowNames, FlowNameTracking } from '../workspace/serviceProcessTransformer.js';
export type { DeployServiceProcessDependencies } from './deployDependencies.js';

export type DeployServiceProcessResult = {
  contentDocumentId?: string;
  deployedFlowNames?: DeployedFlowNames;
  /** Deployed flow ids and names (only when deployment was not checkOnly). */
  deployedFlows?: DeployedFlowInfo[];
};

export type DeployServiceOptions = {
  org: Org;
  /** Optional: expected API version (e.g. from --api-version flag); validated against org if set. */
  expectedApiVersion?: string;
  logger?: Logger;
  logJson?: LogJsonFn;
  dependencies?: DeployServiceProcessDependencies;
};

/**
 * Service to deploy a Service Process (Flow) to a target org.
 * Expects a .zip file: extracts it, validates, uploads template zip, calls template deploy API, transforms intake flow, deploys flows.
 */
export class DeployService {
  private readonly org: Org;
  private readonly expectedApiVersion?: string;
  private readonly logger?: Logger;
  private readonly logJson?: LogJsonFn;
  private readonly deps: Required<DeployServiceProcessDependencies>;

  public constructor(options: DeployServiceOptions) {
    this.org = options.org;
    this.expectedApiVersion = options.expectedApiVersion;
    this.logger = options.logger;
    this.logJson = options.logJson ?? options.logger?.logJson;
    this.deps = { ...defaults, ...options.dependencies } as Required<DeployServiceProcessDependencies>;
  }

  // eslint-disable-next-line complexity
  public async deploy(inputZip: string): Promise<DeployServiceProcessResult> {
    const { org, logger, logJson, deps } = this;

    logger?.log?.(`inputZip (resolved): ${path.resolve(inputZip)}`);

    const { workspace, cleanup } = await DeployWorkspace.extractZipToWorkspace(inputZip);
    let workspaceZipCleanup: (() => void) | undefined;

    // Rollback state tracking
    let targetServiceProcessId: string | undefined;
    let deployedFlows: DeployedFlowInfo[] | undefined;
    let deployedFlowNames: DeployedFlowNames | undefined;
    let needsRollback = false;
    let rollbackScenario: RollbackScenario | undefined;

    try {
      const { filePaths, templateDataExtract } = TemplateDataReader.deriveFlowsAndTemplateData(workspace);
      const metadataApiVersion = TemplateDataReader.readOrgMetadataVersionFromDir(workspace);

      // Read deployment metadata (required for flow validation)
      const deploymentMetadata = await readDeploymentMetadata(workspace);
      if (!deploymentMetadata) {
        throw new TemplateDataError(
          'deployment-metadata.json not found. Ensure package was retrieved with metadata support.'
        );
      }

      // Check if any flows need deployment (vs linking to existing flows)
      const needsIntakeDeployment = deploymentMetadata.intakeFlow?.deploymentIntent === 'deploy';
      const needsFulfillmentDeployment = deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'deploy';
      const needsDeployment = needsIntakeDeployment || needsFulfillmentDeployment;

      // Only validate flow files exist if we actually need to deploy flows
      if (needsDeployment && filePaths.length === 0) {
        const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
        const dirContents = fs.existsSync(flowDir) ? fs.readdirSync(flowDir) : [];
        throw new TemplateDataError(
          'No flow files found in the zip, but deployment metadata indicates flows need to be deployed. ' +
            `Expected structure: <service-process-id>/templateData.json and <service-process-id>/${METADATA_FLOWS_RELATIVE_PATH}/*.flow-meta.xml (or .xml). ` +
            `Resolved workspace: ${workspace}. Flow directory contents: ${
              dirContents.length > 0 ? dirContents.join(', ') : '(missing or empty)'
            }`
        );
      }

      // Get target org namespace (for deployment uniqueness checks)
      const targetOrgNamespace = await getOrgNamespace(org.getConnection());

      // Phase 1: Set flows to Draft BEFORE validators run
      // This ensures validators check Draft flows instead of Active flows with runtime errors
      FlowTransformer.setFlowsToDraft(workspace, deploymentMetadata);

      const { apexClassNames, customFields } = templateDataExtract;
      const validationContext: ValidationContext = {
        conn: org.getConnection(),
        org,
        expectedApiVersion: this.expectedApiVersion,
        metadataApiVersion,
        flowFilePaths: filePaths,
        apexClassNames: apexClassNames.length > 0 ? apexClassNames : undefined,
        customFields: customFields.length > 0 ? customFields : undefined,
        logJson,
        intakeFlow: deploymentMetadata.intakeFlow,
        fulfillmentFlow: deploymentMetadata.fulfillmentFlow,
        targetOrgNamespace,
      };
      await ValidationRunner.runValidationsOrThrow(validationContext, builtInValidators);

      deployedFlowNames = deps.serviceProcessTransform(workspace, deploymentMetadata, targetOrgNamespace);

      // Log the updated templateData.json before deployment
      const templateDataPath = path.join(workspace, 'templateData.json');
      if (fs.existsSync(templateDataPath)) {
        const updatedTemplateData = fs.readFileSync(templateDataPath, 'utf-8');
        logger?.log?.('[deployServiceProcess] Updated templateData.json before deploy:');
        logger?.log?.(updatedTemplateData);
      }

      const { zipPath: workspaceZipPath, cleanup: cleanupWorkspaceZip } = await DeployWorkspace.createZipFromWorkspace(
        workspace
      );
      workspaceZipCleanup = cleanupWorkspaceZip;

      const conn = org.getConnection();
      const uploadResult = await deps.uploadZip(conn, workspaceZipPath);
      const contentDocumentId = uploadResult.contentDocumentId;
      logger?.log?.(`Content Document ID: ${contentDocumentId}`);

      const templateDeployResponse = await deps.callTemplateDeploy(conn, contentDocumentId);
      logger?.logJson?.(templateDeployResponse);

      if (templateDeployResponse?.status === 'FAILURE') {
        const message =
          typeof templateDeployResponse === 'object' && templateDeployResponse !== null
            ? `Template deploy failed: ${JSON.stringify(templateDeployResponse)}`
            : 'Template deploy failed.';
        throw new DeployError(message, 'TemplateDeployFailed');
      }

      targetServiceProcessId = templateDeployResponse?.deploymentResult;

      // Enter rollback-protected zone immediately after SP creation
      try {
        // Enable rollback tracking immediately after SP creation
        if (targetServiceProcessId) {
          needsRollback = true;
          rollbackScenario = RollbackScenario.ServiceProcessOnly;
        }

        logger?.log?.(
          `[deployServiceProcess] Before flow transformer: targetServiceProcessId=${String(
            targetServiceProcessId
          )}, intakeForm=${deployedFlowNames?.intakeForm != null ? 'set' : 'none'}`
        );
        await this.runIntakeFormFlowTransform(
          workspace,
          targetServiceProcessId,
          deployedFlowNames,
          templateDataExtract,
          deploymentMetadata,
          logger
        );

        // Only transform fulfillment flow if deploymentIntent is 'deploy'
        if (deployedFlowNames?.fulfillmentFlow && deploymentMetadata?.fulfillmentFlow?.deploymentIntent === 'deploy') {
          const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
          const fulfillmentFlowPath = FlowPathResolver.resolveFlowFilePath(
            flowDir,
            deployedFlowNames.fulfillmentFlow.originalName
          );
          const fulfillmentResult = FlowTransformer.transformFulfillmentFlow(fulfillmentFlowPath, logger);
          if (fulfillmentResult.modified) {
            logger?.log?.(`Flow transformer: ${fulfillmentResult.message}`);
          }
        }

        // Only deploy flows if at least one needs deployment
        if (needsDeployment && filePaths.length > 0) {
          deployedFlows = await deps.deployFlowsFn(org, filePaths, { checkOnly: false, logJson });
          needsRollback = true;
          rollbackScenario = RollbackScenario.ServiceProcessOnly;

          if (deployedFlows.length > 0) {
            const connection = org.getConnection();
            const definitionIds = await getFlowDefinitionIds(
              connection,
              deployedFlows.map((f) => f.fullName)
            );
            logger?.log?.('Fetched flow definition ids from Tooling API:');
            for (const f of deployedFlows) {
              f.definitionId = definitionIds.get(f.fullName);
              const defId = f.definitionId ?? '(not found)';
              logger?.log?.(`  ${f.fullName}: id=${f.id}, definitionId=${defId}`);
            }

            // Upgrade rollback scenario: now flows are deployed
            rollbackScenario = RollbackScenario.ServiceProcessAndFlows;

            if (targetServiceProcessId) {
              await CatalogItemPatcher.patchCatalogItemWithFlowIds(
                connection,
                targetServiceProcessId,
                deployedFlows,
                deployedFlowNames,
                logger
              );
            }
          }
        } else {
          logger?.log?.('[deployServiceProcess] Skipping flow deployment (no flows need deployment)');
          // Flows are already linked via template deployment API
        }

        // Success! Disable rollback
        needsRollback = false;
      } catch (flowDeployError) {
        logger?.log?.(`Flow deployment or linking failed: ${(flowDeployError as Error).message}`);
        if (needsRollback && targetServiceProcessId) {
          logger?.log?.(`Initiating rollback (scenario: ${rollbackScenario ?? 'unknown'})...`);
          await this.performRollback(
            org.getConnection(),
            rollbackScenario!,
            { targetServiceProcessId, deployedFlows, deployedFlowNames },
            logger
          );
          logger?.log?.('Rollback completed successfully.');
        }
        throw flowDeployError;
      }

      return { contentDocumentId, deployedFlowNames, deployedFlows };
    } finally {
      workspaceZipCleanup?.();
      cleanup();
    }
  }

  private async runIntakeFormFlowTransform(
    workspace: string,
    targetServiceProcessId: string | undefined,
    deployedFlowNames: DeployedFlowNames | undefined,
    templateDataExtract: { name?: string },
    deploymentMetadata: DeploymentMetadata | undefined,
    logger?: Logger
  ): Promise<void> {
    // Check if intake flow should be deployed (not linked)
    if (deploymentMetadata?.intakeFlow?.deploymentIntent !== 'deploy') {
      logger?.log?.('[deployServiceProcess] Skipping intake form transformation (deploymentIntent is not deploy)');
      return;
    }

    if (!targetServiceProcessId || !deployedFlowNames?.intakeForm) {
      logger?.log?.(
        '[deployServiceProcess] Skipping flow transformer (no targetServiceProcessId or no intakeForm in deployedFlowNames)'
      );
      return;
    }
    const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
    const intakeFormFlowPath = FlowPathResolver.resolveFlowFilePath(flowDir, deployedFlowNames.intakeForm.originalName);
    logger?.log?.(
      `[deployServiceProcess] Calling FlowTransformer.transformIntakeFormFlow: ${intakeFormFlowPath} ${targetServiceProcessId}`
    );
    const transformResult = await Promise.resolve(
      this.deps.flowTransformer(intakeFormFlowPath, targetServiceProcessId, templateDataExtract.name, logger)
    );
    if (transformResult.modified) {
      logger?.log?.(`Flow transformer: ${transformResult.message}`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private async performRollback(
    connection: Connection,
    scenario: RollbackScenario,
    rollbackData: RollbackData,
    logger?: Logger
  ): Promise<void> {
    try {
      if (scenario === RollbackScenario.ServiceProcessOnly) {
        await RollbackService.rollbackServiceProcessOnly(connection, rollbackData.targetServiceProcessId, logger);
      } else if (scenario === RollbackScenario.ServiceProcessAndFlows) {
        await RollbackService.rollbackServiceProcessAndFlows(connection, rollbackData, logger);
      }
    } catch (rollbackError) {
      logger?.log?.(`Rollback failed: ${(rollbackError as Error).message}`);
      logger?.log?.('Manual cleanup required. Please delete the following resources:');
      logger?.log?.(`  - Service Process ID: ${rollbackData.targetServiceProcessId}`);
      if (rollbackData.deployedFlows && rollbackData.deployedFlows.length > 0) {
        logger?.log?.('  - Deployed flows:');
        for (const flow of rollbackData.deployedFlows) {
          logger?.log?.(`    - ${flow.fullName} (InteractionDefinitionVersion ID: ${flow.id ?? 'unknown'})`);
        }
      }
      // Don't re-throw: original error is more important
    }
  }
}

/**
 * Convenience function: creates a DeployService and runs deploy.
 * Prefer instantiating DeployService when you need to reuse the same service.
 */
export async function deployServiceProcess(options: {
  org: Org;
  inputZip: string;
  expectedApiVersion?: string;
  logger?: Logger;
  logJson?: LogJsonFn;
  dependencies?: DeployServiceProcessDependencies;
}): Promise<DeployServiceProcessResult> {
  const service = new DeployService({
    org: options.org,
    expectedApiVersion: options.expectedApiVersion,
    logger: options.logger,
    logJson: options.logJson,
    dependencies: options.dependencies,
  });
  return service.deploy(options.inputZip);
}
