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
import JSZip from 'jszip';
import { TEMPLATE_DATA_FILENAME } from '../../src/constants.js';
import { DeployWorkspace } from '../../src/workspace/deployWorkspace.js';

describe('DeployWorkspace', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `deploy-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('extractZipToWorkspace', () => {
    it('throws when input path does not exist', async () => {
      const nonExistent = path.join(tmpDir, 'missing.zip');
      try {
        await DeployWorkspace.extractZipToWorkspace(nonExistent);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('does not exist');
        expect((err as Error).message).to.include('missing.zip');
      }
    });

    it('throws when input is a directory not a file', async () => {
      const dirPath = path.join(tmpDir, 'adir');
      fs.mkdirSync(dirPath);
      try {
        await DeployWorkspace.extractZipToWorkspace(dirPath);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('Input must be a .zip file');
      }
    });

    it('throws when input file has non-.zip extension', async () => {
      const txtPath = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(txtPath, 'hello');
      try {
        await DeployWorkspace.extractZipToWorkspace(txtPath);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('Input must be a .zip file');
      }
    });

    it('extracts zip and returns workspace, zipPath, and cleanup', async () => {
      const zipPath = path.join(tmpDir, 'out.zip');
      const zip = new JSZip();
      zip.file('templateData.json', JSON.stringify({ name: 'Test', targetObject: 'Case' }));
      zip.file('metadata/flows/MyFlow.flow-meta.xml', '<root/>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      fs.writeFileSync(zipPath, buffer);

      const result = await DeployWorkspace.extractZipToWorkspace(zipPath);
      expect(result.zipPath).to.equal(zipPath);
      expect(fs.existsSync(result.workspace)).to.be.true;
      const templateInWorkspace = path.join(result.workspace, 'templateData.json');
      const flowInWorkspace = path.join(result.workspace, 'metadata', 'flows', 'MyFlow.flow-meta.xml');
      expect(fs.existsSync(templateInWorkspace)).to.be.true;
      expect(fs.existsSync(flowInWorkspace)).to.be.true;
      result.cleanup();
      expect(fs.existsSync(result.workspace)).to.be.false;
    });

    it('uses single top-level directory as workspace when zip has one', async () => {
      const zipPath = path.join(tmpDir, 'nested.zip');
      const zip = new JSZip();
      zip.file('01txx/templateData.json', JSON.stringify({ name: 'Test' }));
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      fs.writeFileSync(zipPath, buffer);

      const result = await DeployWorkspace.extractZipToWorkspace(zipPath);
      expect(result.workspace).to.include('01txx');
      expect(fs.existsSync(path.join(result.workspace, 'templateData.json'))).to.be.true;
      result.cleanup();
    });
  });

  describe('createZipFromWorkspace', () => {
    it('throws when templateData.json is not in workspace', async () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir);
      try {
        await DeployWorkspace.createZipFromWorkspace(emptyDir);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include(TEMPLATE_DATA_FILENAME);
        expect((err as Error).message).to.include('not found');
      }
    });

    it('creates zip with templateData.json and returns zipPath and cleanup', async () => {
      const templatePath = path.join(tmpDir, TEMPLATE_DATA_FILENAME);
      fs.writeFileSync(templatePath, JSON.stringify({ name: 'SP' }), 'utf-8');

      const result = await DeployWorkspace.createZipFromWorkspace(tmpDir);
      expect(fs.existsSync(result.zipPath)).to.be.true;
      expect(path.extname(result.zipPath)).to.equal('.zip');
      const zip = await JSZip.loadAsync(fs.readFileSync(result.zipPath));
      expect(zip.file(TEMPLATE_DATA_FILENAME)).to.not.be.null;
      result.cleanup();
      expect(fs.existsSync(result.zipPath)).to.be.false;
    });
  });
});
