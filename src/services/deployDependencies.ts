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

import type { Connection, Org, Logger } from '@salesforce/core';
import { CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX } from '../constants.js';
import { postConnect } from '../utils/api/connectApi.js';
import { createContentDocumentFromFile } from '../utils/api/contentDocument.js';
import { deployFlows, type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { FlowTransformer, type FlowTransformerResult } from '../workspace/flowTransformer.js';
import { ServiceProcessTransformer, type DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import type { DeploymentMetadata } from '../workspace/deploymentMetadata.js';

/** Injected dependencies for testing; defaults to real implementations when not provided. */
export type DeployServiceProcessDependencies = {
  serviceProcessTransform?: (
    workspacePath: string,
    deploymentMetadata?: DeploymentMetadata,
    targetOrgNamespace?: string | null
  ) => DeployedFlowNames;
  flowTransformer?: (
    flowFilePath: string,
    targetServiceProcessId: string,
    logger?: Logger
  ) => FlowTransformerResult | Promise<FlowTransformerResult>;
  uploadZip?: (conn: Connection, zipPath: string) => Promise<{ contentDocumentId: string }>;
  callTemplateDeploy?: (
    conn: Connection,
    contentDocumentId: string,
    body?: Record<string, unknown>
  ) => Promise<{ deploymentResult?: string; status?: string; templateId?: string }>;
  deployFlowsFn?: (
    orgOrConnection: Org | Connection,
    filePaths: string[],
    options: { checkOnly: boolean; logger?: Logger; apiVersion?: string }
  ) => Promise<DeployedFlowInfo[]>;
};

export const defaults = {
  serviceProcessTransform: (
    workspacePath: string,
    deploymentMetadata?: DeploymentMetadata,
    targetOrgNamespace?: string | null
  ): DeployedFlowNames => ServiceProcessTransformer.transform(workspacePath, deploymentMetadata, targetOrgNamespace),
  flowTransformer: (
    flowFilePath: string,
    targetServiceProcessId: string,
    logger?: Logger
  ): FlowTransformerResult | Promise<FlowTransformerResult> =>
    FlowTransformer.transformIntakeFormFlow(flowFilePath, targetServiceProcessId, logger),
  uploadZip: async (conn: Connection, zipPath: string): Promise<{ contentDocumentId: string }> => {
    const r = await createContentDocumentFromFile(conn, zipPath);
    return { contentDocumentId: r.contentDocumentId };
  },
  callTemplateDeploy: async (
    conn: Connection,
    contentDocumentId: string,
    body?: Record<string, unknown>
  ): Promise<{ deploymentResult?: string; status?: string; templateId?: string }> => {
    const deployPath = `${CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX}/${contentDocumentId}`;
    return postConnect<{ deploymentResult?: string; status?: string; templateId?: string }>(
      conn,
      deployPath,
      body ?? {}
    );
  },
  deployFlowsFn: (
    orgOrConnection: Org | Connection,
    filePaths: string[],
    options: { checkOnly: boolean; logger?: Logger; apiVersion?: string }
  ): Promise<DeployedFlowInfo[]> => deployFlows(orgOrConnection, filePaths, options),
};
