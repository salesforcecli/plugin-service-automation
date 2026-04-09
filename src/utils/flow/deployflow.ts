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
import type { Org, Connection } from '@salesforce/core';
import type { Logger } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import { safeStringifyForLog } from '../safeStringify.js';

export type DeployFlowsOptions = {
  /** When true, validates deployment without committing (dry run). Default false. */
  checkOnly?: boolean;
  /** Optional logger for diagnostic output (e.g. deploy response at debug level). */
  logger?: Logger;
  /** Optional API version (e.g. from --api-version); when set, connection uses this version. */
  apiVersion?: string;
};

/** Deployed flow id and name, from deploy result when checkOnly is false. definitionId from Tooling API when enriched. */
export type DeployedFlowInfo = {
  id: string;
  fullName: string;
  /** Flow definition Id from Tooling API FlowDefinition (when queried after deploy). */
  definitionId?: string;
};

type ComponentFailure = { fullName?: string; problem?: string; problemType?: string };
type ComponentSuccess = { componentType?: string; fullName?: string; id?: string };
type DeployResponse = {
  status?: string;
  errorMessage?: string;
  details?: { componentFailures?: ComponentFailure[] };
};

/**
 * Build a user-facing error message from a failed deploy response.
 * Prefer component failure details (problem/fullName) over top-level errorMessage.
 */
function getDeployErrorMessage(response: DeployResponse): string {
  const failures = response.details?.componentFailures;
  if (Array.isArray(failures) && failures.length > 0) {
    return failures
      .map((f) => {
        const problem = f.problem?.trim() ?? 'Unknown error';
        return f.fullName ? `${f.fullName}: ${problem}` : problem;
      })
      .join('; ');
  }
  return response.errorMessage?.trim() ?? 'Unknown error';
}

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
 * Pass Connection to use a specific connection (e.g. with --api-version); pass Org to use org.getConnection(options.apiVersion).
 */
export async function deployFlows(
  targetOrgOrConnection: Org | Connection,
  filePaths: string[],
  options?: DeployFlowsOptions
): Promise<DeployedFlowInfo[]> {
  const opts = options ?? {};
  const { checkOnly = false, logger } = opts;

  if (filePaths.length === 0) {
    const msg = 'No flow files provided for deployment.';
    throw new Error(msg);
  }

  const missing = filePaths.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    const msg = `Flow files not found:\n${missing.join('\n')}`;
    throw new Error(msg);
  }

  const connection =
    typeof (targetOrgOrConnection as Org).getConnection === 'function'
      ? (targetOrgOrConnection as Org).getConnection(opts.apiVersion)
      : (targetOrgOrConnection as Connection);

  const componentSet = ComponentSet.fromSource(filePaths);

  if (logger) {
    logger.debug(`Flow deploy start: ${filePaths.length} flow file(s), checkOnly=${checkOnly}`);
  }
  const deployStart = Date.now();

  const deploy = await componentSet.deploy({
    usernameOrConnection: connection,
    apiOptions: {
      checkOnly,
      rollbackOnError: true,
      singlePackage: true,
    },
  });

  const result = await deploy.pollStatus();
  const duration = Date.now() - deployStart;

  if (logger) {
    logger.debug(`Flow deploy full response: ${safeStringifyForLog(result.response)}`);
    logger.debug(`Flow deploy completed in ${duration}ms`);
  }

  const status = result.response.status as string;
  if (status !== 'Succeeded') {
    if (logger) {
      logger.debug(`Flow deploy failed in ${duration}ms`);
      logger.debug(`Flow deploy failed full response: ${safeStringifyForLog(result.response)}`);
    }
    const message = getDeployErrorMessage(result.response as DeployResponse);
    throw new Error(`Flow deployment failed: ${message}`);
  }

  if (checkOnly) return [];
  return getDeployedFlowInfos(result.response as { details?: { componentSuccesses?: ComponentSuccess[] } });
}

export async function deployflow(
  targetOrg: Org,
  flowName: string,
  inputDir: string,
  options?: DeployFlowsOptions
): Promise<DeployedFlowInfo[]> {
  const flowFile = path.resolve(inputDir, `main/default/flows/${flowName}.flow-meta.xml`);
  if (!fs.existsSync(flowFile)) {
    const msg = `Flow file not found at ${flowFile}. Ensure the flow exists under ${inputDir}/main/default/flows/.`;
    throw new Error(msg);
  }
  return deployFlows(targetOrg, [flowFile], options);
}
