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
import { IntakeFlowUniquenessValidator } from '../../../src/validation/validators/IntakeFlowUniquenessValidator.js';

describe('IntakeFlowUniquenessValidator', () => {
  const fakeConn = { getApiVersion: () => '66.0' } as ValidationContext['conn'];

  function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return { conn: fakeConn, ...overrides };
  }

  it('returns PASS skipped when no intakeFlow', async () => {
    const result = await IntakeFlowUniquenessValidator.validate(ctx());
    expect(result.name).to.equal('IntakeFlowUniquenessValidator');
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('No intake flow');
    expect(result.message).to.include('skipped');
  });

  it('returns PASS skipped when deploymentIntent is link', async () => {
    const result = await IntakeFlowUniquenessValidator.validate(
      ctx({
        intakeFlow: {
          apiName: 'MyFlow',
          namespace: null,
          deploymentIntent: 'link',
          flowType: 'regular',
        },
      })
    );
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('linked, not deployed');
    expect(result.message).to.include('skipped');
  });
});
