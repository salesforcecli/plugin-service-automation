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
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import { retrieveflow } from '../../../src/utils/flow/retrieveflow.js';

describe('retrieveflow', () => {
  const $$ = new TestContext();
  let outputDir: string;

  beforeEach(() => {
    outputDir = path.join(os.tmpdir(), `retrieveflow-test-${Date.now()}`);
  });

  afterEach(() => {
    $$.restore();
    try {
      if (outputDir && fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
      }
    } catch {
      // ignore
    }
  });

  it('calls ComponentSet.retrieve and pollStatus with resolved output dir', async () => {
    const connection = {} as never;
    const org = { getConnection: (): never => connection };
    const pollStatusStub = $$.SANDBOX.stub().resolves();
    const retrieveStub = $$.SANDBOX.stub(ComponentSet.prototype, 'retrieve').resolves({
      pollStatus: pollStatusStub,
    } as never);

    await retrieveflow(org as never, 'MyFlow', outputDir);

    expect(retrieveStub.calledOnce).to.be.true;
    const retrieveCall = retrieveStub.getCall(0);
    expect(retrieveCall.args[0]).to.include({
      usernameOrConnection: connection,
      output: path.resolve(outputDir),
      merge: true,
    });
    expect(pollStatusStub.calledOnce).to.be.true;
  });

  it('creates output directory when it does not exist', async () => {
    const connection = {} as never;
    const org = { getConnection: (): never => connection };
    $$.SANDBOX.stub(ComponentSet.prototype, 'retrieve').resolves({
      pollStatus: (): Promise<void> => Promise.resolve(),
    } as never);

    expect(fs.existsSync(outputDir)).to.be.false;
    await retrieveflow(org as never, 'AnotherFlow', outputDir);
    expect(fs.existsSync(outputDir)).to.be.true;
  });
});
