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
import type { FlowReference } from '../validation/types.js';

export type DeploymentMetadata = {
  intakeFlow?: FlowReference;
  fulfillmentFlow?: FlowReference;
  version: string;
};

const METADATA_FILENAME = 'deployment-metadata.json';

/**
 * Reads deployment metadata from package directory.
 * Returns null if file doesn't exist.
 */
export async function readDeploymentMetadata(packageDir: string): Promise<DeploymentMetadata | null> {
  try {
    const filePath = join(packageDir, METADATA_FILENAME);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as DeploymentMetadata;
  } catch (error) {
    // File doesn't exist or is invalid
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Writes deployment metadata to package directory.
 */
export async function writeDeploymentMetadata(packageDir: string, metadata: DeploymentMetadata): Promise<void> {
  const filePath = join(packageDir, METADATA_FILENAME);
  const content = JSON.stringify(metadata, null, 2);
  await writeFile(filePath, content, 'utf-8');
}
