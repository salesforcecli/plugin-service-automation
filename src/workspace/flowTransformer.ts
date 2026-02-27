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
import type { Logger } from '@salesforce/core';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { METADATA_FLOWS_RELATIVE_PATH } from '../constants.js';
import type { DeploymentMetadata } from './deploymentMetadata.js';
import { FlowPathResolver } from './flowPath.js';

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
  private static readonly CREATE_SVC_REQUEST = 'createSvcRequest';

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
      logger?.debug('Flow file not found: %s', absolutePath);
      return { modified: false, message: `Flow file not found: ${absolutePath}` };
    }

    const xml = fs.readFileSync(absolutePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === 'inputParameters' || name === 'fields',
      removeNSPrefix: false, // Preserve namespace prefixes like xsi:nil
      trimValues: false, // Don't trim attribute values
    });
    const parsed = parser.parse(xml) as FlowParseResult;
    const flowRoot = parsed?.Flow;
    if (!flowRoot) {
      logger?.debug('Invalid flow XML, missing Flow root');
      return { modified: false, message: 'Invalid flow XML: missing Flow root' };
    }

    FlowTransformer.visitActionCalls(flowRoot, targetServiceProcessId, serviceProcessName);
    flowRoot.status = 'Draft';

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressBooleanAttributes: false, // Keep boolean attributes like xsi:nil="true"
      suppressUnpairedNode: false, // Don't suppress self-closing tags
      unpairedTags: [], // Allow all tags to be self-closing if needed
      attributeNamePrefix: '@_', // Default prefix for attributes
      textNodeName: '#text', // Default text node name
    });
    const output = builder.build(parsed as Record<string, unknown>);
    fs.writeFileSync(absolutePath, output, 'utf-8');

    logger?.debug('Updated intake form flow for targetServiceProcessId=%s', targetServiceProcessId);

    return {
      modified: true,
      message: `Updated createSvcRequest actionName/nameSegment to use Service Process id: ${targetServiceProcessId}`,
    };
  }

  /**
   * Phase 1: Set all flows to Draft status (before validation).
   * This ensures validators check Draft flows instead of Active flows with runtime errors.
   */
  public static setFlowsToDraft(workspace: string, deploymentMetadata: DeploymentMetadata): void {
    const flowDir = path.join(workspace, METADATA_FLOWS_RELATIVE_PATH);

    // Set intake form to Draft if it needs deployment
    if (deploymentMetadata.intakeFlow?.deploymentIntent === 'deploy') {
      const intakeFlowPath = FlowPathResolver.resolveFlowFilePath(flowDir, deploymentMetadata.intakeFlow.apiName);
      this.setFlowToDraft(intakeFlowPath);
    }

    // Set fulfillment flow to Draft if it needs deployment
    if (deploymentMetadata.fulfillmentFlow?.deploymentIntent === 'deploy') {
      const fulfillmentFlowPath = FlowPathResolver.resolveFlowFilePath(
        flowDir,
        deploymentMetadata.fulfillmentFlow.apiName
      );
      this.setFlowToDraft(fulfillmentFlowPath);
    }
  }

  /**
   * Reads the fulfillment flow file at flowFilePath, sets status to Draft, and writes the file back.
   * Call before deploying the fulfillment flow to the org.
   */
  public static transformFulfillmentFlow(flowFilePath: string, logger?: Logger): FlowTransformerResult {
    const absolutePath = path.resolve(flowFilePath);
    if (!fs.existsSync(absolutePath)) {
      logger?.debug('Fulfillment flow file not found: %s', absolutePath);
      return { modified: false, message: `Fulfillment flow file not found: ${absolutePath}` };
    }

    const xml = fs.readFileSync(absolutePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === 'inputParameters' || name === 'fields',
      removeNSPrefix: false, // Preserve namespace prefixes like xsi:nil
      trimValues: false, // Don't trim attribute values
    });
    const parsed = parser.parse(xml) as FlowParseResult;
    const flowRoot = parsed?.Flow;
    if (!flowRoot) {
      logger?.debug('Fulfillment flow: invalid flow XML, missing Flow root');
      return { modified: false, message: 'Invalid flow XML: missing Flow root' };
    }

    const previousStatus = flowRoot.status;
    flowRoot.status = 'Draft';

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressBooleanAttributes: false, // Keep boolean attributes like xsi:nil="true"
      suppressUnpairedNode: false, // Don't suppress self-closing tags
      unpairedTags: [], // Allow all tags to be self-closing if needed
      attributeNamePrefix: '@_', // Default prefix for attributes
      textNodeName: '#text', // Default text node name
    });
    const output = builder.build(parsed as Record<string, unknown>);
    fs.writeFileSync(absolutePath, output, 'utf-8');

    logger?.debug('Set fulfillment flow status to Draft (ready for deployment).');
    return {
      modified: previousStatus !== 'Draft',
      message: 'Set fulfillment flow status to Draft',
    };
  }

  /**
   * Helper: Set a single flow to Draft status without modifying other fields.
   */
  private static setFlowToDraft(flowFilePath: string): void {
    const absolutePath = path.resolve(flowFilePath);
    if (!fs.existsSync(absolutePath)) {
      return; // Silently skip if file doesn't exist
    }

    const xml = fs.readFileSync(absolutePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === 'inputParameters' || name === 'fields',
      removeNSPrefix: false,
      trimValues: false,
    });
    const parsed = parser.parse(xml) as FlowParseResult;
    const flowRoot = parsed?.Flow;
    if (!flowRoot) {
      return; // Silently skip if invalid XML
    }

    flowRoot.status = 'Draft';

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressBooleanAttributes: false,
      suppressUnpairedNode: false,
      unpairedTags: [],
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });
    const output = builder.build(parsed as Record<string, unknown>);
    fs.writeFileSync(absolutePath, output, 'utf-8');
  }

  /**
   * Replaces the source-org Service Process id suffix in actionName/nameSegment
   * with the target-org Service Process id for createSvcRequest dynamic invocable actions.
   */
  private static replaceActionNameSuffix(value: string, targetServiceProcessId: string): string {
    const lastHyphen = value.lastIndexOf('-');
    if (lastHyphen === -1) return value;
    return `${value.slice(0, lastHyphen + 1)}${targetServiceProcessId}`;
  }

  /**
   * When serviceProcessName is set, actionName/nameSegment become `<spName>-<targetServiceProcessId>`.
   * Otherwise the existing suffix is replaced with targetServiceProcessId.
   */
  private static actionNameValue(
    currentValue: string,
    targetServiceProcessId: string,
    serviceProcessName?: string
  ): string {
    if (serviceProcessName != null && serviceProcessName.length > 0) {
      return `${serviceProcessName}-${targetServiceProcessId}`;
    }
    return FlowTransformer.replaceActionNameSuffix(currentValue, targetServiceProcessId);
  }

  private static visitActionCalls(node: unknown, targetServiceProcessId: string, serviceProcessName?: string): void {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (obj.actionType === FlowTransformer.CREATE_SVC_REQUEST) {
      if (typeof obj.actionName === 'string') {
        obj.actionName = FlowTransformer.actionNameValue(obj.actionName, targetServiceProcessId, serviceProcessName);
      }
      if (typeof obj.nameSegment === 'string') {
        obj.nameSegment = FlowTransformer.actionNameValue(obj.nameSegment, targetServiceProcessId, serviceProcessName);
      }
      return;
    }

    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          FlowTransformer.visitActionCalls(item, targetServiceProcessId, serviceProcessName);
        }
      } else if (v && typeof v === 'object') {
        FlowTransformer.visitActionCalls(v, targetServiceProcessId, serviceProcessName);
      }
    }
  }
}
