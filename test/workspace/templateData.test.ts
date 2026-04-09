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
import { SERVICE_PROCESS_METADATA_FILENAME } from '../../src/constants.js';
import { TemplateDataReader } from '../../src/workspace/templateData.js';

describe('TemplateDataReader.parseTemplateData', () => {
  it('returns extract with name when valid JSON has name', () => {
    const content = JSON.stringify({ name: 'MyServiceProcess' });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.name).to.equal('MyServiceProcess');
    expect(result.apexClassNames).to.deep.equal([]);
    expect(result.customFields).to.deep.equal([]);
  });

  it('returns extract with intakeFlowName from intakeForm string', () => {
    const content = JSON.stringify({ intakeForm: 'My_Intake_Flow' });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.intakeFlowName).to.equal('My_Intake_Flow');
  });

  it('returns extract with intakeFlowName from intakeForm object with apiName', () => {
    const content = JSON.stringify({ intakeForm: { apiName: 'Intake_Flow_ApiName' } });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.intakeFlowName).to.equal('Intake_Flow_ApiName');
  });

  it('returns fulfillmentFlowType orchestrator when fulfillmentFlow.type is FlowOrchestrator', () => {
    const content = JSON.stringify({
      fulfillmentFlow: { apiName: 'Fulfill', type: 'FlowOrchestrator' },
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.fulfillmentFlowType).to.equal('orchestrator');
  });

  it('returns fulfillmentFlowType regular when fulfillmentFlow has type other than FlowOrchestrator', () => {
    const content = JSON.stringify({
      fulfillmentFlow: { apiName: 'Fulfill', type: 'Flow' },
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.fulfillmentFlowType).to.equal('regular');
  });

  it('returns fulfillmentFlowType regular when fulfillmentFlow exists but no type', () => {
    const content = JSON.stringify({ fulfillmentFlow: { apiName: 'Fulfill' } });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.fulfillmentFlowType).to.equal('regular');
  });

  it('returns customFields from sections with isMappedAnchorField and __c apiName', () => {
    const content = JSON.stringify({
      targetObject: 'Case',
      sections: [
        {
          attributes: [
            { apiName: 'CustomField__c', isMappedAnchorField: true },
            { apiName: 'Other__c', isMappedAnchorField: false },
            { apiName: 'Another__c', isMappedAnchorField: true },
          ],
        },
      ],
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.customFields).to.deep.equal([
      { objectApiName: 'Case', fieldApiName: 'CustomField__c' },
      { objectApiName: 'Case', fieldApiName: 'Another__c' },
    ]);
  });

  it('returns apexClassNames from preProcessors', () => {
    const content = JSON.stringify({
      preProcessors: [{ apiName: 'MyApexClass' }, { apiName: 'OtherClass' }, {}],
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.apexClassNames).to.deep.equal(['MyApexClass', 'OtherClass']);
  });

  it('deduplicates apexClassNames', () => {
    const content = JSON.stringify({
      preProcessors: [{ apiName: 'A' }, { apiName: 'A' }, { apiName: 'B' }],
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.apexClassNames).to.deep.equal(['A', 'B']);
  });

  it('returns EMPTY_TEMPLATE shape for invalid JSON', () => {
    const result = TemplateDataReader.parseTemplateData('not json {');
    expect(result).to.deep.equal({ apexClassNames: [], customFields: [] });
    expect(result.name).to.be.undefined;
    expect(result.intakeFlowName).to.be.undefined;
    expect(result.fulfillmentFlowType).to.be.undefined;
  });

  it('returns name undefined when name is empty string', () => {
    const content = JSON.stringify({ name: '' });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.name).to.be.undefined;
  });

  it('returns name undefined when name is whitespace only', () => {
    const content = JSON.stringify({ name: '   ' });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.name).to.be.undefined;
  });

  it('trims name', () => {
    const content = JSON.stringify({ name: '  Trimmed  ' });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.name).to.equal('Trimmed');
  });

  it('returns EMPTY_TEMPLATE for empty string content', () => {
    const result = TemplateDataReader.parseTemplateData('');
    expect(result).to.deep.equal({ apexClassNames: [], customFields: [] });
  });

  it('returns EMPTY_TEMPLATE for malformed JSON (unclosed bracket)', () => {
    const result = TemplateDataReader.parseTemplateData('{"name": "x"');
    expect(result).to.deep.equal({ apexClassNames: [], customFields: [] });
  });

  it('only includes customFields with apiName ending in __c', () => {
    const content = JSON.stringify({
      targetObject: 'Case',
      sections: [
        {
          attributes: [
            { apiName: 'StandardField', isMappedAnchorField: true },
            { apiName: 'Custom__c', isMappedAnchorField: true },
          ],
        },
      ],
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.customFields).to.deep.equal([{ objectApiName: 'Case', fieldApiName: 'Custom__c' }]);
  });

  it('deduplicates customFields by objectApiName.fieldApiName', () => {
    const content = JSON.stringify({
      targetObject: 'Case',
      sections: [
        { attributes: [{ apiName: 'F__c', isMappedAnchorField: true }] },
        { attributes: [{ apiName: 'F__c', isMappedAnchorField: true }] },
      ],
    });
    const result = TemplateDataReader.parseTemplateData(content);
    expect(result.customFields).to.deep.equal([{ objectApiName: 'Case', fieldApiName: 'F__c' }]);
  });
});

