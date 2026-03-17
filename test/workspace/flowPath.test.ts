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
import { expect } from 'chai';
import { FLOW_EXTENSION_FLOW } from '../../src/constants.js';
import { FlowPathResolver } from '../../src/workspace/flowPath.js';

describe('FlowPathResolver.resolveFlowFilePath', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = path.join(os.tmpdir(), `flow-path-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns .flow path when .flow file exists', () => {
    const flowPath = path.join(workspaceDir, `MyFlow${FLOW_EXTENSION_FLOW}`);
    fs.writeFileSync(flowPath, '{}', 'utf-8');
    const result = FlowPathResolver.resolveFlowFilePath(workspaceDir, 'MyFlow');
    expect(result).to.equal(flowPath);
  });

  it('returns .flow-meta.xml path when .flow does not exist but .flow-meta.xml exists', () => {
    const metaPath = path.join(workspaceDir, 'MyFlow.flow-meta.xml');
    fs.writeFileSync(metaPath, '<root/>', 'utf-8');
    const result = FlowPathResolver.resolveFlowFilePath(workspaceDir, 'MyFlow');
    expect(result).to.equal(metaPath);
  });

  it('returns .xml path when only .xml exists', () => {
    const xmlPath = path.join(workspaceDir, 'MyFlow.xml');
    fs.writeFileSync(xmlPath, '<root/>', 'utf-8');
    const result = FlowPathResolver.resolveFlowFilePath(workspaceDir, 'MyFlow');
    expect(result).to.equal(xmlPath);
  });

  it('prefers .flow over .flow-meta.xml when both exist', () => {
    const flowPath = path.join(workspaceDir, `MyFlow${FLOW_EXTENSION_FLOW}`);
    fs.writeFileSync(flowPath, '{}', 'utf-8');
    fs.writeFileSync(path.join(workspaceDir, 'MyFlow.flow-meta.xml'), '<root/>', 'utf-8');
    const result = FlowPathResolver.resolveFlowFilePath(workspaceDir, 'MyFlow');
    expect(result).to.equal(flowPath);
  });

  it('returns .flow path when neither .flow nor flow extensions exist', () => {
    const result = FlowPathResolver.resolveFlowFilePath(workspaceDir, 'MissingFlow');
    expect(result).to.equal(path.join(workspaceDir, `MissingFlow${FLOW_EXTENSION_FLOW}`));
  });
});
