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

import { Lifecycle, type Logger } from '@salesforce/core';

type MetricPrimitive = string | number | boolean | null;
type MetricValue = MetricPrimitive | MetricPrimitive[];

export type MetricFields = Record<string, MetricValue | undefined>;

const toBooleanFlag = (value: MetricValue | undefined): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.length > 0;
  return value !== undefined && value !== null;
};

const buildSanitizedTelemetryFields = (fields: MetricFields): MetricFields => {
  const sanitized: MetricFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;

    // Replace identifiers/PII-ish values with safe booleans or counters.
    if (key === 'serviceProcessId' || key === 'spId' || key === 'deletedSpId') {
      sanitized.hasServiceProcessId = toBooleanFlag(value);
      continue;
    }
    if (key === 'documentId') {
      sanitized.hasDocumentId = toBooleanFlag(value);
      continue;
    }
    if (key === 'intakeFlowId') {
      sanitized.hasIntakeFlowId = toBooleanFlag(value);
      continue;
    }
    if (key === 'fulfillmentFlowId') {
      sanitized.hasFulfillmentFlowId = toBooleanFlag(value);
      continue;
    }
    if (key === 'deletedFlowIds') {
      sanitized.deletedFlowCount = Array.isArray(value) ? value.length : 0;
      continue;
    }
    if (key === 'errorTrigger') {
      sanitized.hasError = toBooleanFlag(value);
      continue;
    }
    if (key === 'targetOrgId') {
      sanitized.hasTargetOrgId = toBooleanFlag(value);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

/**
 * Emits lifecycle telemetry and mirrors the same payload to debug logs.
 * Telemetry failures are swallowed to keep command execution non-blocking.
 */
export async function publishLifecycleMetric(
  logger: Logger | undefined,
  eventName: string,
  fields: MetricFields
): Promise<void> {
  const telemetryFields = buildSanitizedTelemetryFields(fields);
  const payload = { eventName, ...telemetryFields };
  try {
    await Lifecycle.getInstance().emitTelemetry(payload);
  } catch (error) {
    logger?.debug(
      `Lifecycle telemetry emit failed for ${eventName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  logger?.debug(`[instrumentation-debug] ${JSON.stringify({ event: eventName, ...fields })}`);
}

export function toKilobytes(bytes: number): number {
  return Number((bytes / 1024).toFixed(2));
}

export function estimateJsonSizeKb(value: unknown): number {
  try {
    return toKilobytes(Buffer.byteLength(JSON.stringify(value), 'utf8'));
  } catch {
    return 0;
  }
}
