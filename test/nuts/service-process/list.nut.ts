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

describe('service process list NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should display help', () => {
    const output = execCmd('service-process list --help', { ensureExitCode: 0 }).shellOutput.stdout;
    expect(output).to.contain('service-process list');
    expect(output).to.contain('--target-org');
  });

  it('should fail when required flags are missing', () => {
    const result = execCmd('service-process list', { ensureExitCode: 'nonZero' });
    const err = result.shellOutput.stderr;
    // Isolated testkit home has no default org; CLI may error on target-org before other flags.
    expect(
      err.includes('Missing required flag') ||
        err.includes('NoDefaultEnvError') ||
        err.includes('No default environment') ||
        err.includes('target-org'),
      err
    ).to.equal(true);
  });

  it('should fail when a flag value is invalid (parse-time, no org)', () => {
    const result = execCmd('service-process list --limit notaninteger', { ensureExitCode: 'nonZero' });
    const err = result.shellOutput.stderr;
    expect(err).to.match(/limit|integer|Expected/i, err);
  });

  it('should fail for an unknown service-process subcommand', () => {
    const result = execCmd('service-process not-a-real-command', { ensureExitCode: 'nonZero' });
    const err = result.shellOutput.stderr;
    expect(err).to.match(/not found|not-a-real-command/i, err);
  });
});
