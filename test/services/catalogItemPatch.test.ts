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
import { CatalogItemPatcher } from '../../src/services/catalogItemPatch.js';

describe('CatalogItemPatcher.buildCatalogItemPatchBody', () => {
  const baseShape = {
    agentAction: {},
    associatedArticles: [],
    sections: [],
    eligibilityRules: [],
    integrations: [],
    isActive: false,
    productRequests: [],
    targetObject: 'Case',
    usedFor: 'ServiceProcess',
    preProcessors: [],
  };

  it('returns body with empty intakeForm and fulfillmentFlow when all ids undefined', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(undefined, undefined, undefined, undefined);
    expect(body.intakeForm).to.deep.equal({});
    expect(body.fulfillmentFlow).to.deep.equal({});
    expect(body.name).to.equal('');
    expect(body.contextDefinitionDevNameOrId).to.be.undefined;
    expect(body).to.deep.include(baseShape);
  });

  it('returns Create intakeForm when intakeFormDefinitionId set and existingIntakeFormId undefined', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody('0HDxx000000001', undefined, undefined, undefined);
    expect(body.intakeForm).to.deep.equal({
      operationType: 'Create',
      intakeFormId: '0HDxx000000001',
      type: 'Flow',
    });
    expect(body.fulfillmentFlow).to.deep.equal({});
  });

  it('returns Update intakeForm when both intakeFormDefinitionId and existingIntakeFormId set', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody('0HDxx000000002', undefined, '0HDxx000000001', undefined);
    expect(body.intakeForm).to.deep.equal({
      operationType: 'Update',
      id: '0HDxx000000001',
      intakeFormId: '0HDxx000000002',
      type: 'Flow',
    });
  });

  it('sets fulfillmentFlow when fulfillmentFlowDefinitionId provided', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(undefined, '0HDxx000000003', undefined, undefined);
    expect(body.fulfillmentFlow).to.deep.equal({
      fulfillmentFlowId: '0HDxx000000003',
      type: 'Flow',
      operationType: 'Create',
    });
  });

  it('sets contextDefinitionDevNameOrId when provided', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(undefined, undefined, undefined, 'MyContextDefinition');
    expect(body.contextDefinitionDevNameOrId).to.equal('MyContextDefinition');
  });

  it('sets name from serviceProcessName when provided', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(
      undefined,
      undefined,
      undefined,
      undefined,
      'My Service Process'
    );
    expect(body.name).to.equal('My Service Process');
  });

  it('sets name to empty string when serviceProcessName undefined', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(undefined, undefined, undefined, undefined);
    expect(body.name).to.equal('');
  });

  it('combines intakeForm Create, fulfillmentFlow, contextDefinitionDevNameOrId, and name', () => {
    const body = CatalogItemPatcher.buildCatalogItemPatchBody(
      '0HDxx000000001',
      '0HDxx000000002',
      undefined,
      'ContextDevName',
      'SP Name'
    );
    expect(body.intakeForm).to.deep.equal({
      operationType: 'Create',
      intakeFormId: '0HDxx000000001',
      type: 'Flow',
    });
    expect(body.fulfillmentFlow).to.deep.equal({
      fulfillmentFlowId: '0HDxx000000002',
      type: 'Flow',
      operationType: 'Create',
    });
    expect(body.contextDefinitionDevNameOrId).to.equal('ContextDevName');
    expect(body.name).to.equal('SP Name');
  });
});
