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

import type { Connection, Org } from '@salesforce/core';
import { SfError } from '@salesforce/core';
import type { Logger } from '@salesforce/core';
import { InsufficientAccessError } from '../errors.js';
import { formatErrorResponseForLog } from '../utils/safeStringify.js';

export class PreflightValidator {
  private static readonly PERMISSION_SET_QUERY =
    "SELECT Id, Name FROM PermissionSet WHERE Name='UnifiedCatalogAdminPsl' OR Name='UnifiedCatalogAdmin'";

  public static async validate(connection: Connection, org: Org, logger?: Logger): Promise<void> {
    const preflightStart = Date.now();
    logger?.debug('Preflight validation start');

    const permissionSetResult = await PreflightValidator.queryPermissionSets(connection, logger);
    if (!permissionSetResult.records || permissionSetResult.records.length === 0) {
      throw new InsufficientAccessError('UnifiedCatalogAddOn is missing. Check with your admin.');
    }

    const userId = await PreflightValidator.resolveUserId(connection, org, logger);
    await PreflightValidator.assertUserHasPermissionSet(connection, permissionSetResult.records, userId, logger);

    logger?.debug(`Preflight validation completed in ${Date.now() - preflightStart}ms`);
  }

  private static async queryPermissionSets(
    connection: Connection,
    logger?: Logger
  ): Promise<{ records: Array<{ Id: string; Name: string }> }> {
    logger?.debug('Querying permission sets');
    const start = Date.now();
    try {
      const result = await connection.query<{ Id: string; Name: string }>(PreflightValidator.PERMISSION_SET_QUERY);
      logger?.debug(`Query permission sets completed in ${Date.now() - start}ms`);
      logger?.debug(
        `Query permission sets full response: ${JSON.stringify({ recordCount: result.records?.length ?? 0 })}`
      );
      return result;
    } catch (error) {
      logger?.error(`Query permission sets failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Query permission sets error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Query permission sets failed in ${Date.now() - start}ms`);
      throw new SfError(
        'Something went wrong while checking org access. Please try again.',
        'OrgAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private static async resolveUserId(connection: Connection, org: Org, logger?: Logger): Promise<string> {
    logger?.debug('Resolving user id for current org user');
    const start = Date.now();
    const username = org.getUsername();
    const userQuery = `SELECT Id FROM User WHERE Username = '${String(username).replace(/'/g, "''")}' LIMIT 1`;
    try {
      const userResult = await connection.query<{ Id: string }>(userQuery);
      logger?.debug(`Resolve user id completed in ${Date.now() - start}ms`);
      logger?.debug(
        `Resolve user id full response: ${JSON.stringify({ recordCount: userResult.records?.length ?? 0 })}`
      );
      if (!userResult.records?.length) {
        throw new InsufficientAccessError('Permission Set is missing on the context user. Check with your admin.');
      }
      return userResult.records[0].Id;
    } catch (error) {
      if (error instanceof InsufficientAccessError) throw error;
      logger?.error(`Resolve user id failed: ${error instanceof Error ? error.message : String(error)}`);
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Resolve user id error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Resolve user id failed in ${Date.now() - start}ms`);
      throw new SfError(
        'Something went wrong while checking user access. Please try again.',
        'UserAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private static async assertUserHasPermissionSet(
    connection: Connection,
    permissionSetRecords: Array<{ Id: string }>,
    userId: string,
    logger?: Logger
  ): Promise<void> {
    logger?.debug('Checking permission set assignment');
    const start = Date.now();
    const permissionSetIds = permissionSetRecords.map((r) => `'${r.Id}'`).join(', ');
    const assignmentQuery = `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId IN (${permissionSetIds}) AND AssigneeId = '${userId}'`;
    try {
      const assignmentResult = await connection.query<{ Id: string; AssigneeId: string }>(assignmentQuery);
      logger?.debug(`Permission set assignment check completed in ${Date.now() - start}ms`);
      logger?.debug(
        `Permission set assignment full response: ${JSON.stringify({
          recordCount: assignmentResult.records?.length ?? 0,
        })}`
      );
      if (!assignmentResult.records || assignmentResult.records.length === 0) {
        throw new InsufficientAccessError('Permission Set is missing on the context user. Check with your admin.');
      }
    } catch (error) {
      if (error instanceof InsufficientAccessError) throw error;
      logger?.error(
        `Permission set assignment check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      const err = error as Error & { response?: unknown };
      if (logger && err.response !== undefined) {
        logger.debug(`Permission set assignment error full response: ${formatErrorResponseForLog(err.response)}`);
      }
      logger?.debug(`Permission set assignment check failed in ${Date.now() - start}ms`);
      throw new SfError(
        'Something went wrong while checking user access. Please try again.',
        'UserAccessCheckFailure',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
