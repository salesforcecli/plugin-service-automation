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
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { TEMP_UPLOAD_ZIP_PREFIX, TEMP_WORKSPACE_PREFIX, TEMPLATE_DATA_FILENAME } from '../constants.js';

export type DeployWorkspaceResult = {
  workspace: string;
  zipPath: string;
  cleanup: () => void;
};

/**
 * Extracts the given .zip file to a temporary workspace directory and returns the workspace path, zip path, and a cleanup method.
 * Input must be a .zip file. Call cleanup() when done to remove the workspace.
 */
export async function extractZipToWorkspace(inputPath: string): Promise<DeployWorkspaceResult> {
  const absoluteInput = path.resolve(inputPath);

  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input path does not exist: ${absoluteInput}`);
  }

  const stat = fs.statSync(absoluteInput);

  if (!stat.isFile() || path.extname(absoluteInput).toLowerCase() !== '.zip') {
    throw new Error('Input must be a .zip file');
  }

  const zipBuffer = new Uint8Array(fs.readFileSync(absoluteInput));
  const zip = await JSZip.loadAsync(zipBuffer);
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_WORKSPACE_PREFIX));

  const cleanup = (): void => {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  const entries = Object.entries(zip.files);
  for (const [entryPath, entry] of entries) {
    const destPath = path.join(workspaceDir, entryPath);
    if (entry.dir) {
      fs.mkdirSync(destPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    }
  }
  const fileEntries = entries.filter(([, entry]) => !entry.dir);
  const contents = await Promise.all(fileEntries.map(([, entry]) => entry.async('nodebuffer')));
  for (let i = 0; i < fileEntries.length; i++) {
    const [entryPath] = fileEntries[i];
    const content = contents[i];
    const destPath = path.join(workspaceDir, entryPath);
    fs.writeFileSync(destPath, new Uint8Array(content));
  }

  // If zip has a single top-level directory, use it as workspace so structure matches directory case
  const topEntries = fs.readdirSync(workspaceDir);
  const workspace =
    topEntries.length === 1 && fs.statSync(path.join(workspaceDir, topEntries[0])).isDirectory()
      ? path.join(workspaceDir, topEntries[0])
      : workspaceDir;

  return { workspace, zipPath: absoluteInput, cleanup };
}

/**
 * Creates a .zip containing only the updated templateData.json from the workspace.
 * Writes the zip to a temp file. Returns the zip path and a cleanup that deletes the temp zip.
 */
export async function createZipFromWorkspace(workspacePath: string): Promise<{
  zipPath: string;
  cleanup: () => void;
}> {
  const zip = new JSZip();
  const templatePath = path.join(workspacePath, TEMPLATE_DATA_FILENAME);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`${TEMPLATE_DATA_FILENAME} not found in workspace: ${workspacePath}`);
  }

  zip.file(TEMPLATE_DATA_FILENAME, new Uint8Array(fs.readFileSync(templatePath)));

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
  const tempZipPath = path.join(os.tmpdir(), `${TEMP_UPLOAD_ZIP_PREFIX}${Date.now()}.zip`);
  fs.writeFileSync(tempZipPath, zipBuffer);

  const cleanup = (): void => {
    try {
      fs.unlinkSync(tempZipPath);
    } catch {
      // ignore
    }
  };

  return { zipPath: tempZipPath, cleanup };
}
