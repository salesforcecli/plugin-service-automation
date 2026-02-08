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

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Org } from '@salesforce/core';
import { deployFlows } from '../utils/deployflow.js';
import { runValidationsOrThrow, builtInValidators } from '../validation/index.js';
import type { CustomFieldRef, LogJsonFn, ValidationContext } from '../validation/types.js';

type TemplateDataExtract = {
  apexClassNames: string[];
  customFields: CustomFieldRef[];
};

const EMPTY_TEMPLATE: TemplateDataExtract = { apexClassNames: [], customFields: [] };

/** Shape of templateData.json (only fields we read). */
type TemplateData = {
  targetObject?: string;
  preProcessors?: Array<{ apiName?: string }>;
  sections?: Array<{ attributes?: Array<{ apiName?: string; isMappedAnchorField?: boolean }> }>;
};

/**
 * Service to deploy a Service Process (Flow) to a target org.
 * Validates first (custom fields, flow deployment checkOnly, Apex class presence), then deploys flows.
 *
 * @param options.inputDir - Path to a directory containing templateData.json and flow files (.flow-meta.xml or .xml) for all flows to be deployed.
 */
export async function deployServiceProcess(options: {
  org: Org;
  inputDir: string;
  logJson?: LogJsonFn;
}): Promise<void> {
  const { org, inputDir, logJson } = options;
  const absoluteInput = path.resolve(inputDir);

  // eslint-disable-next-line no-console
  console.log(`inputDir (resolved): ${absoluteInput}`);

  if (!fs.existsSync(absoluteInput) || !fs.statSync(absoluteInput).isDirectory()) {
    throw new Error(`inputDir must be a directory: ${absoluteInput}`);
  }

  const { filePaths, templateDataExtract } = deriveFlowsAndTemplateData(absoluteInput);
  if (filePaths.length === 0) {
    const dirContents = fs.readdirSync(absoluteInput);
    throw new Error(
      'No flow files found in the provided directory. inputDir should contain templateData.json and flow files (.flow-meta.xml or .xml). ' +
        `Resolved path: ${absoluteInput}. Directory contents: ${
          dirContents.length > 0 ? dirContents.join(', ') : '(empty)'
        }`
    );
  }

  const { apexClassNames, customFields } = templateDataExtract;
  const validationContext: ValidationContext = {
    conn: org.getConnection(),
    org,
    flowFilePaths: filePaths,
    apexClassNames: apexClassNames.length > 0 ? apexClassNames : undefined,
    customFields: customFields.length > 0 ? customFields : undefined,
    logJson,
  };
  await runValidationsOrThrow(validationContext, builtInValidators);
  await deployFlows(org, filePaths, { checkOnly: false, logJson });
}

type FlowsAndTemplateResult = { filePaths: string[]; templateDataExtract: TemplateDataExtract };

/** Parse templateData.json content into apexClassNames and customFields (single pass). */
function parseTemplateData(content: string): TemplateDataExtract {
  try {
    const data = JSON.parse(content) as TemplateData;
    const apexClassNames = [
      ...new Set(
        (data.preProcessors ?? [])
          .map((p) => p.apiName)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      ),
    ];
    const objectApiName = data.targetObject?.trim();
    const rawCustomFields: CustomFieldRef[] = objectApiName
      ? (data.sections ?? []).flatMap((section) =>
          (section.attributes ?? [])
            .filter((a) => a.isMappedAnchorField === true && typeof a.apiName === 'string' && a.apiName.endsWith('__c'))
            .map((a) => ({ objectApiName, fieldApiName: a.apiName! }))
        )
      : [];
    const seen = new Set<string>();
    const customFields = rawCustomFields.filter((ref) => {
      const key = `${ref.objectApiName}.${ref.fieldApiName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { apexClassNames, customFields };
  } catch {
    return EMPTY_TEMPLATE;
  }
}

/** Read templateData.json from the directory. */
function readTemplateDataFromDir(dirPath: string): TemplateDataExtract {
  const templatePath = path.join(dirPath, 'templateData.json');
  if (!fs.existsSync(templatePath)) return EMPTY_TEMPLATE;
  try {
    return parseTemplateData(fs.readFileSync(templatePath, 'utf-8'));
  } catch {
    return EMPTY_TEMPLATE;
  }
}

/** inputPath is a directory with templateData.json and flow files (.flow-meta.xml or .xml) directly under it. */
function deriveFlowsAndTemplateData(inputPath: string): FlowsAndTemplateResult {
  const entries = fs.readdirSync(inputPath);
  const files = entries
    .filter((f) => f.toLowerCase().endsWith('.flow-meta.xml') || f.toLowerCase().endsWith('.xml'))
    .map((f) => path.join(inputPath, f));
  return {
    filePaths: files,
    templateDataExtract: readTemplateDataFromDir(inputPath),
  };
}
