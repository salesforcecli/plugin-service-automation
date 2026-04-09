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

import type { Connection } from '@salesforce/core';

/** Escape a string for use in a SOQL IN clause (single quotes). */
function escapeSoqlString(value: string): string {
  return value.replace(/'/g, "\\'");
}

type FlowDefinitionRecord = { Id: string; DeveloperName: string };

export type FlowDeploymentIntent = {
  apiName: string;
  namespace: string | null;
  deploymentIntent: 'link' | 'deploy';
  flowType: 'regular' | 'orchestrator';
};

/**
 * Helper function to determine if a flow is from a managed package by querying FlowDefinitionView.
 * Returns true if InstalledPackageName exists (managed package), false if null (user-created).
 */
async function isFlowFromManagedPackage(
  connection: Connection,
  apiName: string,
  namespace: string | null
): Promise<boolean> {
  const quoted = `'${escapeSoqlString(apiName)}'`;
  let soql = `SELECT InstalledPackageName FROM FlowDefinitionView WHERE ApiName = ${quoted}`;

  if (namespace === null) {
    soql += ' AND NamespacePrefix = null';
  } else {
    const quotedNs = `'${escapeSoqlString(namespace)}'`;
    soql += ` AND NamespacePrefix = ${quotedNs}`;
  }

  soql += ' LIMIT 1';

  const result = await connection.query(soql);
  const flowDef = result.records[0];

  return flowDef?.InstalledPackageName != null;
}

/**
 * Query Tooling API FlowDefinition by developer names and return a map of fullName -> definition Id.
 * Uses DeveloperName to match the flow API names returned from deploy.
 */
export async function getFlowDefinitionIds(connection: Connection, fullNames: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (fullNames.length === 0) return map;

  const quoted = fullNames.map((n) => `'${escapeSoqlString(n)}'`).join(',');
  const soql = `SELECT Id, DeveloperName FROM FlowDefinition WHERE DeveloperName IN (${quoted})`;
  const result = await connection.tooling.query<FlowDefinitionRecord>(soql);
  const records = result.records ?? [];
  for (const r of records) {
    if (r.DeveloperName && r.Id) {
      map.set(r.DeveloperName, r.Id);
    }
  }
  return map;
}

/**
 * Returns true if a flow with the given ApiName exists in the org.
 *
 * For regular flows, queries FlowRecord (includes user-created, packaged, and file-based flows).
 * For orchestrator flows, queries FlowOrchestration (orchestrator flows don't exist in FlowRecord).
 *
 * @param connection Salesforce connection
 * @param apiName Flow API name
 * @param namespace Optional namespace filter. If provided, queries for exact namespace match.
 * If null, queries for flows with no namespace.
 * If undefined (omitted), queries without namespace filter (backward compat).
 * @param flowType Flow type - 'regular' or 'orchestrator' (default: 'regular')
 */
export async function flowExistsByName(
  connection: Connection,
  apiName: string,
  namespace?: string | null,
  flowType: 'regular' | 'orchestrator' = 'regular'
): Promise<boolean> {
  if (!apiName || apiName.trim().length === 0) return false;
  const quoted = `'${escapeSoqlString(apiName)}'`;

  // Query different tables based on flow type
  const tableName = flowType === 'orchestrator' ? 'FlowOrchestration' : 'FlowRecord';
  let soql = `SELECT ApiName FROM ${tableName} WHERE ApiName = ${quoted}`;

  // Add namespace filter if parameter is provided (including explicit null)
  if (namespace !== undefined) {
    if (namespace === null) {
      soql += ' AND NamespacePrefix = null';
    } else {
      const quotedNs = `'${escapeSoqlString(namespace)}'`;
      soql += ` AND NamespacePrefix = ${quotedNs}`;
    }
  }

  soql += ' LIMIT 1';

  const result = await connection.query(soql);
  const exists = (result.records?.length ?? 0) > 0;
  return exists;
}

/**
 * Determines deployment intent by querying flow metadata using ApiName and NamespacePrefix.
 *
 * For regular flows:
 * 1. Query FlowRecord by ApiName + NamespacePrefix using connection.query()
 * - Includes FlowDefinition relationship field to detect file-based vs user-created flows
 * 2. If FlowDefinition is NULL → file-based flow (Salesforce core shipped) → LINK
 * 3. If FlowDefinition exists, query FlowDefinitionView for InstalledPackageName:
 * - InstalledPackageName present → managed package flow → LINK
 * - InstalledPackageName null → user-created flow → DEPLOY
 *
 * For orchestrator flows:
 * 1. Query FlowOrchestration by ApiName + NamespacePrefix using connection.query()
 * - Includes OrchestrationDefinitionId to detect file-based vs user-created flows
 * 2. If OrchestrationDefinitionId is NULL → file-based → LINK
 * 3. If OrchestrationDefinitionId exists, query FlowDefinitionView for InstalledPackageName:
 * - InstalledPackageName present → managed package → LINK
 * - InstalledPackageName null → user-created → DEPLOY
 *
 * Note: Uses connection.query() (not tooling API) because FlowRecord, FlowOrchestration,
 * and FlowDefinitionView are only accessible via standard SOQL API.
 *
 * @param connection Salesforce connection
 * @param apiName Flow API name (from Service Process)
 * @param namespace Flow namespace (from Service Process)
 * @param flowType 'regular' or 'orchestrator'
 * @returns FlowDeploymentIntent with deployment intent, or null if flow not found
 */
export async function getFlowDeploymentIntentByName(
  connection: Connection,
  apiName: string,
  namespace: string | null,
  flowType: 'regular' | 'orchestrator'
): Promise<FlowDeploymentIntent | null> {
  if (!apiName || apiName.trim().length === 0) {
    return null;
  }

  const quoted = `'${escapeSoqlString(apiName)}'`;

  if (flowType === 'regular') {
    // Query FlowRecord by ApiName and NamespacePrefix, include DefinitionId
    let soql = `SELECT ApiName, NamespacePrefix, FlowDefinition FROM FlowRecord WHERE ApiName = ${quoted}`;

    if (namespace === null) {
      soql += ' AND NamespacePrefix = null';
    } else {
      const quotedNs = `'${escapeSoqlString(namespace)}'`;
      soql += ` AND NamespacePrefix = ${quotedNs}`;
    }

    soql += ' LIMIT 1';

    const result = await connection.query(soql);

    if (!result.records || result.records.length === 0) {
      return null; // Flow not found
    }

    const flowRecord = result.records[0] as {
      ApiName: string;
      NamespacePrefix: string | null;
      FlowDefinition?: unknown;
    };
    const flowApiName = flowRecord.ApiName;
    const flowNamespace = flowRecord.NamespacePrefix ?? null;

    // If no FlowDefinition, it's file-based (Salesforce core shipped)
    if (!flowRecord.FlowDefinition) {
      return {
        apiName: flowApiName,
        namespace: flowNamespace,
        deploymentIntent: 'link',
        flowType: 'regular',
      };
    }

    // Check if flow is from a managed package
    const isPackaged = await isFlowFromManagedPackage(connection, flowApiName, flowNamespace);
    const deploymentIntent = isPackaged ? 'link' : 'deploy';

    return {
      apiName: flowApiName,
      namespace: flowNamespace,
      deploymentIntent,
      flowType: 'regular',
    };
  } else {
    // flowType === 'orchestrator'
    // Query FlowOrchestration by ApiName and NamespacePrefix, include OrchestrationDefinitionId
    let soql = `SELECT ApiName, NamespacePrefix, OrchestrationDefinition FROM FlowOrchestration WHERE ApiName = ${quoted}`;

    if (namespace === null) {
      soql += ' AND NamespacePrefix = null';
    } else {
      const quotedNs = `'${escapeSoqlString(namespace)}'`;
      soql += ` AND NamespacePrefix = ${quotedNs}`;
    }

    soql += ' LIMIT 1';

    const result = await connection.query(soql);

    if (!result.records || result.records.length === 0) {
      return null; // Flow not found
    }

    const flowOrch = result.records[0] as {
      ApiName: string;
      NamespacePrefix: string | null;
      OrchestrationDefinition?: unknown;
    };
    const flowApiName = flowOrch.ApiName;
    const flowNamespace = flowOrch.NamespacePrefix ?? null;

    // If no OrchestrationDefinition, it's file-based (Salesforce core shipped)
    if (!flowOrch.OrchestrationDefinition) {
      return {
        apiName: flowApiName,
        namespace: flowNamespace,
        deploymentIntent: 'link',
        flowType: 'orchestrator',
      };
    }

    // Check if flow is from a managed package
    const isPackaged = await isFlowFromManagedPackage(connection, flowApiName, flowNamespace);
    const deploymentIntent = isPackaged ? 'link' : 'deploy';

    return {
      apiName: flowApiName,
      namespace: flowNamespace,
      deploymentIntent,
      flowType: 'orchestrator',
    };
  }
}

/**
 * Retrieves the org's namespace prefix from the Organization object.
 *
 * Developer Edition orgs and orgs with managed packages may have a NamespacePrefix.
 * Most orgs will return null (no namespace).
 *
 * @param connection Salesforce connection
 * @returns The org's namespace prefix, or null if no namespace configured
 */
export async function getOrgNamespace(connection: Connection): Promise<string | null> {
  try {
    const query = 'SELECT NamespacePrefix FROM Organization';
    const result = await connection.query<{ NamespacePrefix: string | null }>(query);

    if (result.records && result.records.length > 0) {
      return result.records[0].NamespacePrefix;
    }
    return null;
  } catch (error) {
    throw new Error(`Failed to retrieve org namespace: ${error instanceof Error ? error.message : String(error)}`);
  }
}
