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
import type { Org } from '@salesforce/core';
import { METADATA_FLOWS_RELATIVE_PATH } from '../constants.js';
import { DeployError, TemplateDataError } from '../errors.js';
import { type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { getFlowDefinitionIds } from '../utils/flow/flowTooling.js';
import { createZipFromWorkspace, extractZipToWorkspace } from '../workspace/deployWorkspace.js';
import { FlowTransformer } from '../workspace/flowTransformer.js';
import { resolveFlowFilePath } from '../workspace/flowPath.js';
import { deriveFlowsAndTemplateData } from '../workspace/templateData.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import { runValidationsOrThrow, builtInValidators } from '../validation/index.js';
import type { LogJsonFn, Logger, ValidationContext } from '../validation/types.js';
import {
  resolveDeployDependencies,
  type DeployServiceProcessDependencies,
  type ResolvedDeployDependencies,
} from './deployDependencies.js';
import { patchCatalogItemWithFlowIds } from './catalogItemPatch.js';

export type { DeployedFlowNames, FlowNameTracking } from '../workspace/serviceProcessTransformer.js';
export type { DeployServiceProcessDependencies } from './deployDependencies.js';

export type DeployServiceProcessResult = {
  contentDocumentId?: string;
  deployedFlowNames?: DeployedFlowNames;
  /** Deployed flow ids and names (only when deployment was not checkOnly). */
  deployedFlows?: DeployedFlowInfo[];
};

function runIntakeFormFlowTransform(
  workspace: string,
  targetServiceProcessId: string | undefined,
  deployedFlowNames: DeployedFlowNames | undefined,
  templateDataExtract: { name?: string },
  flowTransformFn: ResolvedDeployDependencies['flowTransformFn'],
  logger?: Logger
): void {
  if (!targetServiceProcessId || !deployedFlowNames?.intakeForm) {
    logger?.log?.(
      '[deployServiceProcess] Skipping flow transformer (no targetServiceProcessId or no intakeForm in deployedFlowNames)'
    );
    return;
  }
  const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
  const intakeFormFlowPath = resolveFlowFilePath(flowDir, deployedFlowNames.intakeForm.originalName);
  logger?.log?.(
    `[deployServiceProcess] Calling FlowTransformer.transformIntakeFormFlow: ${intakeFormFlowPath} ${targetServiceProcessId}`
  );
  const transformResult = flowTransformFn(intakeFormFlowPath, targetServiceProcessId, templateDataExtract.name, logger);
  if (transformResult.modified) {
    logger?.log?.(`Flow transformer: ${transformResult.message}`);
  }
}

/**
 * Service to deploy a Service Process (Flow) to a target org.
 * Expects a .zip file: extracts it, validates, uploads template zip, calls template deploy API, transforms intake flow, deploys flows.
 */
export async function deployServiceProcess(options: {
  org: Org;
  inputZip: string;
  logger?: Logger;
  logJson?: LogJsonFn;
  dependencies?: DeployServiceProcessDependencies;
}): Promise<DeployServiceProcessResult> {
  const { org, inputZip, logger, dependencies = {} } = options;
  const logJson = options.logJson ?? logger?.logJson;
  const resolved = resolveDeployDependencies(dependencies);

  logger?.log?.(`inputZip (resolved): ${path.resolve(inputZip)}`);

  const { workspace, cleanup } = await extractZipToWorkspace(inputZip);
  let workspaceZipCleanup: (() => void) | undefined;

  try {
    const { filePaths, templateDataExtract } = deriveFlowsAndTemplateData(workspace);
    if (filePaths.length === 0) {
      const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
      const dirContents = fs.existsSync(flowDir) ? fs.readdirSync(flowDir) : [];
      throw new TemplateDataError(
        `No flow files found in the zip. Expected structure: <service-process-id>/templateData.json and <service-process-id>/${METADATA_FLOWS_RELATIVE_PATH}/*.flow-meta.xml (or .xml). ` +
          `Resolved workspace: ${workspace}. Flow directory contents: ${
            dirContents.length > 0 ? dirContents.join(', ') : '(missing or empty)'
          }`
      );
    }

    const { apexClassNames, customFields } = templateDataExtract;
    const validationContext: ValidationContext = {
      conn: org.getConnection(),
      org,
      flowFilePaths: filePaths,
      apexClassNames: apexClassNames.length > 0 ? apexClassNames : undefined,
      customFields: customFields.length > 0 ? customFields : undefined,
      logJson,
    };
    await runValidationsOrThrow(validationContext, builtInValidators);

    const deployedFlowNames = resolved.serviceProcessTransformFn(workspace);

    const { zipPath: workspaceZipPath, cleanup: cleanupWorkspaceZip } = await createZipFromWorkspace(workspace);
    workspaceZipCleanup = cleanupWorkspaceZip;

    const conn = org.getConnection();
    const uploadResult = await resolved.uploadZipFn(conn, workspaceZipPath);
    const contentDocumentId = uploadResult.contentDocumentId;
    logger?.log?.(`Content Document ID: ${contentDocumentId}`);

    const templateDeployResponse = await resolved.callTemplateDeployFn(conn, contentDocumentId);
    logger?.logJson?.(templateDeployResponse);

    if (templateDeployResponse?.status === 'FAILURE') {
      const message =
        typeof templateDeployResponse === 'object' && templateDeployResponse !== null
          ? `Template deploy failed: ${JSON.stringify(templateDeployResponse)}`
          : 'Template deploy failed.';
      throw new DeployError(message, 'TemplateDeployFailed');
    }

    const targetServiceProcessId = templateDeployResponse?.deploymentResult;
    logger?.log?.(
      `[deployServiceProcess] Before flow transformer: targetServiceProcessId=${String(
        targetServiceProcessId
      )}, intakeForm=${deployedFlowNames?.intakeForm != null ? 'set' : 'none'}`
    );
    runIntakeFormFlowTransform(
      workspace,
      targetServiceProcessId,
      deployedFlowNames,
      templateDataExtract,
      resolved.flowTransformFn,
      logger
    );

    if (deployedFlowNames?.fulfillmentFlow) {
      const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);
      const fulfillmentFlowPath = resolveFlowFilePath(flowDir, deployedFlowNames.fulfillmentFlow.originalName);
      const fulfillmentResult = FlowTransformer.transformFulfillmentFlow(fulfillmentFlowPath, logger);
      if (fulfillmentResult.modified) {
        logger?.log?.(`Flow transformer: ${fulfillmentResult.message}`);
      }
    }

    const deployedFlows = await resolved.deployFlowsFn(org, filePaths, { checkOnly: false, logJson });

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
      if (targetServiceProcessId) {
        await patchCatalogItemWithFlowIds(connection, targetServiceProcessId, deployedFlows, deployedFlowNames, logger);
      }
    }

    return { contentDocumentId, deployedFlowNames, deployedFlows };
  } finally {
    workspaceZipCleanup?.();
    cleanup();
  }
}
