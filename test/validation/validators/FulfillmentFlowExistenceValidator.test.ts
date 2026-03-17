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
import { FulfillmentFlowExistenceValidator } from '../../../src/validation/validators/FulfillmentFlowExistenceValidator.js';

describe('FulfillmentFlowExistenceValidator', () => {
  const fakeConn = { getApiVersion: () => '66.0' } as ValidationContext['conn'];

  function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return { conn: fakeConn, ...overrides };
  }

  it('returns PASS skipped when no fulfillmentFlow', async () => {
    const result = await FulfillmentFlowExistenceValidator.validate(ctx());
    expect(result.name).to.equal('FulfillmentFlowExistenceValidator');
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('No fulfillment flow');
    expect(result.message).to.include('skipped');
  });

  it('returns PASS skipped when deploymentIntent is deploy', async () => {
    const result = await FulfillmentFlowExistenceValidator.validate(
      ctx({
        fulfillmentFlow: {
          apiName: 'FulfillFlow',
          namespace: null,
          deploymentIntent: 'deploy',
          flowType: 'regular',
        },
      })
    );
    expect(result.status).to.equal('PASS');
    expect(result.message).to.include('deployed, not linked');
    expect(result.message).to.include('skipped');
  });
});
