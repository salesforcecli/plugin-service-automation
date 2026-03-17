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

import { expect } from 'chai';
import type { ValidationContext } from '../../../src/validation/types.js';
import { FlowDeploymentValidator } from '../../../src/validation/validators/FlowDeploymentValidator.js';

describe('FlowDeploymentValidator', () => {
  const fakeConn = { getApiVersion: () => '66.0' } as ValidationContext['conn'];

  function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return { conn: fakeConn, ...overrides };
  }

  it('returns PASS skipped when org is missing', async () => {
    const result = await FlowDeploymentValidator.validate(ctx({ flowFilePaths: ['/path/to/flow.xml'] }));
    expect(result.name).to.equal('FlowDeploymentValidator');
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('No org or flow file paths');
    expect(result.message).to.include('skipped');
  });

  it('returns PASS skipped when flowFilePaths is missing', async () => {
    const result = await FlowDeploymentValidator.validate(ctx({ org: {} as ValidationContext['org'] }));
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('skipped');
  });

  it('returns PASS skipped when flowFilePaths is empty', async () => {
    const result = await FlowDeploymentValidator.validate(
      ctx({ org: {} as ValidationContext['org'], flowFilePaths: [] })
    );
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('skipped');
  });
});
