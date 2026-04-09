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
import { FLOW_EXTENSION_FLOW, FLOW_EXTENSIONS } from '../constants.js';

export class FlowPathResolver {
  /**
   * Resolves the path to a flow file in the workspace.
   * Prefers .flow if it exists, otherwise .flow-meta.xml. If neither exists, returns the .flow path.
   */
  public static resolveFlowFilePath(workspaceDir: string, flowBaseName: string): string {
    const flowPath = path.join(workspaceDir, `${flowBaseName}${FLOW_EXTENSION_FLOW}`);
    if (fs.existsSync(flowPath)) return flowPath;
    for (const ext of FLOW_EXTENSIONS) {
      const p = path.join(workspaceDir, `${flowBaseName}${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return flowPath;
  }
}
