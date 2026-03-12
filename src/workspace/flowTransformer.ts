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

/** Options for DIA visitor: which action type to update (both replace spId suffix with target org Service Process id). */
type DiaVisitOptions = { actionType: 'createSvcRequest' } | { actionType: 'getSvcProcessDetails' };

/**
 * Transforms an intake form flow XML file: finds dynamic invocable actions with
 * actionType createSvcRequest and replaces the spId suffix in actionName/nameSegment with targetServiceProcessId.
 */
export class FlowTransformer {
  private static readonly CREATE_SVC_REQUEST = 'createSvcRequest';
  private static readonly GET_SVC_PROCESS_DETAILS = 'getSvcProcessDetails';

  /**
   * Reads the flow file at flowFilePath, replaces createSvcRequest action
   * actionName/nameSegment spId suffix with targetServiceProcessId, and writes the file back.
   */
  public static transformIntakeFormFlow(
    flowFilePath: string,
    targetServiceProcessId: string,
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

    FlowTransformer.visitIntakeFlowActionCalls(flowRoot, targetServiceProcessId);
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
    const output = String(builder.build(parsed as Record<string, unknown>));
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
   * Reads the fulfillment flow file at flowFilePath, replaces getSvcProcessDetails action
   * actionName/nameSegment spId suffix with targetServiceProcessId (when provided), sets status to Draft,
   * and writes the file back. Call before deploying the fulfillment flow to the org.
   */
  public static transformFulfillmentFlow(
    flowFilePath: string,
    targetServiceProcessId: string | undefined,
    logger?: Logger
  ): FlowTransformerResult {
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

    if (targetServiceProcessId) {
      FlowTransformer.visitFulfillmentActionCalls(flowRoot, targetServiceProcessId);
    }
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
    const output = String(builder.build(parsed as Record<string, unknown>));
    fs.writeFileSync(absolutePath, output, 'utf-8');

    logger?.debug('Set fulfillment flow status to Draft (ready for deployment).');
    if (targetServiceProcessId) {
      logger?.debug(
        'Updated getSvcProcessDetails actionName/nameSegment to use Service Process id: %s',
        targetServiceProcessId
      );
    }
    return {
      modified: true,
      message: targetServiceProcessId
        ? `Updated getSvcProcessDetails actionName/nameSegment to use Service Process id: ${targetServiceProcessId}`
        : 'Set fulfillment flow status to Draft',
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
    const output = String(builder.build(parsed as Record<string, unknown>));
    fs.writeFileSync(absolutePath, output, 'utf-8');
  }

  /**
   * Replaces the source-org Service Process id suffix in actionName/nameSegment
   * with the target-org Service Process id for createSvcRequest and getSvcProcessDetails dynamic invocable actions.
   */
  private static replaceActionNameSuffix(value: string, targetServiceProcessId: string): string {
    const lastHyphen = value.lastIndexOf('-');
    if (lastHyphen === -1) return value;
    return `${value.slice(0, lastHyphen + 1)}${targetServiceProcessId}`;
  }

  /** Recurses flow XML and updates actionName/nameSegment for DIA nodes matching options.actionType. */
  private static visitDiaActionCalls(node: unknown, targetServiceProcessId: string, options: DiaVisitOptions): void {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (options.actionType === 'createSvcRequest' && obj.actionType === FlowTransformer.CREATE_SVC_REQUEST) {
      if (typeof obj.actionName === 'string') {
        obj.actionName = FlowTransformer.replaceActionNameSuffix(obj.actionName, targetServiceProcessId);
      }
      if (typeof obj.nameSegment === 'string') {
        obj.nameSegment = FlowTransformer.replaceActionNameSuffix(obj.nameSegment, targetServiceProcessId);
      }
      return;
    }
    if (options.actionType === 'getSvcProcessDetails' && obj.actionType === FlowTransformer.GET_SVC_PROCESS_DETAILS) {
      if (typeof obj.actionName === 'string') {
        obj.actionName = FlowTransformer.replaceActionNameSuffix(obj.actionName, targetServiceProcessId);
      }
      if (typeof obj.nameSegment === 'string') {
        obj.nameSegment = FlowTransformer.replaceActionNameSuffix(obj.nameSegment, targetServiceProcessId);
      }
      return;
    }

    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          FlowTransformer.visitDiaActionCalls(item, targetServiceProcessId, options);
        }
      } else if (v && typeof v === 'object') {
        FlowTransformer.visitDiaActionCalls(v, targetServiceProcessId, options);
      }
    }
  }

  /** Updates createSvcRequest DIA actionName/nameSegment (spId suffix) in intake flow. */
  private static visitIntakeFlowActionCalls(node: unknown, targetServiceProcessId: string): void {
    FlowTransformer.visitDiaActionCalls(node, targetServiceProcessId, { actionType: 'createSvcRequest' });
  }

  /** Updates getSvcProcessDetails DIA actionName/nameSegment (spId suffix) in fulfillment flow. */
  private static visitFulfillmentActionCalls(node: unknown, targetServiceProcessId: string): void {
    FlowTransformer.visitDiaActionCalls(node, targetServiceProcessId, { actionType: 'getSvcProcessDetails' });
  }
}
