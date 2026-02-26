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

import { MultiStageOutput } from '@oclif/multi-stage-output';
import type { SfCommand } from '@salesforce/sf-plugins-core';
import type { ValidationError } from '../errors.js';

type StageData = {
  duration?: string;
  items?: Array<{ label: string; value: string }>;
  error?: string;
  errorDetails?: string[];
};

type DeploymentPhase =
  | 'Preparing connection'
  | 'Validating deployment'
  | 'Creating Service Process'
  | 'Deploying metadata'
  | 'Linking deployed components'
  | 'Done';

/**
 * Item in a tree structure display
 */
export type TreeItem = {
  label: string;
  value: string;
};

/**
 * Summary of deployment results
 */
export type DeploymentSummary = {
  status: 'SUCCESS' | 'FAILED';
  serviceProcessName: string;
  serviceProcessId: string;
  deployedCount: number;
  linkedCount: number;
  duration: number;
};

/**
 * Wrapper for MultiStageOutput to display deployment phases with spinners and status indicators.
 * Provides left-side spinners (⠹) that get replaced by checkmarks (✔) or errors (✗).
 */
export class DeploymentStages {
  private static readonly GREEN = '\x1b[32m';
  private static readonly RED = '\x1b[31m';
  private static readonly RESET = '\x1b[0m';

  private mso: MultiStageOutput<StageData>;
  private command: SfCommand<unknown>;
  private phaseStartTimes: Map<string, number>;

  // Collect details to display after MSO stops
  private treeStructure?: { name: string; items: TreeItem[] };
  private validationItems?: Array<{ label: string; value: string }>;
  private validationSubstages: Map<string, { description: string; complete: boolean; success: boolean }> = new Map();
  private expectedValidatorCount = 0;
  private deployingMetadataItems?: Array<{ label: string; value: string }>;

  public constructor(command: SfCommand<unknown>, title: string, orgUrl: string) {
    this.command = command;
    this.phaseStartTimes = new Map();

    this.mso = new MultiStageOutput<StageData>({
      title,
      stages: [
        'Preparing connection',
        'Validating deployment',
        'Creating Service Process',
        'Deploying metadata',
        'Linking deployed components',
        'Done',
      ],
      jsonEnabled: command.jsonEnabled(),
      preStagesBlock: [
        {
          type: 'message',
          get: (): string => `Org Connected: ${orgUrl}`,
        },
      ],
      stageSpecificBlock: [
        {
          stage: 'Validating deployment',
          type: 'message',
          get: (): string | undefined => {
            if (!this.validationItems || this.validationItems.length === 0) return undefined;
            const lines = this.validationItems.map((item) =>
              item.label ? `  ${item.label}: ${item.value}` : `  ${item.value}`
            );
            return lines.join('\n');
          },
        },
        {
          stage: 'Deploying metadata',
          type: 'message',
          get: (): string | undefined => {
            if (!this.deployingMetadataItems || this.deployingMetadataItems.length === 0) return undefined;
            const lines = this.deployingMetadataItems.map((item) =>
              item.label ? `  ${item.label}: ${item.value}` : `  ${item.value}`
            );
            return lines.join('\n');
          },
        },
      ],
    });
  }

  public shouldLog(): boolean {
    return !this.command.jsonEnabled();
  }

  public start(): void {
    if (!this.shouldLog()) return;
    // Start with first stage
    this.mso.goto('Preparing connection');
  }

  public setValidatorCount(count: number): void {
    this.expectedValidatorCount = count;
  }

  public startPhase(phase: DeploymentPhase): void {
    if (!this.shouldLog()) return;
    this.phaseStartTimes.set(phase, Date.now());

    // Clear validation substages when starting validation phase
    if (phase === 'Validating deployment') {
      this.validationSubstages.clear();

      // Show initial validator count if we know it
      if (this.expectedValidatorCount > 0) {
        this.validationItems = [
          {
            label: '',
            value: `Validators: 0/${this.expectedValidatorCount} (0%)`,
          },
        ];
      } else {
        this.validationItems = undefined;
      }
    }

    this.mso.goto(phase);
  }

  public succeedPhase(phase: DeploymentPhase): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(phase);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration > 0 ? `${this.formatDuration(duration)}s` : undefined;

