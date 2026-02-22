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
import {
  FLOW_EXTENSIONS,
  METADATA_FLOWS_RELATIVE_PATH,
  ORG_METADATA_FILENAME,
  TEMPLATE_DATA_FILENAME,
} from '../constants.js';
import type { CustomFieldRef } from '../validation/types.js';

export type TemplateDataExtract = {
  apexClassNames: string[];
  customFields: CustomFieldRef[];
  /** Service process name from templateData.json (name). */
  name?: string;
  /** Intake flow developer name from templateData.json (intakeForm). */
  intakeFlowName?: string;
  /** Fulfillment flow type from templateData.json (fulfillmentFlow.type). */
  fulfillmentFlowType?: 'regular' | 'orchestrator';
};

const EMPTY_TEMPLATE: TemplateDataExtract = { apexClassNames: [], customFields: [] };

function getFlowNameFromTemplate(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'apiName' in value &&
    typeof (value as { apiName: unknown }).apiName === 'string'
  ) {
    return (value as { apiName: string }).apiName.trim();
  }
  return undefined;
}

/** Shape of templateData.json (only fields we read for validation). */
export type TemplateData = {
  targetObject?: string;
  name?: string;
  preProcessors?: Array<{ apiName?: string }>;
  sections?: Array<{
    attributes?: Array<{ apiName?: string; isMappedAnchorField?: boolean }>;
  }>;
  intakeForm?: string | { apiName?: string } | null;
  fulfillmentFlow?: string | { apiName?: string; type?: string } | null;
};

export type FlowsAndTemplateResult = {
  filePaths: string[];
  templateDataExtract: TemplateDataExtract;
};

export class TemplateDataReader {
  /** Parse templateData.json content into apexClassNames and customFields (single pass). */
  public static parseTemplateData(content: string): TemplateDataExtract {
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
              .filter(
                (a) => a.isMappedAnchorField === true && typeof a.apiName === 'string' && a.apiName.endsWith('__c')
              )
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
      const intakeFlowName = getFlowNameFromTemplate(data.intakeForm);

      // Extract fulfillment flow type (orchestrator vs regular)
      let fulfillmentFlowType: 'regular' | 'orchestrator' | undefined;
      if (data.fulfillmentFlow && typeof data.fulfillmentFlow === 'object' && 'type' in data.fulfillmentFlow) {
        fulfillmentFlowType = data.fulfillmentFlow.type === 'FlowOrchestrator' ? 'orchestrator' : 'regular';
      } else if (data.fulfillmentFlow) {
        // If fulfillmentFlow exists but no type, default to regular
        fulfillmentFlowType = 'regular';
      }

      return { apexClassNames, customFields, name, intakeFlowName, fulfillmentFlowType };
    } catch {
      return EMPTY_TEMPLATE;
    }
  }

  /**
   * Read org-metadata.json from the directory and return apiVersion for validation.
   * Accepts apiVersion as string or number (e.g. 65.0). Returns undefined if file is missing or has no version.
   */
  public static readOrgMetadataVersionFromDir(dirPath: string): string | undefined {
    const metadataPath = path.join(dirPath, ORG_METADATA_FILENAME);
    if (!fs.existsSync(metadataPath)) return undefined;
    try {
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as { apiVersion?: string | number };
      const raw = data.apiVersion;
      if (raw == null) return undefined;
      const version =
        typeof raw === 'number'
          ? Number.isInteger(raw)
            ? `${raw}.0`
            : String(raw)
          : typeof raw === 'string'
          ? raw.trim()
          : undefined;
      return version && version.length > 0 ? version : undefined;
    } catch {
      return undefined;
    }
  }

  /** Read templateData.json from the directory. */
  public static readTemplateDataFromDir(dirPath: string): TemplateDataExtract {
    const templatePath = path.join(dirPath, TEMPLATE_DATA_FILENAME);
    if (!fs.existsSync(templatePath)) return EMPTY_TEMPLATE;
    try {
      return TemplateDataReader.parseTemplateData(fs.readFileSync(templatePath, 'utf-8'));
    } catch {
      return EMPTY_TEMPLATE;
    }
  }

  /** Directory with templateData.json at root and flow files under metadata/flows; returns file paths and template extract. */
  public static deriveFlowsAndTemplateData(inputPath: string): FlowsAndTemplateResult {
    const flowDir = path.join(inputPath, METADATA_FLOWS_RELATIVE_PATH);
    const extSet = new Set(FLOW_EXTENSIONS.map((e) => e.toLowerCase()));
    let filePaths: string[] = [];
    if (fs.existsSync(flowDir) && fs.statSync(flowDir).isDirectory()) {
      const entries = fs.readdirSync(flowDir);
      filePaths = entries.filter((f) => extSet.has(path.extname(f).toLowerCase())).map((f) => path.join(flowDir, f));
    }
    return {
      filePaths,
      templateDataExtract: TemplateDataReader.readTemplateDataFromDir(inputPath),
    };
  }
}
