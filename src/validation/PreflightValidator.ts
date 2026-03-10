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

import { Connection, Org, SfError } from '@salesforce/core';
import { InsufficientAccessError } from '../errors.js';

export class PreflightValidator {
  private static readonly PERMISSION_SET_QUERY =
    "SELECT Id, Name FROM PermissionSet WHERE Name='UnifiedCatalogAdminPsl' OR Name='UnifiedCatalogAdmin'";

  public static async validate(connection: Connection, org: Org): Promise<void> {
    const permissionSetResult = await PreflightValidator.queryPermissionSets(connection);
    if (!permissionSetResult.records || permissionSetResult.records.length === 0) {
      throw new InsufficientAccessError('UnifiedCatalogAddOn is missing. Check with your admin.');
    }

    const userId = await PreflightValidator.resolveUserId(connection, org);
    await PreflightValidator.assertUserHasPermissionSet(connection, permissionSetResult.records, userId);
  }

  private static async queryPermissionSets(connection: Connection): Promise<{
    records: Array<{ Id: string; Name: string }>;
  }> {
    try {
      return await connection.query<{ Id: string; Name: string }>(PreflightValidator.PERMISSION_SET_QUERY);
    } catch (error) {
      throw new SfError(
        'Something went wrong while checking org access. Please try again.',
        'OrgAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private static async resolveUserId(connection: Connection, org: Org): Promise<string> {
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
    return userResult.records[0].Id;
  }

  private static async assertUserHasPermissionSet(
    connection: Connection,
    permissionSetRecords: Array<{ Id: string }>,
    userId: string
  ): Promise<void> {
    const permissionSetIds = permissionSetRecords.map((r) => `'${r.Id}'`).join(', ');
    const assignmentQuery = `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId IN (${permissionSetIds}) AND AssigneeId = '${userId}'`;
    let assignmentResult: { records: unknown[] };
    try {
      assignmentResult = await connection.query<{ Id: string; AssigneeId: string }>(assignmentQuery);
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
}
