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
import { createDeploymentContext, type DeploymentContext } from './deploymentContext.js';

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

  /**
   * Main deployment orchestrator.
   * Coordinates the 5 deployment phases: prepare, validate, deploy SP, deploy flows, and rollback (if needed).
   */
  public async deploy(inputZip: string): Promise<DeployServiceProcessResult> {
    // Phase 1: Prepare deployment (extract workspace, read metadata, validate inputs)
    const context = await this.prepareDeployment(inputZip);

    try {
      // Phase 2: Validate deployment
      await this.validateDeployment(context);

      // Phase 3: Deploy Service Process
      await this.deployServiceProcessPhase(context);

      // Phase 4: Deploy and link flows (rollback-protected zone)
      try {
        await this.deployAndLinkFlows(context);

        // Success! Disable rollback
        context.rollback.needed = false;
      } catch (error) {
        // Phase 5: Handle rollback if flow deployment/linking fails
        await this.handleRollback(context, error as Error);
        throw error;
      }

      return {
        contentDocumentId: context.contentDocumentId,
        deployedFlowNames: context.deployedFlowNames,
        deployedFlows: context.deployedFlows,
      };
    } finally {
      context.cleanup();
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

  /**
   * Phase 1: Prepare deployment by extracting workspace, reading metadata, and validating inputs.
   * Returns a DeploymentContext with all necessary state for the deployment.
   */
  private async prepareDeployment(inputZip: string): Promise<DeploymentContext> {
    const { org, logger, logJson } = this;

    logger?.log?.(`inputZip (resolved): ${path.resolve(inputZip)}`);

    // Extract workspace
    const { workspace, cleanup: cleanupWorkspace } = await DeployWorkspace.extractZipToWorkspace(inputZip);

    const { filePaths, templateDataExtract } = TemplateDataReader.deriveFlowsAndTemplateData(workspace);

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

    // Phase 1: Set flows to Draft BEFORE validators run
    // This ensures validators check Draft flows instead of Active flows with runtime errors
    FlowTransformer.setFlowsToDraft(workspace, deploymentMetadata);

    // Create and return deployment context
    return createDeploymentContext({
      workspace,
      inputZip,
      org,
      deploymentMetadata,
      templateDataExtract,
      filePaths,
      needsDeployment,
      needsIntakeDeployment,
      needsFulfillmentDeployment,
      cleanupWorkspace,
      logger,
      logJson,
    });
  }

  /**
   * Phase 2: Validate deployment using built-in validators.
   */
  private async validateDeployment(context: DeploymentContext): Promise<void> {
    const metadataApiVersion = TemplateDataReader.readOrgMetadataVersionFromDir(context.workspace);
    const targetOrgNamespace = await getOrgNamespace(context.org.getConnection());

    const { apexClassNames, customFields } = context.templateDataExtract;
    const validationContext: ValidationContext = {
      conn: context.org.getConnection(),
      org: context.org,
      expectedApiVersion: this.expectedApiVersion,
      metadataApiVersion,
      flowFilePaths: context.filePaths,
      apexClassNames: apexClassNames.length > 0 ? apexClassNames : undefined,
      customFields: customFields.length > 0 ? customFields : undefined,
      logJson: context.logJson,
      intakeFlow: context.deploymentMetadata.intakeFlow,
      fulfillmentFlow: context.deploymentMetadata.fulfillmentFlow,
      targetOrgNamespace,
    };
    await ValidationRunner.runValidationsOrThrow(validationContext, builtInValidators);
  }

  /**
   * Phase 3: Deploy Service Process (transform templateData, create zip, upload, deploy template).
   */
  private async deployServiceProcessPhase(context: DeploymentContext): Promise<void> {
    const { logger, deps } = this;
    const targetOrgNamespace = await getOrgNamespace(context.org.getConnection());

    // Transform templateData.json
    // eslint-disable-next-line no-param-reassign
    context.deployedFlowNames = deps.serviceProcessTransform(
      context.workspace,
      context.deploymentMetadata,
      targetOrgNamespace
    );

    // Log the updated templateData.json before deployment
    const templateDataPath = path.join(context.workspace, 'templateData.json');
    if (fs.existsSync(templateDataPath)) {
      const updatedTemplateData = fs.readFileSync(templateDataPath, 'utf-8');
      logger?.log?.('[deployServiceProcess] Updated templateData.json before deploy:');
      logger?.log?.(updatedTemplateData);
    }

    // Create zip and upload
    const { zipPath, cleanup } = await DeployWorkspace.createZipFromWorkspace(context.workspace);
    // eslint-disable-next-line no-param-reassign
    context.cleanupWorkspaceZip = cleanup;

    const conn = context.org.getConnection();
    const uploadResult = await deps.uploadZip(conn, zipPath);
    // eslint-disable-next-line no-param-reassign
    context.contentDocumentId = uploadResult.contentDocumentId;
    logger?.log?.(`Content Document ID: ${context.contentDocumentId}`);

    // Deploy template
    const templateDeployResponse = await deps.callTemplateDeploy(conn, context.contentDocumentId);
    logger?.logJson?.(templateDeployResponse);

    if (templateDeployResponse?.status === 'FAILURE') {
      const message =
        typeof templateDeployResponse === 'object' && templateDeployResponse !== null
          ? `Template deploy failed: ${JSON.stringify(templateDeployResponse)}`
          : 'Template deploy failed.';
      throw new DeployError(message, 'TemplateDeployFailed');
    }

    // eslint-disable-next-line no-param-reassign
    context.targetServiceProcessId = templateDeployResponse?.deploymentResult;

    // Enable rollback for ServiceProcessOnly scenario
    // eslint-disable-next-line no-param-reassign
    context.rollback.needed = true;
    // eslint-disable-next-line no-param-reassign
    context.rollback.scenario = RollbackScenario.ServiceProcessOnly;
  }

  /**
   * Phase 4: Deploy and link flows (transform flows, deploy via Metadata API, link to Service Process).
   */
  private async deployAndLinkFlows(context: DeploymentContext): Promise<void> {
    const { logger, logJson, deps } = this;

    // Skip if no deployment needed
    if (!context.needsDeployment || context.filePaths.length === 0) {
      logger?.log?.('[deployServiceProcess] Skipping flow deployment (no flows need deployment)');
      return;
    }

    // Transform intake flow
    await this.runIntakeFormFlowTransform(
      context.workspace,
      context.targetServiceProcessId,
      context.deployedFlowNames,
      context.templateDataExtract,
      context.deploymentMetadata,
      logger
    );

    // Transform fulfillment flow
    if (
      context.deployedFlowNames?.fulfillmentFlow &&
      context.deploymentMetadata?.fulfillmentFlow?.deploymentIntent === 'deploy'
    ) {
      const flowDir = path.join(context.workspace, METADATA_FLOWS_RELATIVE_PATH);
      const fulfillmentFlowPath = FlowPathResolver.resolveFlowFilePath(
        flowDir,
        context.deployedFlowNames.fulfillmentFlow.originalName
      );
      const fulfillmentResult = FlowTransformer.transformFulfillmentFlow(fulfillmentFlowPath, logger);
      if (fulfillmentResult.modified) {
        logger?.log?.(`Flow transformer: ${fulfillmentResult.message}`);
      }
    }

    // Deploy flows
    // eslint-disable-next-line no-param-reassign
    context.deployedFlows = await deps.deployFlowsFn(context.org, context.filePaths, { checkOnly: false, logJson });

    if (context.deployedFlows.length === 0) {
      return;
    }

    // Enrich with FlowDefinition IDs
    const connection = context.org.getConnection();
    const definitionIds = await getFlowDefinitionIds(
      connection,
      context.deployedFlows.map((f) => f.fullName)
    );
    logger?.log?.('Fetched flow definition ids from Tooling API:');
    for (const f of context.deployedFlows) {
      f.definitionId = definitionIds.get(f.fullName);
      const defId = f.definitionId ?? '(not found)';
      logger?.log?.(`  ${f.fullName}: id=${f.id}, definitionId=${defId}`);
    }

    // Upgrade rollback scenario: now flows are deployed
    // eslint-disable-next-line no-param-reassign
    context.rollback.scenario = RollbackScenario.ServiceProcessAndFlows;

    // Link flows to Service Process
    if (context.targetServiceProcessId) {
      await CatalogItemPatcher.patchCatalogItemWithFlowIds(
        connection,
        context.targetServiceProcessId,
        context.deployedFlows,
        context.deployedFlowNames,
        logger
      );
    }
  }

  /**
   * Phase 5: Handle rollback when deployment fails.
   */
  private async handleRollback(context: DeploymentContext, error: Error): Promise<void> {
    const { logger } = this;

    logger?.log?.(`Deployment failed: ${error.message}`);

    if (!context.rollback.needed || !context.targetServiceProcessId) {
      return;
    }

    logger?.log?.(`Initiating rollback (scenario: ${context.rollback.scenario ?? 'unknown'})...`);

    const rollbackData: RollbackData = {
      targetServiceProcessId: context.targetServiceProcessId,
      deployedFlows: context.deployedFlows,
      deployedFlowNames: context.deployedFlowNames,
    };

    await this.performRollback(context.org.getConnection(), context.rollback.scenario!, rollbackData, logger);

    logger?.log?.('Rollback completed successfully.');
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
