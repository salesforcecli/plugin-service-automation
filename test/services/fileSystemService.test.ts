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
import {
  ensureDirectoryExists,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  createZipFile,
} from '../../src/services/fileSystemService.js';

describe('fileSystemService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `fs-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('ensureDirectoryExists', () => {
    it('does not throw when directory already exists', async () => {
      await fs.promises.mkdir(tmpDir, { recursive: true });
      await ensureDirectoryExists(tmpDir);
      expect(fs.existsSync(tmpDir)).to.be.true;
    });

    it('creates directory when it does not exist', async () => {
      const subDir = path.join(tmpDir, 'sub', 'nested');
      await ensureDirectoryExists(subDir);
      expect(fs.existsSync(subDir)).to.be.true;
    });
  });

  describe('createTemporaryDirectory', () => {
    it('creates the directory recursively', async () => {
      const dir = path.join(tmpDir, 'a', 'b');
      await createTemporaryDirectory(dir);
      expect(fs.existsSync(dir)).to.be.true;
    });
  });

  describe('removeTemporaryDirectory', () => {
    it('removes the directory and its contents', async () => {
      await fs.promises.mkdir(tmpDir, { recursive: true });
      await fs.promises.writeFile(path.join(tmpDir, 'file.txt'), 'content', 'utf-8');
      await removeTemporaryDirectory(tmpDir);
      expect(fs.existsSync(tmpDir)).to.be.false;
    });

    it('succeeds with force when directory does not exist', async () => {
      const nonExistent = path.join(os.tmpdir(), 'does-not-exist-xyz');
      await removeTemporaryDirectory(nonExistent, true);
    });
  });

  describe('createZipFile', () => {
    it('writes a zip file to disk from JSZip instance', async () => {
      const zipPath = path.join(tmpDir, 'out.zip');
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const zip = new JSZip();
      zip.file('hello.txt', 'Hello');
      await createZipFile(zipPath, zip);
      expect(fs.existsSync(zipPath)).to.be.true;
      const stat = fs.statSync(zipPath);
      expect(stat.size).to.be.greaterThan(0);
    });
  });
});
