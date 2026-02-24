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
import { Org } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';

type LogJsonFn = (data: unknown) => void;

export type DeployFlowsOptions = {
  /** When true, validates deployment without committing (dry run). Default false. */
  checkOnly?: boolean;
  logJson?: LogJsonFn;
};

/** Deployed flow id and name, from deploy result when checkOnly is false. definitionId from Tooling API when enriched. */
export type DeployedFlowInfo = {
  id: string;
  fullName: string;
  /** Flow definition Id from Tooling API FlowDefinition (when queried after deploy). */
  definitionId?: string;
};

type ComponentSuccess = { componentType?: string; fullName?: string; id?: string };

/**
 * Extract flow id and fullName from deploy result details (only when checkOnly was false).
 */
function getDeployedFlowInfos(response: { details?: { componentSuccesses?: ComponentSuccess[] } }): DeployedFlowInfo[] {
  const successes = response.details?.componentSuccesses;
  if (!Array.isArray(successes)) return [];
  return successes
    .filter(
      (c): c is ComponentSuccess & { id: string; fullName: string } =>
        c.componentType === 'Flow' && typeof c.id === 'string' && typeof c.fullName === 'string'
    )
    .map((c) => ({ id: c.id, fullName: c.fullName }));
}

/**
 * Deploy multiple flow source files in a single SDR deployment.
 * filePaths should be absolute paths to *.flow-meta.xml files.
 * Use checkOnly: true to validate deployment without committing (e.g. to surface failures before actual deploy).
 * When checkOnly is false and deployment succeeds, returns deployed flow ids and names; otherwise returns [].
 */
export async function deployFlows(
  targetOrg: Org,
  filePaths: string[],
  options?: DeployFlowsOptions | LogJsonFn
): Promise<DeployedFlowInfo[]> {
  const opts: DeployFlowsOptions =
    options === undefined ? {} : typeof options === 'function' ? { logJson: options } : options;
  const { checkOnly = false, logJson } = opts;

  if (filePaths.length === 0) {
    const msg = 'No flow files provided for deployment.';
    throw new Error(msg);
  }

  const missing = filePaths.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    const msg = `Flow files not found:\n${missing.join('\n')}`;
    throw new Error(msg);
  }

  const componentSet = ComponentSet.fromSource(filePaths);

  const deploy = await componentSet.deploy({
    usernameOrConnection: targetOrg.getConnection(),
    apiOptions: {
      checkOnly,
      rollbackOnError: true,
      singlePackage: true,
    },
  });

  const result = await deploy.pollStatus();

  // Only log JSON if logJson callback is provided (verbose mode)
  if (logJson) {
    logJson(result.response);
  }

  const status = result.response.status as string;
  if (status !== 'Succeeded') {
    const msg = `Flow deployment failed: ${result.response.errorMessage ?? 'Unknown error'}`;
    throw new Error(msg);
  }

  if (checkOnly) return [];
  return getDeployedFlowInfos(result.response as { details?: { componentSuccesses?: ComponentSuccess[] } });
}

export async function deployflow(
  targetOrg: Org,
  flowName: string,
  inputDir: string,
  options?: DeployFlowsOptions | LogJsonFn
): Promise<DeployedFlowInfo[]> {
  const flowFile = path.resolve(inputDir, `main/default/flows/${flowName}.flow-meta.xml`);
  if (!fs.existsSync(flowFile)) {
    const msg = `Flow file not found at ${flowFile}. Ensure the flow exists under ${inputDir}/main/default/flows/.`;
    throw new Error(msg);
  }
  return deployFlows(targetOrg, [flowFile], options);
}
