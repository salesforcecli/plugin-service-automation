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

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SERVICE_PROCESS_METADATA_FILENAME } from '../constants.js';
import type { FlowReference } from '../validation/types.js';

export type DeploymentMetadata = {
  intakeFlow?: FlowReference;
  fulfillmentFlow?: FlowReference;
  version: string;
};

/** Combined metadata file written by retrieve and read by deploy (org + service process flows). */
export type ServiceProcessMetadata = {
  version: string;
  org: {
    instanceUrl: string;
    id: string;
    apiVersion: string;
  };
  serviceProcess: {
    intakeFlow?: FlowReference;
    fulfillmentFlow?: FlowReference;
  };
};

const LEGACY_METADATA_FILENAME = 'deployment-metadata.json';

/**
 * Reads the combined service-process.metadata.json from package directory.
 * Returns null if file doesn't exist.
 */
export async function readServiceProcessMetadata(packageDir: string): Promise<ServiceProcessMetadata | null> {
  try {
    const filePath = join(packageDir, SERVICE_PROCESS_METADATA_FILENAME);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ServiceProcessMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Writes the combined service-process.metadata.json to package directory.
 */
export async function writeServiceProcessMetadata(packageDir: string, metadata: ServiceProcessMetadata): Promise<void> {
  const filePath = join(packageDir, SERVICE_PROCESS_METADATA_FILENAME);
  const content = JSON.stringify(metadata, null, 2);
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Reads deployment metadata from package directory (service-process.metadata.json).
 * Returns the deployment-relevant shape (version, intakeFlow, fulfillmentFlow) or null if file doesn't exist.
 */
export async function readDeploymentMetadata(packageDir: string): Promise<DeploymentMetadata | null> {
  const full = await readServiceProcessMetadata(packageDir);
  if (!full) return null;
  return {
    version: full.version,
    intakeFlow: full.serviceProcess.intakeFlow,
    fulfillmentFlow: full.serviceProcess.fulfillmentFlow,
  };
}

/**
 * Writes deployment metadata to package directory (legacy deployment-metadata.json shape).
 *
 * @internal Deploy uses writeServiceProcessMetadata for the combined file.
 */
export async function writeDeploymentMetadata(packageDir: string, metadata: DeploymentMetadata): Promise<void> {
  const filePath = join(packageDir, LEGACY_METADATA_FILENAME);
  const content = JSON.stringify(metadata, null, 2);
  await writeFile(filePath, content, 'utf-8');
}