    this.phaseStartTimes.delete(phase);

    // For validation phase, progress count is already shown by completeValidatorSubstage
    // Don't clear substages - they contain the final count

    // Update with duration
    this.mso.updateData({ duration: durationStr });
  }

  public skipToPhase(phase: DeploymentPhase): void {
    if (!this.shouldLog()) return;

    // Skip to the target phase, automatically marking intermediate phases as skipped with circle indicator
    this.mso.skipTo(phase);
  }

  public failPhase(phase: DeploymentPhase, error: Error): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(phase);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration > 0 ? `${this.formatDuration(duration)}s` : undefined;

    this.phaseStartTimes.delete(phase);

    if (this.isValidationError(error) && error.failures) {
      // Keep substages visible - don't replace them with error items
      // The failed validators are already marked with ✘ via completeValidatorSubstage
      // Don't log validation details here; they are shown once in the thrown SfError message.
      this.mso.updateData({ duration: durationStr, error: '' });
      this.mso.error(); // This marks the stage as failed (✘) and stops MSO
    } else if (this.isTemplateDeployError(error)) {
      // Special handling for Service Process creation failures
      this.mso.updateData({ duration: durationStr, error: '' });
      this.mso.error();

      // Extract the JSON part from the error message
      const match = error.message.match(/Template deploy failed: (\{.*\})/);
      const jsonPart = match ? match[1] : null;

      this.command.log(`\n${DeploymentStages.RED}Service Process Creation Failed${DeploymentStages.RESET}`);

      if (jsonPart) {
        try {
          const errorData = JSON.parse(jsonPart) as { deploymentResult?: string; status?: string; templateId?: string };
          const details = this.decodeTemplateDeployMessage(errorData.deploymentResult ?? 'Unknown error');
          this.command.log(`   ${details}`);
        } catch {
          // If JSON parsing fails, just show the raw message
          this.command.log(`   ${error.message}`);
        }
      } else {
        this.command.log(`   ${error.message}`);
      }
    } else if (phase === 'Deploying metadata') {
      // Special handling for metadata deployment failures
      this.mso.updateData({ duration: durationStr, error: '' });
      this.mso.error();

      this.command.log(`\n${DeploymentStages.RED}ERROR: Flow Deployment Failed${DeploymentStages.RESET}`);

      // Extract clean error message
      const cleanMessage = this.extractErrorMessage(error);
      this.command.log(`   ${cleanMessage}`);
    } else if (phase === 'Linking deployed components') {
      // Special handling for finalization failures (catalog item patching)
      this.mso.updateData({ duration: durationStr, error: '' });
      this.mso.error();

      this.command.log(`\n${DeploymentStages.RED}Deployment Finalization Failed${DeploymentStages.RESET}`);

      // Extract clean error message
      const cleanMessage = this.extractErrorMessage(error);
      this.command.log(`   ${cleanMessage}`);
    } else {
      // For other non-validation errors, use MSO's error display
      this.mso.updateData({
        duration: durationStr,
        error: error.message,
      });
      this.mso.error();
    }
  }

  public startValidatorSubstage(name: string, description: string): void {
    if (!this.shouldLog()) return;
    // Track validators internally - don't update display since count is shown upfront
    this.validationSubstages.set(name, { description, complete: false, success: true });
  }

  public completeValidatorSubstage(name: string, success: boolean): void {
    if (!this.shouldLog()) return;
    const substage = this.validationSubstages.get(name);
    if (substage) {
      substage.complete = true;
      substage.success = success;

      // Update progress count using expected total
      const total = this.expectedValidatorCount;
      const completed = Array.from(this.validationSubstages.values()).filter((s) => s.complete).length;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      this.validationItems = [
        {
          label: '',
          value: `Validators: ${completed}/${total} (${percentage}%)`,
        },
      ];
      this.mso.updateData({});
    }
  }

  public setDeployingMetadataItems(flows: Array<{ label: string; value: string }>): void {
    if (!this.shouldLog()) return;
    this.deployingMetadataItems = flows;
    this.mso.updateData({});
  }

  public logTreeStructure(name: string, items: TreeItem[]): void {
    if (!this.shouldLog() || items.length === 0) return;

    // Store tree structure to display after MSO stops
    this.treeStructure = { name, items };
  }

  /** Clear stored tree so stop() does not show "Service Process Created" (e.g. on rollback/failure). */
  public clearTreeStructure(): void {
    this.treeStructure = undefined;
  }

  public logSummary(summary: DeploymentSummary): void {
    if (!this.shouldLog()) return;

    const labels = ['Status', 'Service Process', 'Record ID', 'Components', 'Total Time'];
    const maxLabelLength = Math.max(...labels.map((l) => l.length));

    const summaryLines: string[] = ['\nSummary'];

    // Status (colorized)
    const statusColor = summary.status === 'SUCCESS' ? DeploymentStages.GREEN : DeploymentStages.RED;
    const statusPadded = 'Status'.padEnd(maxLabelLength);
    summaryLines.push(`  ${statusPadded} : ${statusColor}${summary.status}${DeploymentStages.RESET}`);

    // Service Process (just name)
    const spPadded = 'Service Process'.padEnd(maxLabelLength);
    summaryLines.push(`  ${spPadded} : ${summary.serviceProcessName}`);

    // Record ID
    const idPadded = 'Record ID'.padEnd(maxLabelLength);
    summaryLines.push(`  ${idPadded} : ${summary.serviceProcessId}`);

    // Components (total count)
    const totalComponents = summary.deployedCount + summary.linkedCount;
    if (totalComponents > 0) {
      const compPadded = 'Components'.padEnd(maxLabelLength);
      const componentText = totalComponents === 1 ? '1 linked' : `${totalComponents} linked`;
      summaryLines.push(`  ${compPadded} : ${componentText}`);
    }

    // Total Time
    const timePadded = 'Total Time'.padEnd(maxLabelLength);
    const duration = this.formatDuration(summary.duration);
    summaryLines.push(`  ${timePadded} : ${duration}s`);

    this.command.log(summaryLines.join('\n'));
  }

  public stop(): void {
    if (!this.shouldLog()) return;
    this.mso.stop();

    // Display tree structure after MSO has rendered
    if (this.treeStructure) {
      this.command.log('\nService Process Created:');
      const treeLines = [`    Name: ${this.treeStructure.name}`];
      this.treeStructure.items.forEach((item, index) => {
        const isLast = index === this.treeStructure!.items.length - 1;
        const connector = isLast ? '└─' : '├─';
        treeLines.push(`    ${connector} ${item.label} : ${item.value}`);
      });
      this.command.log(treeLines.join('\n'));
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private formatDuration(milliseconds: number): string {
    return (milliseconds / 1000).toFixed(1);
  }

  // eslint-disable-next-line class-methods-use-this
  private isValidationError(error: Error): error is ValidationError {
    return error.name === 'ValidationError' && 'failures' in error;
  }

  // eslint-disable-next-line class-methods-use-this
  private isTemplateDeployError(error: Error): boolean {
    return 'code' in error && (error as { code: string }).code === 'TemplateDeployFailed';
  }

  /** Decode common HTML entities in template deploy API message for readable output. */
  // eslint-disable-next-line class-methods-use-this
  private decodeTemplateDeployMessage(text: string): string {
    const decoded = text
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    // Show only the exception message; strip "Deployment failed: " prefix if present
    return decoded.replace(/^Deployment failed:\s*/i, '');
  }

  /**
   * Extract clean error message from various error types
   */
  // eslint-disable-next-line class-methods-use-this
  private extractErrorMessage(error: Error): string {
    const message = error.message;

    // Handle "Flow deployment failed: <message>" pattern
    const flowDeployMatch = message.match(/^Flow deployment failed: (.+)$/);
    if (flowDeployMatch) {
      return flowDeployMatch[1];
    }

    // Handle generic Error messages from got/HTTP errors
    // Try to extract the most useful part
    if (message.includes('HTTPError:')) {
      // Extract just the status and body if available
      const httpMatch = message.match(/Response code (\d+) \(([^)]+)\)/);
      if (httpMatch) {
        return `HTTP ${httpMatch[1]}: ${httpMatch[2]}`;
      }
    }

    // Return the original message if no pattern matches
    return message;
  }
}
