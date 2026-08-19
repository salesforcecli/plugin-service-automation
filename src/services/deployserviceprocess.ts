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
import type { Logger } from '@salesforce/core';
import type { SfCommand } from '@salesforce/sf-plugins-core';
import { METADATA_FLOWS_RELATIVE_PATH } from '../constants.js';
import { DeployError, MissingMetadataFileError, TemplateDataError, ValidationError } from '../errors.js';
import { type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { getFlowDefinitionIds, getOrgNamespace } from '../utils/flow/flowMetadata.js';
import { DeployWorkspace } from '../workspace/deployWorkspace.js';
import { FlowTransformer } from '../workspace/flowTransformer.js';
import { FlowPathResolver } from '../workspace/flowPath.js';
import { TemplateDataReader } from '../workspace/templateData.js';
import {
  readServiceProcessMetadata,
  writeServiceProcessMetadata,
  type DeploymentMetadata,
} from '../workspace/deploymentMetadata.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import { ValidationRunner, builtInValidatorsWithMetadata } from '../validation/index.js';
import type { ValidationContext } from '../validation/types.js';
import { DeploymentStages, type TreeItem } from '../utils/deploymentStages.js';
import { publishLifecycleMetric, toKilobytes } from '../utils/lifecycleMetrics.js';
import { formatErrorResponseForLog } from '../utils/safeStringify.js';
import { RollbackStages, ROLLBACK_SECTION_HEADER } from '../utils/rollbackStages.js';
import { defaults, type DeployServiceProcessDependencies } from './deployDependencies.js';
import { CatalogItemPatcher } from './catalogItemPatch.js';
import { RollbackService, RollbackScenario, type RollbackData } from './rollback.js';
import { createDeploymentContext, type DeploymentContext } from './deploymentContext.js';

/** Helper to apply updates to deployment context immutably (avoids no-param-reassign). */
class DeploymentContextUpdater {
  public static update(context: DeploymentContext, updates: Partial<DeploymentContext>): DeploymentContext {
    return { ...context, ...updates };
  }
}

export type { DeployedFlowNames, FlowNameTracking } from '../workspace/serviceProcessTransformer.js';
export type { DeployServiceProcessDependencies } from './deployDependencies.js';

export type DeployServiceProcessResult = {
  contentDocumentId?: string;
  deployedFlowNames?: DeployedFlowNames;
  /** Deployed flow ids and names (only when deployment was not checkOnly). */
  deployedFlows?: DeployedFlowInfo[];
  /** Deployment context (for JSON output formatting) */
  context?: DeploymentContext;
};

export type DeployServiceOptions = {
  org: Org;
  /** Optional: expected API version (e.g. from --api-version flag); validated against org if set. */
  expectedApiVersion?: string;
  /** SfCommand instance for spinner and logging */
  command?: SfCommand<unknown>;
  /** Optional: DeploymentStages for visual progress display */
  deployStages?: DeploymentStages;
  /** Optional: @salesforce/core Logger for diagnostic output (respects global --loglevel or SF_LOG_LEVEL). */
  logger?: Logger;
  /** Correlation id from command layer for telemetry and logs. */
  runId?: string;
  /** When true, set intake flow deploymentIntent to "link" and namespace to target org's namespace in deployment-metadata.json during preparation. */
  linkIntake?: boolean;
  /** When true, set fulfillment flow deploymentIntent to "link" and namespace to target org's namespace in deployment-metadata.json during preparation. */
  linkFulfillment?: boolean;
  dependencies?: DeployServiceProcessDependencies;
};

/**
 * Service to deploy a Service Process (Flow) to a target org.
 * Expects a .zip file: extracts it, validates, uploads template zip, calls template deploy API, transforms intake flow, deploys flows.
 */
export class DeployService {
  private readonly org: Org;
  private readonly expectedApiVersion?: string;
  private readonly command?: SfCommand<unknown>;
  private readonly deployStages?: DeploymentStages;
  private readonly logger?: Logger;
  private readonly runId?: string;
  private readonly linkIntake: boolean;
  private readonly linkFulfillment: boolean;
  private readonly deps: Required<DeployServiceProcessDependencies>;

  public constructor(options: DeployServiceOptions) {
    this.org = options.org;
    this.expectedApiVersion = options.expectedApiVersion;
    this.command = options.command;
    this.deployStages = options.deployStages;
    this.logger = options.logger;
    this.runId = options.runId;
    this.linkIntake = options.linkIntake ?? false;
    this.linkFulfillment = options.linkFulfillment ?? false;
    this.deps = { ...defaults, ...options.dependencies } as Required<DeployServiceProcessDependencies>;
  }

  /**
   * Helper method to build flow display items for the "Deploying metadata" phase.
   *
   * @param context - The deployment context
   * @param includeIds - Whether to include InteractionDefinitionVersion IDs in the display
   * @returns Array of label/value pairs for display
   */
  private static buildFlowDisplayItems(
    context: DeploymentContext,
    includeIds: boolean = false
  ): Array<{ label: string; value: string }> {
    const items: Array<{ label: string; value: string }> = [];

    // Intake flow
    if (context.deploymentMetadata.intakeFlow?.deploymentIntent === 'deploy') {
      let value = context.deploymentMetadata.intakeFlow.apiName;

      if (includeIds && context.deployedFlows) {
        const flow = context.deployedFlows.find((f) => f.fullName === context.deploymentMetadata.intakeFlow?.apiName);
        const id = flow?.id ?? 'unknown';
        value = `${value} (${id})`;
      }

      items.push({ label: 'Intake Flow', value });
    }

    // Fulfillment flow
    if (context.deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'deploy') {
      let value = context.deploymentMetadata.fulfillmentFlow.apiName;

      if (includeIds && context.deployedFlows) {
        const flow = context.deployedFlows.find(
          (f) => f.fullName === context.deploymentMetadata.fulfillmentFlow?.apiName
        );
        const id = flow?.id ?? 'unknown';
        value = `${value} (${id})`;
      }

      items.push({ label: 'Fulfillment Flow', value });
    }

    return items;
  }

  /**
   * Main deployment orchestrator.
   * Coordinates the 5 deployment phases: prepare, validate, deploy SP, deploy flows, and rollback (if needed).
   */
  public async deploy(inputZip: string): Promise<DeployServiceProcessResult> {
    // Phase 1: Prepare deployment (extract workspace, read metadata, validate inputs)
    this.deployStages?.startPhase('Preparing connection');
    let context = await this.prepareDeployment(inputZip);
    this.deployStages?.succeedPhase('Preparing connection');

    try {
      // Phase 2: Validate deployment
      this.logger?.info('Starting validation');
      await this.validateDeployment(context);

      // Phase 3: Deploy Service Process
      this.logger?.info('Starting Service Process creation');
      context = await this.deployServiceProcessPhase(context);

      // Phase 4a: Deploy flow metadata (only if needed - rollback-protected zone)
      // Phase 4b: Finalize deployment (link flows to service process)
      let skippedToDone = false;
      try {
        if (context.needsDeployment && context.filePaths.length > 0) {
          // Deploy metadata
          this.logger?.info('Starting metadata deploy');
          context = await this.deployMetadata(context);

          // After deploying, check if we have flows to link to the catalog item
          if (context.deployedFlows && context.deployedFlows.length > 0) {
            await this.finalizeDeployment(context);
          } else {
            // Skip to Done (no flows deployed, so no finalization needed)
            this.deployStages?.skipToPhase('Done');
            skippedToDone = true;
          }
        } else {
          // Skip both metadata deployment and finalization, go straight to Done
          this.deployStages?.skipToPhase('Done');
          skippedToDone = true;
        }
        // Success! Disable rollback
        context = DeploymentContextUpdater.update(context, {
          rollback: { ...context.rollback, needed: false },
        });
      } catch (error) {
        // Stop deploy MSO and show failure first so output order is: deploy failure → rollback → status (not rollback then deploy).
        // Only needed for TestFlowDeploymentFailure; FlowDeploymentFailed/FinalizationFailed already called failPhase in their phase.
        const isTestFailure = (error as DeployError)?.code === 'TestFlowDeploymentFailure';
        if (context.rollback.needed && this.deployStages && isTestFailure) {
          this.deployStages.failPhase('Deploying metadata', error as Error);
        }
        // Phase 5: Handle rollback if flow deployment/linking fails
        this.logger?.error(`Deploy phase failed, starting rollback: ${(error as Error).message}`);
        context = await this.handleRollback(context, error as Error);
        // Attach context to error for JSON formatting
        (error as Error & { context?: DeploymentContext }).context = context;
        throw error;
      }

      // Move to Done stage (only if we didn't already skip to it)
      if (!skippedToDone) {
        this.deployStages?.startPhase('Done');
        this.deployStages?.succeedPhase('Done');
      }

      // Stop MSO before logging summary to prevent output reordering
      this.deployStages?.stop();

      if (this.deployStages) {
        const linkedCount = this.countLinkedComponents(context);
        this.deployStages.logSummary({
          status: 'SUCCESS',
          serviceProcessName: context.templateDataExtract.name ?? 'Unknown',
          serviceProcessId: context.targetServiceProcessId ?? 'Unknown',
          deployedCount: context.deployedFlows?.length ?? 0,
          linkedCount,
          duration: Date.now() - context.startTime,
        });
      }

      return {
        contentDocumentId: context.contentDocumentId,
        deployedFlowNames: context.deployedFlowNames,
        deployedFlows: context.deployedFlows,
        context,
      };
    } catch (error) {
      // Attach context to any error thrown during preparation or validation
      (error as Error & { context?: DeploymentContext }).context = context;
      throw error;
    } finally {
      context.cleanup();
    }
  }

  /**
   * Count linked components (flows with link intent + preprocessors from templateData)
   */
  // eslint-disable-next-line class-methods-use-this
  private countLinkedComponents(context: DeploymentContext): number {
    let count = 0;

    // Count flows with link intent
    if (context.deploymentMetadata.intakeFlow?.deploymentIntent === 'link') {
      count++;
    }
    if (context.deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'link') {
      count++;
    }

    // Count preprocessors from templateData.json if available
    try {
      const templateDataPath = path.join(context.workspace, 'templateData.json');
      if (fs.existsSync(templateDataPath)) {
        const templateData: unknown = JSON.parse(fs.readFileSync(templateDataPath, 'utf-8'));
        if (
          templateData &&
          typeof templateData === 'object' &&
          'preProcessors' in templateData &&
          Array.isArray(templateData.preProcessors)
        ) {
          count += templateData.preProcessors.length;
        }
      }
    } catch {
      // Ignore errors reading templateData
    }

    return count;
  }

  private async runIntakeFormFlowTransform(
    workspace: string,
    targetServiceProcessId: string | undefined,
    deployedFlowNames: DeployedFlowNames | undefined,
    deploymentMetadata: DeploymentMetadata | undefined
  ): Promise<void> {
    // Check if intake flow should be deployed (not linked)
    if (deploymentMetadata?.intakeFlow?.deploymentIntent !== 'deploy') {
      this.logger?.debug('Skipping intake form transformation (deploymentIntent is not deploy)');
      return;
    }

    if (!targetServiceProcessId || !deployedFlowNames?.intakeForm) {
      this.logger?.debug('Skipping flow transformer (no targetServiceProcessId or no intakeForm in deployedFlowNames)');
      return;
    }
    const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
    const intakeFormFlowPath = FlowPathResolver.resolveFlowFilePath(flowDir, deployedFlowNames.intakeForm.originalName);
    const transformStart = Date.now();
    this.logger?.debug(
      `Calling FlowTransformer.transformIntakeFormFlow: ${intakeFormFlowPath} ${targetServiceProcessId}`
    );
    const transformResult = await Promise.resolve(
      this.deps.flowTransformer(intakeFormFlowPath, targetServiceProcessId, this.logger)
    );
    if (transformResult.modified) {
      this.logger?.debug(`Flow transformer: ${transformResult.message}`);
    }
    await publishLifecycleMetric(this.logger, 'spFlowIdPatching', {
      runId: this.runId,
      spId: targetServiceProcessId,
      flowName: deployedFlowNames.intakeForm.originalName,
      stepExecutionDurationMs: Date.now() - transformStart,
      status: 'SUCCESS',
    });
  }

  /**
   * Phase 1: Prepare deployment by extracting workspace, reading metadata, and validating inputs.
   * Returns a DeploymentContext with all necessary state for the deployment.
   */
  private async prepareDeployment(inputZip: string): Promise<DeploymentContext> {
    const { org } = this;

    // Extract workspace
    const { workspace, cleanup: cleanupWorkspace } = await DeployWorkspace.extractZipToWorkspace(inputZip);
    this.logger?.debug(`Workspace extracted to ${workspace}`);

    // Get connection and target org namespace early so we can apply --link-intake / --link-fulfillment overrides before validations
    const connection = this.org.getConnection(this.expectedApiVersion);
    const targetOrgNamespace = await getOrgNamespace(connection);

    // Read combined service-process.metadata.json (org + deployment metadata)
    const serviceProcessMetadata = await readServiceProcessMetadata(workspace);
    if (!serviceProcessMetadata) {
      throw new MissingMetadataFileError('service-process.metadata.json not found in the input zip.');
    }
    const deploymentMetadata: DeploymentMetadata = {
      version: serviceProcessMetadata.version,
      intakeFlow: serviceProcessMetadata.serviceProcess.intakeFlow,
      fulfillmentFlow: serviceProcessMetadata.serviceProcess.fulfillmentFlow,
    };

    // Apply --link-intake / --link-fulfillment overrides: set deploymentIntent to "link" and namespace to target org's namespace
    let metadataUpdated = false;
    if (this.linkIntake && deploymentMetadata.intakeFlow) {
      deploymentMetadata.intakeFlow.deploymentIntent = 'link';
      deploymentMetadata.intakeFlow.namespace = targetOrgNamespace ?? null;
      metadataUpdated = true;
    }
    if (this.linkFulfillment && deploymentMetadata.fulfillmentFlow) {
      deploymentMetadata.fulfillmentFlow.deploymentIntent = 'link';
      deploymentMetadata.fulfillmentFlow.namespace = targetOrgNamespace ?? null;
      metadataUpdated = true;
    }
    if (metadataUpdated) {
      await writeServiceProcessMetadata(workspace, serviceProcessMetadata);
    }

    this.logger?.debug(
      `Deployment metadata: intake=${deploymentMetadata.intakeFlow?.deploymentIntent ?? 'none'}, fulfillment=${
        deploymentMetadata.fulfillmentFlow?.deploymentIntent ?? 'none'
      }`
    );

    const { filePaths, templateDataExtract } = TemplateDataReader.deriveFlowsAndTemplateData(workspace);

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

    this.logger?.debug(`Prepare complete: ${filePaths.length} flow file(s) to deploy`);

    // Create and return deployment context
    return createDeploymentContext({
      workspace,
      inputZip,
      org,
      connection,
      deploymentMetadata,
      templateDataExtract,
      filePaths,
      needsDeployment,
      needsIntakeDeployment,
      needsFulfillmentDeployment,
      cleanupWorkspace,
      logger: this.logger,
    });
  }

  /**
   * Phase 2: Validate deployment using built-in validators.
   */
  private async validateDeployment(context: DeploymentContext): Promise<void> {
    const phaseStart = Date.now();

    try {
      const metadataApiVersion = TemplateDataReader.readOrgMetadataVersionFromDir(context.workspace);
      const targetOrgNamespace = await getOrgNamespace(context.connection);

      const { apexClassNames, customFields } = context.templateDataExtract;

      // Filter validators based on deployment context (before starting phase so we know the count)
      const activeValidators = builtInValidatorsWithMetadata.filter((v) => {
        // Skip CustomFieldsValidator if no custom fields
        if (v.name === 'CustomFields' && customFields.length === 0) {
          return false;
        }

        // Skip ApexClassPresenceValidator if no apex classes
        if (v.name === 'ApexClass' && apexClassNames.length === 0) {
          return false;
        }

        // Skip FlowDeploymentValidator if no flows are being deployed
        // Only run if at least one flow has deploymentIntent === 'deploy'
        if (v.name === 'FlowDeployment') {
          const intakeIsDeploying = context.deploymentMetadata.intakeFlow?.deploymentIntent === 'deploy';
          const fulfillmentIsDeploying = context.deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'deploy';

          // Skip if neither flow is being deployed (both are in link mode or don't exist)
          if (!intakeIsDeploying && !fulfillmentIsDeploying) {
            return false;
          }
        }

        // Skip intake flow uniqueness check if in link mode
        if (v.name === 'IntakeFlowUniqueness' && context.deploymentMetadata.intakeFlow?.deploymentIntent === 'link') {
          return false;
        }

        // Skip intake flow existence check if in deploy mode or no intake flow
        if (
          v.name === 'IntakeFlowExistence' &&
          (context.deploymentMetadata.intakeFlow?.deploymentIntent === 'deploy' ||
            !context.deploymentMetadata.intakeFlow)
        ) {
          return false;
        }

        // Skip fulfillment flow uniqueness check if in link mode
        if (
          v.name === 'FulfillmentFlowUniqueness' &&
          context.deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'link'
        ) {
          return false;
        }

        // Skip fulfillment flow existence check if in deploy mode or no fulfillment flow
        if (
          v.name === 'FulfillmentFlowExistence' &&
          (context.deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'deploy' ||
            !context.deploymentMetadata.fulfillmentFlow)
        ) {
          return false;
        }

        return true;
      });

      // Set validator count and start phase
      this.deployStages?.setValidatorCount(activeValidators.length);
      this.deployStages?.startPhase('Validating deployment');

      const validationContext: ValidationContext = {
        conn: context.connection,
        org: context.org,
        expectedApiVersion: this.expectedApiVersion,
        metadataApiVersion,
        flowFilePaths: context.filePaths,
        apexClassNames: apexClassNames.length > 0 ? apexClassNames : undefined,
        customFields: customFields.length > 0 ? customFields : undefined,
        logger: this.logger,
        intakeFlow: context.deploymentMetadata.intakeFlow,
        fulfillmentFlow: context.deploymentMetadata.fulfillmentFlow,
        targetOrgNamespace,
        onValidatorStart: (name, description) => {
          this.deployStages?.startValidatorSubstage(name, description);
        },
        onValidatorComplete: (name, success) => {
          this.deployStages?.completeValidatorSubstage(name, success);
          if (success) {
            this.logger?.debug(`Validator passed: ${name}`);
          }
        },
      };

      await ValidationRunner.runValidationsWithProgress(validationContext, activeValidators);
      await publishLifecycleMetric(this.logger, 'spPreDeploymentValidation', {
        runId: this.runId,
        missingDependencyCount: 0,
        stepExecutionDurationMs: Date.now() - phaseStart,
        status: 'SUCCESS',
      });

      // Success - substages remain visible showing which validators ran
      this.deployStages?.succeedPhase('Validating deployment');

      this.logger?.info(`Validation completed in ${Date.now() - phaseStart}ms`);
      context.recordPhaseTime('validation', Date.now() - phaseStart);
    } catch (error) {
      this.logger?.error(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof ValidationError && error.failures?.length) {
        this.logger?.debug(`Validation failed validators: ${error.failures.map((f) => f.name).join(', ')}`);
        await publishLifecycleMetric(this.logger, 'spPreDeploymentValidation', {
          runId: this.runId,
          missingDependencyCount: error.failures.length,
          stepExecutionDurationMs: Date.now() - phaseStart,
          status: 'FAILURE',
          errorTrigger: error.message,
        });
      } else {
        await publishLifecycleMetric(this.logger, 'spPreDeploymentValidation', {
          runId: this.runId,
          missingDependencyCount: -1,
          stepExecutionDurationMs: Date.now() - phaseStart,
          status: 'FAILURE',
          errorTrigger: error instanceof Error ? error.message : String(error),
        });
      }
      // Stack only for unexpected errors during validation phase (not business-rule ValidationError)
      if (this.logger && error instanceof Error && error.stack && !(error instanceof ValidationError)) {
        this.logger.debug(`Validation error stack: ${error.stack}`);
      }
      this.logger?.debug(`Validation failed in ${Date.now() - phaseStart}ms`);
      this.deployStages?.failPhase('Validating deployment', error as Error);
      throw error;
    }
  }

  /**
   * Phase 3: Deploy Service Process (transform templateData, create zip, upload, deploy template).
   */
  // eslint-disable-next-line complexity
  private async deployServiceProcessPhase(context: DeploymentContext): Promise<DeploymentContext> {
    this.deployStages?.startPhase('Creating Service Process');
    const phaseStart = Date.now();

    try {
      const { deps } = this;
      const targetOrgNamespace = await getOrgNamespace(context.connection);

      // Transform templateData.json
      const deployedFlowNames = deps.serviceProcessTransform(
        context.workspace,
        context.deploymentMetadata,
        targetOrgNamespace
      );

      const templateDataPath = path.join(context.workspace, 'templateData.json');
      if (this.logger && fs.existsSync(templateDataPath)) {
        this.logger?.debug('templateData.json updated before deploy');
      }

      // Create zip and upload
      const { zipPath, cleanup } = await DeployWorkspace.createZipFromWorkspace(context.workspace);
      const cleanupWorkspaceZip = cleanup;
      const zipSizeBytes = fs.statSync(zipPath).size;

      const conn = context.connection;
      this.logger?.debug(`Uploading zip (path=${zipPath})`);
      const uploadStart = Date.now();
      const uploadResult = await deps.uploadZip(conn, zipPath);
      const contentDocumentId = uploadResult.contentDocumentId;
      await publishLifecycleMetric(this.logger, 'spContentCreation', {
        runId: this.runId,
        documentSizeKB: toKilobytes(zipSizeBytes),
        documentId: contentDocumentId,
        stepExecutionDurationMs: Date.now() - uploadStart,
        status: 'SUCCESS',
      });
      this.logger?.debug(`Upload completed in ${Date.now() - uploadStart}ms`);
      this.logger?.debug(`Upload full response: ${JSON.stringify(uploadResult)}`);

      // Deploy template (always pass serviceProcessName from templateData when available)
      const templateDeployBody = {
        serviceProcessName: context.templateDataExtract?.name ?? '',
        deploymentMode: 'CrossOrg',
      };
      this.logger?.debug(
        `Service Process creation API start (contentDocumentId=${contentDocumentId}, serviceProcessName=${templateDeployBody.serviceProcessName})`
      );
      const spApiStart = Date.now();
      const templateDeployResponse = await deps.callTemplateDeploy(conn, contentDocumentId, templateDeployBody);
      await publishLifecycleMetric(this.logger, 'spCreationApi', {
        runId: this.runId,
        spId: templateDeployResponse?.deploymentResult ?? null,
        status: templateDeployResponse?.status ?? 'unknown',
        stepExecutionDurationMs: Date.now() - spApiStart,
      });
      this.logger?.debug(`Service Process creation completed in ${Date.now() - phaseStart}ms`);
      this.logger?.debug(`Service Process creation full response: ${JSON.stringify(templateDeployResponse)}`);

      if (templateDeployResponse?.status === 'FAILURE') {
        const message =
          typeof templateDeployResponse === 'object' && templateDeployResponse !== null
            ? `Template deploy failed: ${JSON.stringify(templateDeployResponse)}`
            : 'Template deploy failed.';
        throw new DeployError(message, 'TemplateDeployFailed');
      }

      const targetServiceProcessId = templateDeployResponse?.deploymentResult;

      // Success - show tree structure for linked components
      this.deployStages?.succeedPhase('Creating Service Process');

      // Build tree items for linked components
      const treeItems: TreeItem[] = [];

      // Read preprocessors from templateData
      let preprocessors: string[] = [];
      try {
        const templateData: unknown = JSON.parse(fs.readFileSync(templateDataPath, 'utf-8'));
        if (
          templateData &&
          typeof templateData === 'object' &&
          'preProcessors' in templateData &&
          Array.isArray(templateData.preProcessors)
        ) {
          preprocessors = templateData.preProcessors
            .map((p: unknown) => {
              if (p && typeof p === 'object' && 'apiName' in p && typeof p.apiName === 'string') {
                return p.apiName;
              }
              return undefined;
            })
            .filter((name: string | undefined): name is string => !!name);
        }
      } catch {
        // Ignore
      }

      // Add preprocessors to tree
      if (preprocessors.length > 0) {
        preprocessors.forEach((p) => {
          treeItems.push({ label: 'Preprocessor (Linked)', value: p });
        });
      }

      // Add intake flow (linked or deployed)
      if (context.deploymentMetadata.intakeFlow) {
        const isLinked = context.deploymentMetadata.intakeFlow.deploymentIntent === 'link';
        treeItems.push({
          label: isLinked ? 'Intake Flow (Linked)' : 'Intake Flow (Deployed and Linked)',
          value: context.deploymentMetadata.intakeFlow.apiName,
        });
      }

      // Add fulfillment flow (linked or deployed)
      if (context.deploymentMetadata.fulfillmentFlow) {
        const isLinked = context.deploymentMetadata.fulfillmentFlow.deploymentIntent === 'link';
        treeItems.push({
          label: isLinked ? 'Fulfillment (Linked)' : 'Fulfillment (Deployed and Linked)',
          value: context.deploymentMetadata.fulfillmentFlow.apiName,
        });
      }

      // Display tree structure if any items
      if (treeItems.length > 0) {
        this.deployStages?.logTreeStructure(context.templateDataExtract.name ?? 'Unknown', treeItems);
      }

      if (this.logger) {
        if (targetServiceProcessId) {
          this.logger?.debug(`Service Process ID: ${targetServiceProcessId}`);
        }
        if (contentDocumentId) {
          this.logger?.debug(`Content Document ID: ${contentDocumentId}`);
        }
      }

      const nextContext = DeploymentContextUpdater.update(context, {
        deployedFlowNames,
        cleanupWorkspaceZip,
        contentDocumentId,
        targetServiceProcessId,
        rollback: { ...context.rollback, needed: true, scenario: RollbackScenario.ServiceProcessOnly },
      });
      nextContext.recordPhaseTime('createServiceProcess', Date.now() - phaseStart);
      return nextContext;
    } catch (error) {
      this.logger?.error(`Service Process creation failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (this.logger && err.response !== undefined) {
        this.logger.debug(`Service Process creation error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      if (this.logger && error instanceof Error && error.stack) {
        this.logger.debug(`Service Process creation error stack: ${error.stack}`);
      }
      this.logger?.debug(`Service Process creation failed in ${Date.now() - phaseStart}ms`);
      this.deployStages?.failPhase('Creating Service Process', error as Error);
      throw error;
    }
  }

  /**
   * Phase 4a: Deploy flow metadata (transform flows, deploy via Metadata API).
   * NOTE: This method should only be called when deployment is actually needed (checked by caller).
   */
  private async deployMetadata(context: DeploymentContext): Promise<DeploymentContext> {
    const { deps } = this;

    this.deployStages?.startPhase('Deploying metadata');
    const deployStart = Date.now();

    try {
      // Show which flows are being deployed (without IDs initially)
      if (this.command && !this.command.jsonEnabled()) {
        this.deployStages?.setDeployingMetadataItems(DeployService.buildFlowDisplayItems(context, false));
      }

      // Transform intake flow
      await this.runIntakeFormFlowTransform(
        context.workspace,
        context.targetServiceProcessId,
        context.deployedFlowNames,
        context.deploymentMetadata
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
        const fulfillmentResult = FlowTransformer.transformFulfillmentFlow(
          fulfillmentFlowPath,
          context.targetServiceProcessId,
          this.logger
        );
        if (fulfillmentResult.modified) {
          this.logger?.debug(`Flow transformer: ${fulfillmentResult.message}`);
        }
      }

      // Deploy flows
      const deployedFlows = await deps.deployFlowsFn(context.connection, context.filePaths, {
        checkOnly: false,
        logger: this.logger,
      });

      if (deployedFlows.length === 0) {
        this.deployStages?.succeedPhase('Deploying metadata');
        this.logger?.info(`Metadata deploy completed in ${Date.now() - deployStart}ms (no flows deployed)`);
        context.recordPhaseTime('deployMetadata', Date.now() - deployStart);
        return context;
      }

      this.logger?.info(`Deployed ${deployedFlows.length} flow(s): ${deployedFlows.map((f) => f.fullName).join(', ')}`);

      // Enrich with FlowDefinition IDs for catalog item linking
      // Note: Two types of IDs exist:
      // - InteractionDefinitionVersion ID (f.id) - shown to user, comes from metadata API deployment
      // - FlowDefinition ID (f.definitionId) - used for catalog linking, fetched from Tooling API
      const connection = context.connection;
      const definitionIds = await getFlowDefinitionIds(
        connection,
        deployedFlows.map((f) => f.fullName)
      );
      this.logger?.debug('Fetched flow definition ids from Tooling API');
      const enrichedFlows = deployedFlows.map((f) => ({
        ...f,
        definitionId: definitionIds.get(f.fullName),
      }));
      for (const f of enrichedFlows) {
        this.logger?.debug(`${f.fullName}: id=${f.id}, definitionId=${f.definitionId ?? '(not found)'}`);
      }

      // Update flow items display to include InteractionDefinitionVersion IDs (from deployment)
      if (this.command && !this.command.jsonEnabled()) {
        this.deployStages?.setDeployingMetadataItems(
          DeployService.buildFlowDisplayItems({ ...context, deployedFlows: enrichedFlows }, true)
        );
      }

      const nextContext = DeploymentContextUpdater.update(context, {
        deployedFlows: enrichedFlows,
        rollback: { ...context.rollback, scenario: RollbackScenario.ServiceProcessAndFlows },
      });
      this.deployStages?.succeedPhase('Deploying metadata');
      this.logger?.info(`Metadata deploy completed in ${Date.now() - deployStart}ms`);
      nextContext.recordPhaseTime('deployMetadata', Date.now() - deployStart);
      return nextContext;
    } catch (error) {
      this.logger?.error(`Metadata deploy failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (this.logger && err.response !== undefined) {
        this.logger.debug(`Metadata deploy error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      if (this.logger && error instanceof Error && error.stack) {
        this.logger.debug(`Metadata deploy error stack: ${error.stack}`);
      }
      this.logger?.debug(`Metadata deploy failed in ${Date.now() - deployStart}ms`);
      this.deployStages?.failPhase('Deploying metadata', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new DeployError(message, 'FlowDeploymentFailed');
    }
  }

  /**
   * Phase 4b: Finalize deployment (link flows to Service Process via catalog item patching).
   */
  private async finalizeDeployment(context: DeploymentContext): Promise<void> {
    this.logger?.info('Starting linking of deployed components');
    this.deployStages?.startPhase('Linking deployed components');
    const finalizeStart = Date.now();

    try {
      // Link flows to Service Process (if flows were deployed)
      if (context.targetServiceProcessId && context.deployedFlows && context.deployedFlows.length > 0) {
        const connection = context.connection;
        await CatalogItemPatcher.patchCatalogItemWithFlowIds(
          connection,
          context.targetServiceProcessId,
          context.deployedFlows,
          context.deployedFlowNames,
          context.templateDataExtract?.name,
          this.logger,
          this.runId
        );
      }

      this.deployStages?.succeedPhase('Linking deployed components');
      this.logger?.info(`Linking completed in ${Date.now() - finalizeStart}ms`);
      context.recordPhaseTime('finalize', Date.now() - finalizeStart);
    } catch (error) {
      this.logger?.error(`Linking failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (this.logger && err.response !== undefined) {
        this.logger.debug(`Linking error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      if (this.logger && error instanceof Error && error.stack) {
        this.logger.debug(`Linking error stack: ${error.stack}`);
      }
      this.logger?.debug(`Linking failed in ${Date.now() - finalizeStart}ms`);
      this.deployStages?.failPhase('Linking deployed components', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new DeployError(message, 'FinalizationFailed');
    }
  }

  /**
   * Phase 5: Handle rollback when deployment fails.
   */
  private async handleRollback(context: DeploymentContext, error: Error): Promise<DeploymentContext> {
    this.logger?.info(`Starting rollback (scenario: ${context.rollback.scenario ?? 'unknown'})`);
    this.logger?.debug(`Deployment failed: ${error.message}`);

    if (!context.rollback.needed || !context.targetServiceProcessId) {
      return context;
    }

    // Mark rollback as attempted
    let currentContext = DeploymentContextUpdater.update(context, {
      rollback: { ...context.rollback, attempted: true },
    });

    // Clear deploy tree so "Service Process Created" is not shown when command's catch calls deployStages.stop()
    this.deployStages?.clearTreeStructure();

    // Print header first so it appears before the MSO stage and any step logs
    if (this.command && !this.command.jsonEnabled()) {
      this.command.log(ROLLBACK_SECTION_HEADER);
    }

    const rollbackStages = new RollbackStages(this.command!, currentContext.rollback.scenario!);
    rollbackStages.start();

    const rollbackStartTime = Date.now();
    let rollbackFailed = false;

    try {
      const rollbackData: RollbackData = {
        targetServiceProcessId: currentContext.targetServiceProcessId!,
        deployedFlows: currentContext.deployedFlows,
        deployedFlowNames: currentContext.deployedFlowNames,
      };

      const onProgress = (step: string, status: 'start' | 'complete'): void => {
        if (status === 'start') {
          rollbackStages.gotoStage(step);
        } else {
          rollbackStages.succeedStage(step);
        }
      };

      await this.performRollback(
        currentContext.connection,
        currentContext.rollback.scenario!,
        rollbackData,
        this.logger,
        onProgress
      );

      const duration = Date.now() - rollbackStartTime;
      rollbackStages.finish(duration);
      currentContext = DeploymentContextUpdater.update(currentContext, {
        rollback: { ...currentContext.rollback, succeeded: true },
      });
    } catch (rollbackError) {
      rollbackFailed = true;
      currentContext = DeploymentContextUpdater.update(currentContext, {
        rollback: { ...currentContext.rollback, succeeded: false },
      });
      this.logger?.error(`Rollback step failed: ${(rollbackError as Error).message}`);
      const err = rollbackError as Error & { response?: unknown };
      if (this.logger && err.response !== undefined) {
        this.logger.debug(`Rollback error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      if (this.logger && rollbackError instanceof Error && rollbackError.stack) {
        this.logger.debug(`Rollback error stack: ${rollbackError.stack}`);
      }
      rollbackStages.fail(rollbackError as Error);
      // Don't re-throw: original error is more important
    }

    if (this.command && !this.command.jsonEnabled()) {
      // Manual cleanup when rollback failed (shown once after rollback section)
      if (rollbackFailed) {
        this.command.log('Manual cleanup in the target org is required. Delete the following artifacts:\n');
        this.command.log(`  Service Process (Product2): ${currentContext.targetServiceProcessId ?? 'unknown'}`);
        if (currentContext.deployedFlows && currentContext.deployedFlows.length > 0) {
          this.command.log('  Deployed flows (InteractionDefinitionVersion / Flow):');
          for (const f of currentContext.deployedFlows) {
            this.command.log(`    - ${f.fullName} (ID: ${f.id ?? 'unknown'})`);
          }
        }
        this.command.log('');
      }
    }

    await this.logRollbackTelemetry(currentContext, error.message, rollbackStartTime);

    return currentContext;
  }

  private async logRollbackTelemetry(
    context: DeploymentContext,
    errorTrigger: string,
    rollbackStartTime: number
  ): Promise<void> {
    await publishLifecycleMetric(this.logger, 'spRollbackLatency', {
      runId: this.runId,
      deletedSpId: context.targetServiceProcessId ?? null,
      deletedFlowIds: (context.deployedFlows ?? []).map((f) => f.id),
      errorTrigger,
      rollbackDurationMs: Date.now() - rollbackStartTime,
      rollbackSucceeded: context.rollback.succeeded ?? false,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private async performRollback(
    connection: Connection,
    scenario: RollbackScenario,
    rollbackData: RollbackData,
    logger?: Logger,
    onProgress?: (step: string, status: 'start' | 'complete') => void
  ): Promise<void> {
    if (scenario === RollbackScenario.ServiceProcessOnly) {
      await RollbackService.rollbackServiceProcessOnly(
        connection,
        rollbackData.targetServiceProcessId,
        logger,
        onProgress
      );
    } else if (scenario === RollbackScenario.ServiceProcessAndFlows) {
      await RollbackService.rollbackServiceProcessAndFlows(connection, rollbackData, logger, onProgress);
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
  linkIntake?: boolean;
  linkFulfillment?: boolean;
  dependencies?: DeployServiceProcessDependencies;
}): Promise<DeployServiceProcessResult> {
  const service = new DeployService({
    org: options.org,
    expectedApiVersion: options.expectedApiVersion,
    logger: options.logger,
    linkIntake: options.linkIntake,
    linkFulfillment: options.linkFulfillment,
    dependencies: options.dependencies,
  });
  return service.deploy(options.inputZip);
}
