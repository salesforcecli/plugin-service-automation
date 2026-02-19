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
import * as path from 'node:path';
import { FLOW_EXTENSIONS, METADATA_FLOWS_RELATIVE_PATH, TEMPLATE_DATA_FILENAME } from '../constants.js';
import type { CustomFieldRef } from '../validation/types.js';

export type TemplateDataExtract = {
  apexClassNames: string[];
  customFields: CustomFieldRef[];
  /** Service process name from templateData.json (name). */
  name?: string;
};

const EMPTY_TEMPLATE: TemplateDataExtract = { apexClassNames: [], customFields: [] };

/** Shape of templateData.json (only fields we read for validation). */
export type TemplateData = {
  targetObject?: string;
  name?: string;
  preProcessors?: Array<{ apiName?: string }>;
  sections?: Array<{
    attributes?: Array<{ apiName?: string; isMappedAnchorField?: boolean }>;
  }>;
  intakeForm?: string | null;
  fulfillmentFlow?: string | null;
};

export type FlowsAndTemplateResult = {
  filePaths: string[];
  templateDataExtract: TemplateDataExtract;
};

/** Parse templateData.json content into apexClassNames and customFields (single pass). */
export function parseTemplateData(content: string): TemplateDataExtract {
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
    const name = typeof data.name === 'string' ? data.name.trim() || undefined : undefined;
    return { apexClassNames, customFields, name };
  } catch {
    return EMPTY_TEMPLATE;
  }
}

/** Read templateData.json from the directory. */
export function readTemplateDataFromDir(dirPath: string): TemplateDataExtract {
  const templatePath = path.join(dirPath, TEMPLATE_DATA_FILENAME);
  if (!fs.existsSync(templatePath)) return EMPTY_TEMPLATE;
  try {
    return parseTemplateData(fs.readFileSync(templatePath, 'utf-8'));
  } catch {
    return EMPTY_TEMPLATE;
  }
}

/** Directory with templateData.json at root and flow files under metadata/flows; returns file paths and template extract. */
export function deriveFlowsAndTemplateData(inputPath: string): FlowsAndTemplateResult {
  const flowDir = path.join(inputPath, METADATA_FLOWS_RELATIVE_PATH);
  const extSet = new Set(FLOW_EXTENSIONS.map((e) => e.toLowerCase()));
  let filePaths: string[] = [];
  if (fs.existsSync(flowDir) && fs.statSync(flowDir).isDirectory()) {
    const entries = fs.readdirSync(flowDir);
    filePaths = entries.filter((f) => extSet.has(path.extname(f).toLowerCase())).map((f) => path.join(flowDir, f));
  }
  return {
    filePaths,
    templateDataExtract: readTemplateDataFromDir(inputPath),
  };
}
