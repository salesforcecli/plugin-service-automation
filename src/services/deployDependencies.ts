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

import type { Connection, Org } from '@salesforce/core';
import { CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX } from '../constants.js';
import { postConnect } from '../utils/api/connectApi.js';
import { createContentDocumentFromFile } from '../utils/api/contentDocument.js';
import { deployFlows, type DeployedFlowInfo } from '../utils/flow/deployflow.js';
import { FlowTransformer, type FlowTransformerResult } from '../workspace/flowTransformer.js';
import { ServiceProcessTransformer, type DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import type { LogJsonFn, Logger } from '../validation/types.js';

/** Injected dependencies for testing; defaults to real implementations when not provided. */
export type DeployServiceProcessDependencies = {
  serviceProcessTransform?: (workspacePath: string) => DeployedFlowNames;
  flowTransformer?: (
    flowFilePath: string,
    targetServiceProcessId: string,
    serviceProcessName?: string,
    logger?: Logger
  ) => FlowTransformerResult | Promise<FlowTransformerResult>;
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

export const defaults = {
  serviceProcessTransform: (workspacePath: string): DeployedFlowNames =>
    ServiceProcessTransformer.transform(workspacePath),
  flowTransformer: (
    flowFilePath: string,
    targetServiceProcessId: string,
    serviceProcessName?: string,
    logger?: Logger
  ): FlowTransformerResult | Promise<FlowTransformerResult> =>
    FlowTransformer.transformIntakeFormFlow(flowFilePath, targetServiceProcessId, serviceProcessName, logger),
  uploadZip: async (conn: Connection, zipPath: string): Promise<{ contentDocumentId: string }> => {
    const r = await createContentDocumentFromFile(conn, zipPath);
    return { contentDocumentId: r.contentDocumentId };
  },
  callTemplateDeploy: async (
    conn: Connection,
    contentDocumentId: string
  ): Promise<{ deploymentResult?: string; status?: string; templateId?: string }> => {
    const deployPath = `${CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX}/${contentDocumentId}`;
    return postConnect<{ deploymentResult?: string; status?: string; templateId?: string }>(conn, deployPath, {});
  },
  deployFlowsFn: (
    org: Org,
    filePaths: string[],
    options: { checkOnly: boolean; logJson?: LogJsonFn }
  ): Promise<DeployedFlowInfo[]> => deployFlows(org, filePaths, options),
};
