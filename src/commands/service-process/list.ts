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
import type { ValidationContext } from '../../validation/types.js';

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

    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const logger = await Logger.child('service-process-list', { runId });

    const connection = flags['target-org'].getConnection(flags['api-version']);
    logger.info(
      'List started: org=%s, apiVersion=%s, limit=%d',
      flags['target-org'].getUsername(),
      flags['api-version'] ?? 'default',
      flags.limit
    );
    logger.debug('Run ID: %s', runId);

    const minApiContext: ValidationContext = {
      conn: connection,
      expectedApiVersion: flags['api-version'],
    };
    logger.debug('Validating minimum API version');
    const minApiResult = await MinApiVersionValidator.validate(minApiContext);
    if (minApiResult.status === 'FAIL' && minApiResult.message) {
      logger.error('API version validation failed: %s', minApiResult.message);
      throw new SfError(minApiResult.message, 'UnsupportedApiVersion');
    }
    logger.debug('API version validation passed');

    logger.debug('Running preflight validation');
    await PreflightValidator.validate(connection, flags['target-org']);
    logger.debug('Preflight validation passed');

    try {
      logger.debug('Querying Service Process count');
      const count = await connection.query<{ count: number }>(
        "SELECT COUNT() FROM Product2 WHERE UsedFor = 'ServiceProcess'"
      );
      logger.debug('Total Service Processes in org: %d', count.totalSize);

      logger.debug('Querying Service Process records (limit: %d)', flags.limit);
      const result = await connection.query<{ Name: string; Id: string; Description?: string; IsActive: boolean }>(
        `SELECT Id, Name, Description, IsActive FROM Product2 WHERE UsedFor = 'ServiceProcess' ORDER BY Name LIMIT ${flags.limit}`
      );

      const serviceProcessList = result.records;
      logger.debug('Retrieved %d Service Process record(s)', serviceProcessList.length);

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
      logger.info('List completed successfully: displayed=%d, total=%d', result.totalSize, count.totalSize);

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
      logger.error('List failed: %s', errorMessage);
      logger.debug('List failed (raw): %s', err instanceof Error ? err.stack ?? err.message : String(err));

      const isUsedForColumnError = errorMessage.includes("No such column 'UsedFor' on entity");
      const isProduct2NotIdentified = errorMessage.includes("sObject type 'Product2' is not supported.");
      if (isUsedForColumnError || isProduct2NotIdentified) {
        logger.debug(
          'Permission error detected: %s',
          isUsedForColumnError ? 'UsedFor column missing' : 'Product2 not supported'
        );
        throw new InsufficientAccessError(
          'User does not have required permissions to fetch service processes. Please check with your admin.'
        );
      }
      throw new SfError('Something went wrong while fetching service processes. Please try again.');
    }
  }
}
