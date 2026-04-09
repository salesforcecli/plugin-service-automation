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
import { Messages, SfError, Logger } from '@salesforce/core';
import { InsufficientAccessError } from '../../errors.js';
import { PreflightValidator } from '../../validation/PreflightValidator.js';
import { MinApiVersionValidator } from '../../validation/validators/MinApiVersionValidator.js';
import { MaxApiVersionValidator } from '../../validation/validators/MaxApiVersionValidator.js';
import type { ValidationContext } from '../../validation/types.js';
import { publishLifecycleMetric } from '../../utils/lifecycleMetrics.js';

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

  public async run(): Promise<ServiceProcessListResult> {
    const { flags } = await this.parse(ServiceProcessList);
    const listStart = Date.now();

    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const logger = await Logger.child('service-process-list', { runId });

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const apiVersion = flags['api-version'] ?? 'default';
    const orgUsername = flags['target-org'].getUsername() ?? 'unknown';
    logger.info(`List started: org=${orgUsername}, apiVersion=${apiVersion}, limit=${flags.limit}`);
    logger.debug(`Run ID: ${runId}`);

    const minApiContext: ValidationContext = {
      conn: connection,
      expectedApiVersion: flags['api-version'],
    };
    logger.debug(`Validating API version constraints: requested=${apiVersion}`);
    const minApiResult = await MinApiVersionValidator.validate(minApiContext);
    if (minApiResult.status === 'FAIL' && minApiResult.message) {
      logger.error(`Min API version validation failed: ${minApiResult.message}`);
      throw new SfError(minApiResult.message, 'UnsupportedApiVersion');
    }
    logger.debug(`Min API version validation passed: ${minApiResult.message ?? 'OK'}`);
    const maxApiResult = await MaxApiVersionValidator.validate(minApiContext);
    if (maxApiResult.status === 'FAIL' && maxApiResult.message) {
      logger.error(`Max API version validation failed: ${maxApiResult.message}`);
      throw new SfError(maxApiResult.message, 'UnsupportedApiVersion');
    }
    logger.debug(`Max API version validation passed: ${maxApiResult.message ?? 'OK'}`);

    logger.debug('Running preflight validation');
    await PreflightValidator.validate(connection, flags['target-org']);
    logger.debug('Preflight validation passed');

    try {
      logger.debug('Querying Service Process count');
      const countQueryStart = Date.now();
      const count = await connection.query<{ count: number }>(
        "SELECT COUNT() FROM Product2 WHERE UsedFor = 'ServiceProcess'"
      );
      await publishLifecycleMetric(logger, 'spListQuery', {
        runId,
        queryType: 'count',
        stepExecutionDurationMs: Date.now() - countQueryStart,
        limit: flags.limit,
        status: 'SUCCESS',
      });
      logger.debug(`Total Service Processes in org: ${count.totalSize}`);

      logger.debug(`Querying Service Process records (limit: ${flags.limit})`);
      const recordsQueryStart = Date.now();
      const result = await connection.query<{ Name: string; Id: string; Description?: string; IsActive: boolean }>(
        `SELECT Id, Name, Description, IsActive FROM Product2 WHERE UsedFor = 'ServiceProcess' ORDER BY Name LIMIT ${flags.limit}`
      );
      await publishLifecycleMetric(logger, 'spListQuery', {
        runId,
        queryType: 'records',
        stepExecutionDurationMs: Date.now() - recordsQueryStart,
        limit: flags.limit,
        resultCount: result.records.length,
        status: 'SUCCESS',
      });

      const serviceProcessList = result.records;
      logger.debug(`Retrieved ${serviceProcessList.length} Service Process record(s)`);

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
      logger.info(`List completed successfully: displayed=${result.totalSize}, total=${count.totalSize}`);
      await publishLifecycleMetric(logger, 'spListPerformance', {
        runId,
        stepExecutionDurationMs: Date.now() - listStart,
        displayedCount: result.totalSize,
        totalCount: count.totalSize,
        status: 'SUCCESS',
      });

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
      logger.error(`List failed: ${errorMessage}`);
      logger.debug(`List failed (raw): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      await publishLifecycleMetric(logger, 'spListPerformance', {
        runId,
        stepExecutionDurationMs: Date.now() - listStart,
        status: 'FAILURE',
        errorTrigger: errorMessage,
      });

      const isUsedForColumnError = errorMessage.includes("No such column 'UsedFor' on entity");
      const isProduct2NotIdentified = errorMessage.includes("sObject type 'Product2' is not supported.");
      if (isUsedForColumnError || isProduct2NotIdentified) {
        logger.debug(
          `Permission error detected: ${isUsedForColumnError ? 'UsedFor column missing' : 'Product2 not supported'}`
        );
        throw new InsufficientAccessError(
          'User does not have required permissions to fetch service processes. Please check with your admin.'
        );
      }
      throw new SfError('Something went wrong while fetching service processes. Please try again.');
    }
  }
}
