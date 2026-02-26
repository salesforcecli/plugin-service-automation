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

import { ValidationError } from '../errors.js';
import type { ValidationResult } from '../validation/types.js';

/** Error categories for grouping validation failures */
enum ErrorCategory {
  DuplicateFlows = 'DUPLICATE_FLOWS',
  MissingDependencies = 'MISSING_DEPENDENCIES',
  FlowExistence = 'FLOW_EXISTENCE',
  ApiVersion = 'API_VERSION',
  FlowDeployment = 'FLOW_DEPLOYMENT',
  Other = 'OTHER',
}

type CategorizedFailures = Map<ErrorCategory, ValidationResult[]>;

/**
 * Get a descriptive header for validation errors based on failure categories
 *
 * @param error - ValidationError with failures array
 * @returns Descriptive header string
 */
export function getValidationErrorHeader(error: ValidationError): string {
  if (!error.failures || error.failures.length === 0) {
    return 'Validation failed';
  }

  const categorized = categorizeFailures(error.failures);
  const duplicateFlows = categorized.get(ErrorCategory.DuplicateFlows);
  const onlyDuplicateFlows = categorized.size === 1 && duplicateFlows && duplicateFlows.length > 0;

  if (onlyDuplicateFlows) {
    return 'Duplicate flows found in target org:';
  }

  // Check what types of errors we have
  const categories: string[] = [];
  if (duplicateFlows && duplicateFlows.length > 0) categories.push('duplicate flows');
  if (categorized.get(ErrorCategory.MissingDependencies)) categories.push('missing dependencies');
  if (categorized.get(ErrorCategory.FlowExistence)) categories.push('flow link failures');
  if (categorized.get(ErrorCategory.ApiVersion)) categories.push('API version issues');
  if (categorized.get(ErrorCategory.FlowDeployment)) categories.push('flow deployment errors');

  if (categories.length === 1) {
    return getCategoryHeader(categories[0]);
  }
  if (categories.length > 1) {
    return 'Validation issues:';
  }

  return 'Validation failed';
}

function getCategoryHeader(category: string): string {
  switch (category) {
    case 'duplicate flows':
      return 'Duplicate flows found in target org:';
    case 'missing dependencies':
      return 'Missing dependencies:';
    case 'flow link failures':
      return 'Flow link failures:';
    case 'API version issues':
      return 'API version issues:';
    case 'flow deployment errors':
      return 'Flow deployment errors:';
    default:
      return `${category}:`;
  }
}

// Helper functions to reduce complexity
function formatDuplicateFlows(failures: ValidationResult[]): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  for (const failure of failures) {
    const flowName = extractFlowName(failure.message ?? '');
    const label = getFlowLabel(failure.name);
    items.push({ label, value: flowName ? flowName : failure.message ?? 'unknown' });
  }
  return items;
}

function formatMissingDependencies(failures: ValidationResult[]): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  for (const failure of failures) {
    const name = failure.name.toLowerCase();
    if (name.includes('customfields')) {
      const fields = extractFieldNames(failure.message ?? '');
      const fieldsStr = fields.join(', ');
      items.push({ label: 'Custom Fields missing', value: fieldsStr ? fieldsStr : failure.message ?? 'unknown' });
    } else if (name.includes('apexclass')) {
      const classes = extractApexClasses(failure.message ?? '');
      const classesStr = classes.join(', ');
      items.push({ label: 'Apex Classes missing', value: classesStr ? classesStr : failure.message ?? 'unknown' });
    }
  }
  return items;
}

function formatCategoryFailures(
  failures: ValidationResult[],
  labelResolver: (name: string) => string
): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  for (const failure of failures) {
    const label = labelResolver(failure.name);
    items.push({ label, value: failure.message ?? failure.status });
  }
  return items;
}

/**
 * Convert validation errors to MSO items format for display under stage
 *
 * @param error - ValidationError with failures array
 * @returns Array of items with label and value for MSO display
 */
