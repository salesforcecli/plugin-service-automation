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

import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';

describe('service process deploy NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should display help', () => {
    const output = execCmd('service-process deploy --help', { ensureExitCode: 0 }).shellOutput.stdout;
    expect(output).to.contain('service-process deploy');
    expect(output).to.contain('--target-org');
    expect(output).to.contain('--input-zip');
  });

  it('should fail when required flags are missing', () => {
    const result = execCmd('service-process deploy', { ensureExitCode: 'nonZero' });
    const err = result.shellOutput.stderr;
    expect(
      err.includes('Missing required flag') ||
        err.includes('NoDefaultEnvError') ||
        err.includes('No default environment') ||
        err.includes('target-org') ||
        err.includes('input-zip'),
      err
    ).to.equal(true);
  });

  it('should fail when --input-zip is not a .zip path (parse-time, no org)', () => {
    const result = execCmd('service-process deploy -z /tmp/service-process-nut-not-a-zip.txt', {
      ensureExitCode: 'nonZero',
    });
    const err = result.shellOutput.stderr;
    expect(err).to.match(/\.zip|InvalidFileType|input-zip/i, err);
  });
});
