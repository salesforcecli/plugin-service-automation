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

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Connection, Messages, Org, SfError } from '@salesforce/core';
import { InsufficientAccessError } from '../../errors.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.list');

export type ServiceProcessListResult = {
  serviceProcesses: ServiceProcessDetail[];
  count: number;
  total: number;
};

export type ServiceProcessDetail = {
  id: string;
  name: string;
  description?: string;
  status: string;
};

export default class ServiceProcessList extends SfCommand<ServiceProcessListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    limit: Flags.integer({
      summary: messages.getMessage('flags.limit.summary'),
      default: 1000,
    }),
  };

  private static async checkAccess(connection: Connection, org: Org): Promise<void> {
    const QUERY1 =
      "SELECT Id, Name FROM PermissionSet WHERE Name='UnifiedCatalogAdminPsl' OR Name='UnifiedCatalogAdmin'";

    let permissionSetResult: { records: Array<{ Id: string }> };
    try {
      permissionSetResult = await connection.query<{ Id: string; Name: string }>(QUERY1);
    } catch (error) {
      throw new SfError(
        'Something went wrong while checking org access. Please try again.',
        'OrgAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    if (!permissionSetResult.records || permissionSetResult.records.length === 0) {
      throw new InsufficientAccessError('UnifiedCatalogAddOn is missing. Check with your admin.');
    }

    const username = org.getUsername();
    const userQuery = `SELECT Id FROM User WHERE Username = '${String(username).replace(/'/g, "''")}' LIMIT 1`;
    let userResult: { records: Array<{ Id: string }> };
    try {
      userResult = await connection.query<{ Id: string }>(userQuery);
    } catch (error) {
      throw new SfError(
        'Something went wrong while checking user access. Please try again.',
        'UserAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    if (!userResult.records?.length) {
      throw new InsufficientAccessError('Permission Set is missing on the context user. Check with your admin.');
    }
    const userId = userResult.records[0].Id;

    const permissionSetIds = permissionSetResult.records.map((r) => `'${r.Id}'`).join(', ');
    const QUERY2 = `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId IN (${permissionSetIds}) AND AssigneeId = '${userId}'`;

    let assignmentResult: { records: unknown[] };
    try {
      assignmentResult = await connection.query<{ Id: string; AssigneeId: string }>(QUERY2);
    } catch (error) {
      throw new SfError(
        'Something went wrong while checking user access. Please try again.',
        'UserAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    if (!assignmentResult.records || assignmentResult.records.length === 0) {
      throw new InsufficientAccessError('Permission Set is missing on the context user. Check with your admin.');
    }
  }

  public async run(): Promise<ServiceProcessListResult> {
    const { flags } = await this.parse(ServiceProcessList);

    const DEFAULT_LIMIT = 1000;
    const limit = flags.limit ?? DEFAULT_LIMIT;

    const connection = flags['target-org'].getConnection(flags['api-version']);

    await ServiceProcessList.checkAccess(connection, flags['target-org']);

    try {
      const count = await connection.query<{ count: number }>(
        "SELECT COUNT() FROM Product2 WHERE UsedFor = 'ServiceProcess'"
      );

      const result = await connection.query<{ Name: string; Id: string; Description?: string; IsActive: boolean }>(
        `SELECT Id, Name, Description, IsActive FROM Product2 WHERE UsedFor = 'ServiceProcess' ORDER BY Name LIMIT ${limit}`
      );

      const serviceProcessList = result.records;

      this.table({
        data: serviceProcessList.map((record) => ({
          'Service Process ID': record.Id,
          'Service Process Name': record.Name,
          Status: record.IsActive ? 'Active' : 'Inactive',
        })),
        overflow: 'wrap',
        title: 'Unified Catalog Service Process',
        titleOptions: {
          bold: true,
          underline: true,
        },
      });

      this.log(`\u2714 Displayed ${result.totalSize} of ${count.totalSize} Service Processes\n`);
      return {
        serviceProcesses: serviceProcessList.map((record) => ({
          id: record.Id,
          name: record.Name,
          description: record.Description ?? undefined,
          status: record.IsActive ? 'Active' : 'Inactive',
        })),
        count: serviceProcessList.length,
        total: count.totalSize,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isUsedForColumnError = errorMessage.includes("No such column 'UsedFor' on entity");
      const isProduct2NotIdentified = errorMessage.includes("sObject type 'Product2' is not supported.");
      if (isUsedForColumnError || isProduct2NotIdentified) {
        throw new InsufficientAccessError('User does not have required permissions.');
      }
      throw new SfError('Something went wrong. Check with your admin.');
    }
  }
}