export function formatValidationErrorAsItems(error: ValidationError): Array<{ label: string; value: string }> {
  if (!error.failures || error.failures.length === 0) {
    return [{ label: 'Validation failed', value: error.message }];
  }

  const items: Array<{ label: string; value: string }> = [];
  const categorized = categorizeFailures(error.failures);

  // Process each error category
  const duplicateFlows = categorized.get(ErrorCategory.DuplicateFlows);
  if (duplicateFlows?.length) {
    items.push(...formatDuplicateFlows(duplicateFlows));
  }

  const missingDeps = categorized.get(ErrorCategory.MissingDependencies);
  if (missingDeps?.length) {
    items.push(...formatMissingDependencies(missingDeps));
  }

  const flowExistence = categorized.get(ErrorCategory.FlowExistence);
  if (flowExistence?.length) {
    items.push(...formatCategoryFailures(flowExistence, getFlowLabel));
  }

  const apiVersion = categorized.get(ErrorCategory.ApiVersion);
  if (apiVersion?.length) {
    items.push(...formatCategoryFailures(apiVersion, () => 'API Version'));
  }

  const flowDeployment = categorized.get(ErrorCategory.FlowDeployment);
  if (flowDeployment?.length) {
    items.push(...formatCategoryFailures(flowDeployment, () => 'Flow Deployment'));
  }

  const other = categorized.get(ErrorCategory.Other);
  if (other?.length) {
    items.push(...formatCategoryFailures(other, (name) => name));
  }

  return items;
}

/**
 * Format a ValidationError into human-friendly output lines
 *
 * @param error - ValidationError with optional failures array
 * @param verbose - Whether to include full validator details
 * @returns Array of formatted strings to display
 */
export function formatValidationError(error: ValidationError, verbose: boolean): string[] {
  const lines: string[] = [];
  lines.push(''); // Blank line after phase header

  if (!error.failures || error.failures.length === 0) {
    // Fallback: no structured data
    lines.push(error.message);
    lines.push('');
    lines.push('Deployment aborted.');
    if (!verbose) {
      lines.push('Run with SF_LOG_LEVEL=debug or DEBUG=sf:* for full validator trace.');
    }
    return lines;
  }

  // Categorize failures
  const categorized = categorizeFailures(error.failures);

  // Check if all failures are duplicate flows
  const duplicateFlows = categorized.get(ErrorCategory.DuplicateFlows);
  const onlyDuplicateFlows = categorized.size === 1 && duplicateFlows && duplicateFlows.length > 0;

  if (onlyDuplicateFlows) {
    lines.push('Duplicate flows found in target org:');
    lines.push('');
    formatDuplicateFlowsSection(duplicateFlows, lines, verbose);
    lines.push('');
  } else {
    // Format each category (no generic "Validation failed" header)
    if (duplicateFlows && duplicateFlows.length > 0) {
      lines.push('Duplicate flows found in target org:');
      formatDuplicateFlowsSection(duplicateFlows, lines, verbose);
      lines.push('');
    }

    const missingDeps = categorized.get(ErrorCategory.MissingDependencies);
    if (missingDeps && missingDeps.length > 0) {
      lines.push('Missing dependencies:');
      formatMissingDependenciesSection(missingDeps, lines, verbose);
      lines.push('');
    }

    const flowExistence = categorized.get(ErrorCategory.FlowExistence);
    if (flowExistence && flowExistence.length > 0) {
      lines.push('Flow link failures:');
      formatFlowExistenceSection(flowExistence, lines, verbose);
      lines.push('');
    }

    const apiVersion = categorized.get(ErrorCategory.ApiVersion);
    if (apiVersion && apiVersion.length > 0) {
      lines.push('API version issues:');
      formatApiVersionSection(apiVersion, lines, verbose);
      lines.push('');
    }

    const flowDeployment = categorized.get(ErrorCategory.FlowDeployment);
    if (flowDeployment && flowDeployment.length > 0) {
      lines.push('Flow deployment errors:');
      formatFlowDeploymentSection(flowDeployment, lines, verbose);
      lines.push('');
    }

    const other = categorized.get(ErrorCategory.Other);
    if (other && other.length > 0) {
      lines.push('Other validation errors:');
      formatOtherSection(other, lines, verbose);
      lines.push('');
    }
  }

  lines.push('Deployment aborted.');
  if (!verbose) {
    lines.push('Run with SF_LOG_LEVEL=debug or DEBUG=sf:* for full validator trace.');
  }

  return lines;
}

/**
 * Return a single string suitable for logging that matches the user-facing message.
 * Use this so the log file contains the same text shown in the terminal.
 *
 * @param err - Error (typically ValidationError or DeployError)
 * @returns Formatted message string for logger
 */
