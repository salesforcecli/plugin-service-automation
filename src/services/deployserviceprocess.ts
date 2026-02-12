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
import { buildCatalogItemPath, CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX } from '../constants.js';
import { TemplateDataError } from '../errors.js';
import { patchConnect, postConnect } from '../utils/api/connectApi.js';
import { ContentDocumentUtil } from '../utils/api/contentDocument.js';
import { deployFlows, type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { getFlowDefinitionIds } from '../utils/flow/flowTooling.js';
import { createZipFromWorkspace, extractZipToWorkspace } from '../workspace/deployWorkspace.js';
import { resolveFlowFilePath } from '../workspace/flowPath.js';
import { FlowTransformer, type FlowTransformerResult } from '../workspace/flowTransformer.js';
import { deriveFlowsAndTemplateData } from '../workspace/templateData.js';
import { ServiceProcessTransformer, type DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import { runValidationsOrThrow, builtInValidators } from '../validation/index.js';
import type { LogJsonFn, Logger, ValidationContext } from '../validation/types.js';

export type { DeployedFlowNames, FlowNameTracking } from '../workspace/serviceProcessTransformer.js';

export type DeployServiceProcessResult = {
  contentDocumentId?: string;
  deployedFlowNames?: DeployedFlowNames;
  /** Deployed flow ids and names (only when deployment was not checkOnly). */
  deployedFlows?: DeployedFlowInfo[];
};

/** Injected dependencies for testing; defaults to real implementations. */
export type DeployServiceProcessDeps = {
  serviceProcessTransform?: (workspacePath: string) => DeployedFlowNames;
  flowTransformer?: (
    flowFilePath: string,
    targetServiceProcessId: string,
    serviceProcessName?: string,
    logger?: Logger
  ) => FlowTransformerResult;
  uploadZip?: (conn: Connection, zipPath: string) => Promise<{ contentDocumentId: string }>;
  callTemplateDeploy?: (
    conn: Connection,
    contentDocumentId: string
  ) => Promise<{ deploymentResult?: string; status?: string; templateId?: string }>;
  deployFlowsFn?: (
    org: Org,
    filePaths: string[],
    options: { checkOnly: boolean; logJson?: LogJsonFn }
  ) => Promise<DeployedFlowInfo[]>;
};

/** Build catalog item PATCH body with intakeFormId and fulfillmentFlowId from deployed flow definition ids. */
function buildCatalogItemPatchBody(
  intakeFormDefinitionId: string | undefined,
  fulfillmentFlowDefinitionId: string | undefined
): Record<string, unknown> {
  return {
    agentAction: {},
    associatedArticles: [],
    sections: [],
    eligibilityRules: [],
    fulfillmentFlow:
      fulfillmentFlowDefinitionId != null
        ? { fulfillmentFlowId: fulfillmentFlowDefinitionId, type: 'Flow', operationType: 'Create' }
        : {},
    intakeForm:
      intakeFormDefinitionId != null
        ? { operationType: 'Create', intakeFormId: intakeFormDefinitionId, type: 'Flow' }
        : {},
    integrations: [],
    isActive: false,
    name: '',
    preProcessors: [],
    productRequests: [],
    targetObject: 'Case',
    usedFor: 'ServiceProcess',
  };
}

/**
 * Patch the service-automation catalog item with deployed flow definition ids for intake and fulfillment.
 */
async function patchCatalogItemWithFlowIds(
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

  const catalogItemBody = buildCatalogItemPatchBody(intakeFormDefinitionId, fulfillmentFlowDefinitionId);
  const catalogItemPath = buildCatalogItemPath(targetServiceProcessId);

  logger?.log?.(`Patching catalog item: ${catalogItemPath}`);
  logger?.log?.('Request body:');
  logger?.logJson?.(catalogItemBody);
  const patchResponse = await patchConnect(conn, catalogItemPath, catalogItemBody);
  logger?.log?.('Patch response:');
  logger?.logJson?.(patchResponse);
  logger?.log?.('Catalog item patched successfully.');
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
  deps?: DeployServiceProcessDeps;
}): Promise<DeployServiceProcessResult> {
  const { org, inputZip, logger, deps = {} } = options;
  const logJson = options.logJson ?? logger?.logJson;

  logger?.log?.(`inputZip (resolved): ${path.resolve(inputZip)}`);

  const { workspace, cleanup } = await extractZipToWorkspace(inputZip);
  let workspaceZipCleanup: (() => void) | undefined;

  const serviceProcessTransformFn =
    deps.serviceProcessTransform ??
    ((workspacePath: string): DeployedFlowNames => ServiceProcessTransformer.transform(workspacePath));
  const flowTransformFn =
    deps.flowTransformer ??
    ((
      flowFilePath: string,
      targetServiceProcessId: string,
      serviceProcessName?: string,
      loggerArg?: Logger
    ): FlowTransformerResult =>
      FlowTransformer.transformIntakeFormFlow(flowFilePath, targetServiceProcessId, serviceProcessName, loggerArg));
  const uploadZipFn =
    deps.uploadZip ??
    (async (conn: Connection, zipPath: string): Promise<{ contentDocumentId: string }> => {
      const r = await ContentDocumentUtil.createFromFile(conn, zipPath);
      return { contentDocumentId: r.contentDocumentId };
    });
  const callTemplateDeployFn =
    deps.callTemplateDeploy ??
    (async (
      conn: Connection,
      contentDocumentId: string
    ): Promise<{ deploymentResult?: string; status?: string; templateId?: string }> => {
      const deployPath = `${CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX}/${contentDocumentId}`;
      return postConnect<{
        deploymentResult?: string;
        status?: string;
        templateId?: string;
      }>(conn, deployPath, {});
    });
  const deployFlowsFn = deps.deployFlowsFn ?? deployFlows;

  try {
    const { filePaths, templateDataExtract } = deriveFlowsAndTemplateData(workspace);
    if (filePaths.length === 0) {
      const dirContents = fs.readdirSync(workspace);
      throw new TemplateDataError(
        'No flow files found in the zip. The zip should contain templateData.json and flow files (.flow-meta.xml or .xml). ' +
          `Resolved path: ${workspace}. Directory contents: ${
            dirContents.length > 0 ? dirContents.join(', ') : '(empty)'
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

    const deployedFlowNames = serviceProcessTransformFn(workspace);

    const { zipPath: workspaceZipPath, cleanup: cleanupWorkspaceZip } = await createZipFromWorkspace(workspace);
    workspaceZipCleanup = cleanupWorkspaceZip;

    const conn = org.getConnection();
    const uploadResult = await uploadZipFn(conn, workspaceZipPath);
    const contentDocumentId = uploadResult.contentDocumentId;
    logger?.log?.(`Content Document ID: ${contentDocumentId}`);

    const templateDeployResponse = await callTemplateDeployFn(conn, contentDocumentId);
    logger?.logJson?.(templateDeployResponse);

    const targetServiceProcessId = templateDeployResponse?.deploymentResult;
    logger?.log?.(
      `[deployServiceProcess] Before flow transformer: targetServiceProcessId=${String(
        targetServiceProcessId
      )}, intakeForm=${deployedFlowNames?.intakeForm != null ? 'set' : 'none'}`
    );
    if (targetServiceProcessId && deployedFlowNames?.intakeForm) {
      const intakeFormFlowPath = resolveFlowFilePath(workspace, deployedFlowNames.intakeForm.originalName);
      logger?.log?.(
        `[deployServiceProcess] Calling FlowTransformer.transformIntakeFormFlow: ${intakeFormFlowPath} ${targetServiceProcessId}`
      );
      const transformResult = flowTransformFn(
        intakeFormFlowPath,
        targetServiceProcessId,
        templateDataExtract.name,
        logger
      );
      if (transformResult.modified) {
        logger?.log?.(`Flow transformer: ${transformResult.message}`);
      }
    } else {
      logger?.log?.(
        '[deployServiceProcess] Skipping flow transformer (no targetServiceProcessId or no intakeForm in deployedFlowNames)'
      );
    }

    const deployedFlows = await deployFlowsFn(org, filePaths, { checkOnly: false, logJson });

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
