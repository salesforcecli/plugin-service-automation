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