export function getFormattedMessageForLog(err: unknown): string {
  if (err instanceof ValidationError && err.failures?.length) {
    return formatValidationError(err, false).join('\n');
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Categorize validation failures by type
 */
function categorizeFailures(failures: ValidationResult[]): CategorizedFailures {
  const categorized: CategorizedFailures = new Map();

  for (const failure of failures) {
    const category = categorizeFailure(failure);
    const existing = categorized.get(category) ?? [];
    existing.push(failure);
    categorized.set(category, existing);
  }

  return categorized;
}

/**
 * Determine the category for a validation failure
 */
function categorizeFailure(failure: ValidationResult): ErrorCategory {
  const name = failure.name.toLowerCase();

  if (name.includes('uniqueness')) {
    return ErrorCategory.DuplicateFlows;
  }
  if (name.includes('existence') && name.includes('flow')) {
    return ErrorCategory.FlowExistence;
  }
  if (name.includes('customfields') || name.includes('apexclass')) {
    return ErrorCategory.MissingDependencies;
  }
  if (name.includes('apiversion')) {
    return ErrorCategory.ApiVersion;
  }
  if (name.includes('flowdeployment')) {
    return ErrorCategory.FlowDeployment;
  }

  return ErrorCategory.Other;
}

/**
 * Format duplicate flow errors
 */
function formatDuplicateFlowsSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    const flowName = extractFlowName(failure.message ?? '');
    const label = getFlowLabel(failure.name);

    if (flowName) {
      lines.push(`• ${label} : ${flowName}`);
    } else {
      lines.push(`• ${label} : ${failure.message ?? 'unknown'}`);
    }

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Format missing dependency errors
 */
function formatMissingDependenciesSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    const name = failure.name.toLowerCase();

    if (name.includes('customfields')) {
      const fields = extractFieldNames(failure.message ?? '');
      if (fields.length > 0) {
        lines.push(`• Custom Fields : ${fields.join(', ')}`);
      } else {
        lines.push(`• Custom Fields : ${failure.message ?? 'unknown'}`);
      }
    } else if (name.includes('apexclass')) {
      const classes = extractApexClasses(failure.message ?? '');
      if (classes.length > 0) {
        lines.push(`• Apex Classes : ${classes.join(', ')}`);
      } else {
        lines.push(`• Apex Classes : ${failure.message ?? 'unknown'}`);
      }
    } else {
      lines.push(`• ${failure.name} : ${failure.message ?? failure.status}`);
    }

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Format flow existence errors (when linking)
 */
function formatFlowExistenceSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    const label = getFlowLabel(failure.name);
    lines.push(`• ${label} : ${failure.message ?? failure.status}`);

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Format API version errors
 */
function formatApiVersionSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    lines.push(`• ${failure.message ?? failure.status}`);

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Format flow deployment errors
 */
function formatFlowDeploymentSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    lines.push(`• ${failure.message ?? failure.status}`);

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Format other/unknown errors
 */
function formatOtherSection(failures: ValidationResult[], lines: string[], verbose: boolean): void {
  for (const failure of failures) {
    lines.push(`• ${failure.name} : ${failure.message ?? failure.status}`);

    if (verbose) {
      lines.push(`  (${failure.name}: ${failure.message ?? failure.status})`);
    }
  }
}

/**
 * Extract flow name from validator message using regex
 */
function extractFlowName(message: string): string | null {
  const match = message.match(/Flow '(.*?)' already exists/);
  return match ? match[1] : null;
}

/**
 * Extract custom field names from validator message
 */
function extractFieldNames(message: string): string[] {
  // Match patterns like "Custom fields missing: Field1, Field2"
  // or "Apex classes not found in org: Class1, Class2"
  const match = message.match(/missing:\s*(.+)|not found in org:\s*(.+)/i);
  if (match) {
    const fields = match[1] || match[2];
    return fields
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  }
  return [];
}

/**
 * Extract Apex class names from validator message
 */
function extractApexClasses(message: string): string[] {
  // Match patterns like "Apex classes not found in org: Class1, Class2"
  const match = message.match(/not found in org:\s*(.+)/i);
  if (match) {
    return match[1]
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }
  return [];
}

/**
 * Get human-friendly label for flow validators
 */
function getFlowLabel(validatorName: string): string {
  const name = validatorName.toLowerCase();

  if (name.includes('intakeflow')) {
    if (name.includes('uniqueness')) {
      return 'Intake Flow already exists';
    }
    if (name.includes('existence')) {
      return 'Intake Flow not found';
    }
  }

  if (name.includes('fulfillmentflow')) {
    if (name.includes('uniqueness')) {
      return 'Fulfillment Flow already exists';
    }
    if (name.includes('existence')) {
      return 'Fulfillment Flow not found';
    }
  }

  return validatorName;
}
