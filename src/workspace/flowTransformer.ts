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
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Logger } from '../validation/types.js';

const CREATE_SVC_REQUEST = 'createSvcRequest';

/**
 * Replaces the source-org Service Process id suffix in actionName/nameSegment
 * with the target-org Service Process id for createSvcRequest dynamic invocable actions.
 * Pattern: "spsimpleintake-01txx0000006kgyAAA" -> "spsimpleintake-<targetSpId>"
 */
function replaceActionNameSuffix(value: string, targetServiceProcessId: string): string {
  const lastHyphen = value.lastIndexOf('-');
  if (lastHyphen === -1) return value;
  return `${value.slice(0, lastHyphen + 1)}${targetServiceProcessId}`;
}

/**
 * When serviceProcessName is set, actionName/nameSegment become `<spName>-<targetServiceProcessId>`.
 * Otherwise the existing suffix is replaced with targetServiceProcessId.
 */
function actionNameValue(currentValue: string, targetServiceProcessId: string, serviceProcessName?: string): string {
  if (serviceProcessName != null && serviceProcessName.length > 0) {
    return `${serviceProcessName}-${targetServiceProcessId}`;
  }
  return replaceActionNameSuffix(currentValue, targetServiceProcessId);
}

function visitActionCalls(node: unknown, targetServiceProcessId: string, serviceProcessName?: string): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (obj.actionType === CREATE_SVC_REQUEST) {
    if (typeof obj.actionName === 'string') {
      obj.actionName = actionNameValue(obj.actionName, targetServiceProcessId, serviceProcessName);
    }
    if (typeof obj.nameSegment === 'string') {
      obj.nameSegment = actionNameValue(obj.nameSegment, targetServiceProcessId, serviceProcessName);
    }
    return;
  }

  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        visitActionCalls(item, targetServiceProcessId, serviceProcessName);
      }
    } else if (v && typeof v === 'object') {
      visitActionCalls(v, targetServiceProcessId, serviceProcessName);
    }
  }
}

export type FlowTransformerResult = {
  modified: boolean;
  message: string;
};

/** Parsed flow XML root (Flow element is the document root). */
type FlowParseResult = { Flow?: Record<string, unknown> };

/**
 * Transforms an intake form flow XML file: finds dynamic invocable actions with
 * actionType createSvcRequest and replaces the actionName/nameSegment with
 * serviceProcessName-targetServiceProcessId when serviceProcessName is provided,
 * otherwise replaces only the id suffix.
 */
export class FlowTransformer {
  /**
   * Reads the flow file at flowFilePath, replaces createSvcRequest action
   * actionName/nameSegment with serviceProcessName-targetServiceProcessId
   * (or suffix-only replace when serviceProcessName is not provided), and writes the file back.
   */
  public static transformIntakeFormFlow(
    flowFilePath: string,
    targetServiceProcessId: string,
    serviceProcessName?: string,
    logger?: Logger
  ): FlowTransformerResult {
    const absolutePath = path.resolve(flowFilePath);
    if (!fs.existsSync(absolutePath)) {
      logger?.log?.(`[FlowTransformer] Returning: flow file not found: ${absolutePath}`);
      return { modified: false, message: `Flow file not found: ${absolutePath}` };
    }

    const xml = fs.readFileSync(absolutePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === 'inputParameters' || name === 'fields',
    });
    const parsed = parser.parse(xml) as FlowParseResult;
    const flowRoot = parsed?.Flow;
    if (!flowRoot) {
      logger?.log?.('[FlowTransformer] Returning: invalid flow XML, missing Flow root');
      return { modified: false, message: 'Invalid flow XML: missing Flow root' };
    }

    visitActionCalls(flowRoot, targetServiceProcessId, serviceProcessName);

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
    });
    const output = builder.build(parsed as Record<string, unknown>);
    fs.writeFileSync(absolutePath, output, 'utf-8');

    logger?.log?.('[FlowTransformer] Updated intake form flow (will be deployed to target org):\n' + output);
    logger?.log?.(`[FlowTransformer] Returning: modified=true, targetServiceProcessId=${targetServiceProcessId}`);

    return {
      modified: true,
      message: `Updated createSvcRequest actionName/nameSegment to use Service Process id: ${targetServiceProcessId}`,
    };
  }
}
