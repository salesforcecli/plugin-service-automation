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

import type { Org, Logger } from '@salesforce/core';
import type { DeployedFlowInfo } from '../utils/flow/deployflow.js';
import type { DeploymentMetadata } from '../workspace/deploymentMetadata.js';
import type { TemplateDataExtract } from '../workspace/templateData.js';
import type { DeployedFlowNames } from '../workspace/serviceProcessTransformer.js';
import { RollbackScenario } from './rollback.js';

/**
 * Context object that holds all state and configuration for a deployment operation.
 * Consolidates the multiple state variables used during deployment into a single, cohesive object.
 */
export type DeploymentContext = {
  // Core deployment inputs
  readonly workspace: string;
  readonly inputZip: string;
  readonly org: Org;

  // Deployment metadata and configuration
  readonly deploymentMetadata: DeploymentMetadata;
  readonly templateDataExtract: TemplateDataExtract;
  readonly filePaths: string[];

  // Computed flags that determine what needs to be deployed
  readonly needsDeployment: boolean;
  readonly needsIntakeDeployment: boolean;
  readonly needsFulfillmentDeployment: boolean;

  // Deployment state (populated as deployment progresses)
  targetServiceProcessId?: string;
  deployedFlows?: DeployedFlowInfo[];
  deployedFlowNames?: DeployedFlowNames;
  contentDocumentId?: string;

  // Rollback tracking
  rollback: {
    needed: boolean;
    scenario?: RollbackScenario;
  };

  // Cleanup functions
  cleanupWorkspace: () => void;
  cleanupWorkspaceZip?: () => void;

  // Logging (optional @salesforce/core Logger for diagnostic output)
  logger?: Logger;

  // Timing
  startTime: number;
  phaseTimings: Map<string, number>;

  /**
   * Record phase execution time
   */
  recordPhaseTime(phase: string, durationMs: number): void;

  /**
   * Cleanup all resources (workspace and zip)
   */
  cleanup(): void;
};

/**
 * Factory function to create a DeploymentContext with default values
 */
export function createDeploymentContext(options: {
  workspace: string;
  inputZip: string;
  org: Org;
  deploymentMetadata: DeploymentMetadata;
  templateDataExtract: TemplateDataExtract;
  filePaths: string[];
  needsDeployment: boolean;
  needsIntakeDeployment: boolean;
  needsFulfillmentDeployment: boolean;
  cleanupWorkspace: () => void;
  logger?: Logger;
}): DeploymentContext {
  const context: DeploymentContext = {
    workspace: options.workspace,
    inputZip: options.inputZip,
    org: options.org,
    deploymentMetadata: options.deploymentMetadata,
    templateDataExtract: options.templateDataExtract,
    filePaths: options.filePaths,
    needsDeployment: options.needsDeployment,
    needsIntakeDeployment: options.needsIntakeDeployment,
    needsFulfillmentDeployment: options.needsFulfillmentDeployment,
    rollback: {
      needed: false,
    },
    cleanupWorkspace: options.cleanupWorkspace,
    startTime: Date.now(),
    phaseTimings: new Map(),
    recordPhaseTime(phase: string, durationMs: number) {
      this.phaseTimings.set(phase, durationMs);
    },
    cleanup() {
      this.cleanupWorkspaceZip?.();
      this.cleanupWorkspace();
    },
    logger: options.logger,
  };

  return context;
}
