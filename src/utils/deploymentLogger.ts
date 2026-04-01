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

import { StandardColors, type SfCommand } from '@salesforce/sf-plugins-core';
import { ValidationError } from '../errors.js';
import { formatValidationError } from './errorFormatter.js';

/**
 * Details for a phase completion
 */
export type PhaseDetails = {
  items?: Array<{ label: string; value: string; condition?: boolean }>;
  verbose?: Record<string, string>;
};

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
 * Deployment logger that wraps SfCommand's native spinner and logging.
 * Provides spinner-based UI for deployment phases with conditional display and verbose mode support.
 */
export class DeploymentLogger {
  private command: SfCommand<unknown>;
  private verbose: boolean;
  private phaseStartTimes: Map<string, number>;

  public constructor(command: SfCommand<unknown>, verbose: boolean) {
    this.command = command;
    this.verbose = verbose;
    this.phaseStartTimes = new Map();
  }

  /**
   * Check if verbose mode is enabled
   */
  public isVerbose(): boolean {
    return this.verbose;
  }

  /**
   * Log header for deployment with optional org info
   */
  public logHeader(title: string, orgUrl?: string): void {
    if (!this.shouldLog()) return;
    this.command.log('');
    this.command.log(title);
    this.command.log('');

    if (orgUrl) {
      this.command.log(`Org Connected: ${orgUrl}`);
      this.command.log('');
    }
  }

  /**
   * Start a deployment phase with spinner
   */
  public startPhase(message: string): void {
    if (!this.shouldLog()) return;
    this.phaseStartTimes.set(message, Date.now());
    // Start native spinner (shows spinner on left, message on right)
    this.command.spinner.start(message);
  }

  /**
   * Mark phase as succeeded and show details
   */
  public succeedPhase(message: string, details?: PhaseDetails): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(message);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration > 0 ? ` (${this.formatDuration(duration)}s)` : '';

    // Stop spinner and replace with success message
    this.command.spinner.stop(`${StandardColors.success('✓')} ${message}${durationStr}`);
    this.phaseStartTimes.delete(message);

    // Log items (always shown if provided and condition is true)
    if (details?.items) {
      for (const item of details.items) {
        this.logItem(item.label, item.value, item.condition);
      }
    }

    // Log verbose details (only in verbose mode)
    if (this.verbose && details?.verbose) {
      for (const [key, value] of Object.entries(details.verbose)) {
        this.command.log(`  ${key}: ${value}`);
      }
    }

    this.command.log('');
  }

  /**
   * Mark phase as failed
   */
  public failPhase(message: string, error: Error): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(message);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration > 0 ? ` (${this.formatDuration(duration)}s)` : '';

    // Stop spinner and replace with failure message
    this.command.spinner.stop(`${StandardColors.error('✗')} ${message}${durationStr}`);
    this.phaseStartTimes.delete(message);

    // Use formatter for ValidationError, fallback for others
    if (error instanceof ValidationError && error.failures) {
      const formattedLines = formatValidationError(error, this.verbose);
      formattedLines.forEach((line) => this.command.log(line));
    } else {
      // Fallback to old behavior for non-validation errors
      const errorMessage = error.message;
      this.command.log(`  ERROR: ${errorMessage}`);

      if (this.verbose && error.name && error.name !== 'Error') {
        this.command.log(`  (${error.name})`);
      }

      this.command.log('');
    }
  }

  /**
   * Log a single item (bullet point)
   */
  public logItem(label: string, value: string, condition: boolean = true): void {
    if (!this.shouldLog() || !condition) return;

    if (value) {
      this.command.log(`  * ${label}: ${value}`);
    } else {
      this.command.log(`  * ${label}`);
    }
  }

  /**
   * Log multiple items with optional nesting
   */
  public logItems(label: string, values: string[], condition: boolean = true): void {
    if (!this.shouldLog() || !condition || values.length === 0) return;

    if (values.length === 1) {
      this.command.log(`  * ${label}: ${values[0]}`);
    } else {
      this.command.log(`  * ${label} (${values.length}):`);
      for (const value of values) {
        this.command.log(`    - ${value}`);
      }
    }
  }

  /**
   * Log tree structure with box-drawing characters
   * Shows "Name: {name}" followed by tree items with ├─ and └─ connectors
   */
  public logTreeStructure(name: string, items: TreeItem[]): void {
    if (!this.shouldLog() || items.length === 0) return;

    // First line: Name
    this.command.log(`    Name: ${name}`);

    // Tree items with connectors
    items.forEach((item, index) => {
      const isLast = index === items.length - 1;
      const connector = isLast ? '└─' : '├─';

      this.command.log(`    ${connector} ${item.label} : ${item.value}`);
    });

    this.command.log('');
  }

  /**
   * Log success message
   */
  public logSuccess(message: string): void {
    if (!this.shouldLog()) return;
    this.command.log(`${StandardColors.success('✓')} ${message}`);
    this.command.log('');
  }

  /**
   * Log deployment summary with aligned labels and status
   */
  public logSummary(summary: DeploymentSummary): void {
    if (!this.shouldLog()) return;

    this.command.log('Summary');

    // Calculate padding for alignment
    const labels = ['Status', 'Service Process', 'Record ID', 'Components', 'Total Time'];
    const maxLabelLength = Math.max(...labels.map((l) => l.length));

    // Status (colorized)
    const statusPadded = 'Status'.padEnd(maxLabelLength);
    const statusText =
      summary.status === 'SUCCESS' ? StandardColors.success(summary.status) : StandardColors.error(summary.status);
    this.command.log(`  ${statusPadded} : ${statusText}`);

    // Service Process (just name)
    const spPadded = 'Service Process'.padEnd(maxLabelLength);
    this.command.log(`  ${spPadded} : ${summary.serviceProcessName}`);

    // Record ID with [copy] hint
    const idPadded = 'Record ID'.padEnd(maxLabelLength);
    this.command.log(`  ${idPadded} : ${summary.serviceProcessId}   [copy]`);

    // Components (total count)
    const totalComponents = summary.deployedCount + summary.linkedCount;
    if (totalComponents > 0) {
      const compPadded = 'Components'.padEnd(maxLabelLength);
      const componentText = totalComponents === 1 ? '1 linked' : `${totalComponents} linked`;
      this.command.log(`  ${compPadded} : ${componentText}`);
    }

    // Total Time
    const timePadded = 'Total Time'.padEnd(maxLabelLength);
    const duration = this.formatDuration(summary.duration);
    this.command.log(`  ${timePadded} : ${duration}s`);

    this.command.log('');
  }

  /**
   * Log verbose detail inline
   */
  public logVerbose(key: string, value: string): void {
    if (!this.shouldLog() || !this.verbose) return;
    this.command.log(`  ${key}: ${value}`);
  }

  /**
   * Check if output should be displayed (false in JSON mode)
   */
  private shouldLog(): boolean {
    return !this.command.jsonEnabled();
  }

  /**
   * Format duration in seconds
   */
  // eslint-disable-next-line class-methods-use-this
  private formatDuration(ms: number): string {
    return (ms / 1000).toFixed(1);
  }
}