describe('TemplateDataReader.readOrgMetadataVersionFromDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `template-data-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns undefined when service-process.metadata.json does not exist', () => {
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.be.undefined;
  });

  it('returns undefined when file has no org.apiVersion', () => {
    fs.writeFileSync(path.join(tmpDir, SERVICE_PROCESS_METADATA_FILENAME), JSON.stringify({ version: '1' }), 'utf-8');
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.be.undefined;
  });

  it('returns apiVersion string when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, SERVICE_PROCESS_METADATA_FILENAME),
      JSON.stringify({ org: { apiVersion: '66.0' } }),
      'utf-8'
    );
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.equal('66.0');
  });

  it('normalizes integer apiVersion to X.0', () => {
    fs.writeFileSync(
      path.join(tmpDir, SERVICE_PROCESS_METADATA_FILENAME),
      JSON.stringify({ org: { apiVersion: 66 } }),
      'utf-8'
    );
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.equal('66.0');
  });

  it('trims string apiVersion', () => {
    fs.writeFileSync(
      path.join(tmpDir, SERVICE_PROCESS_METADATA_FILENAME),
      JSON.stringify({ org: { apiVersion: '  67.0  ' } }),
      'utf-8'
    );
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.equal('67.0');
  });

  it('returns undefined when file is invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, SERVICE_PROCESS_METADATA_FILENAME), 'not json', 'utf-8');
    const result = TemplateDataReader.readOrgMetadataVersionFromDir(tmpDir);
    expect(result).to.be.undefined;
  });
});

describe('TemplateDataReader.readTemplateDataFromDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `template-data-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns EMPTY_TEMPLATE when templateData.json does not exist', () => {
    const result = TemplateDataReader.readTemplateDataFromDir(tmpDir);
    expect(result).to.deep.equal({ apexClassNames: [], customFields: [] });
  });

  it('returns parsed extract when templateData.json exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'templateData.json'),
      JSON.stringify({ name: 'FromDir', targetObject: 'Case' }),
      'utf-8'
    );
    const result = TemplateDataReader.readTemplateDataFromDir(tmpDir);
    expect(result.name).to.equal('FromDir');
    expect(result.apexClassNames).to.deep.equal([]);
  });

  it('returns EMPTY_TEMPLATE when file is invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'templateData.json'), 'invalid', 'utf-8');
    const result = TemplateDataReader.readTemplateDataFromDir(tmpDir);
    expect(result).to.deep.equal({ apexClassNames: [], customFields: [] });
  });
});

describe('TemplateDataReader.deriveFlowsAndTemplateData', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `derive-flows-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns empty filePaths and template extract when no metadata/flows or templateData', () => {
    const result = TemplateDataReader.deriveFlowsAndTemplateData(tmpDir);
    expect(result.filePaths).to.deep.equal([]);
    expect(result.templateDataExtract).to.deep.equal({ apexClassNames: [], customFields: [] });
  });

  it('returns flow file paths under metadata/flows for .flow-meta.xml and .xml', () => {
    const flowDir = path.join(tmpDir, 'metadata', 'flows');
    fs.mkdirSync(flowDir, { recursive: true });
    fs.writeFileSync(path.join(flowDir, 'MyFlow.flow-meta.xml'), '<root/>', 'utf-8');
    fs.writeFileSync(path.join(flowDir, 'Other.xml'), '<root/>', 'utf-8');
    fs.writeFileSync(path.join(flowDir, 'readme.txt'), 'ignore', 'utf-8');
    const result = TemplateDataReader.deriveFlowsAndTemplateData(tmpDir);
    expect(result.filePaths).to.have.lengthOf(2);
    expect(result.filePaths.some((p) => p.endsWith('MyFlow.flow-meta.xml'))).to.be.true;
    expect(result.filePaths.some((p) => p.endsWith('Other.xml'))).to.be.true;
    expect(result.filePaths.some((p) => p.endsWith('readme.txt'))).to.be.false;
  });

  it('includes templateDataExtract from readTemplateDataFromDir', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'templateData.json'),
      JSON.stringify({ name: 'DerivedSP', intakeForm: 'IntakeFlow' }),
      'utf-8'
    );
    const result = TemplateDataReader.deriveFlowsAndTemplateData(tmpDir);
    expect(result.templateDataExtract.name).to.equal('DerivedSP');
    expect(result.templateDataExtract.intakeFlowName).to.equal('IntakeFlow');
  });
});
