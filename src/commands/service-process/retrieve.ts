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

import { resolve } from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org, SfError, Logger } from '@salesforce/core';
import { retrieveServiceProcess, type RetrieveResult } from '../../services/retrieveServiceProcessService.js';
import { ServiceProcessRetrieveRequest, OrgMetadata } from '../../types/types.js';
import { RetrieveStages } from '../../utils/retrieveStages.js';
import { PreflightValidator } from '../../validation/PreflightValidator.js';
import { MaxApiVersionValidator } from '../../validation/validators/MaxApiVersionValidator.js';
import { MinApiVersionValidator } from '../../validation/validators/MinApiVersionValidator.js';
import type { ValidationContext } from '../../validation/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.retrieve');

/** JSON output shape. */
export type ServiceProcessRetrieveResult = RetrieveResult;

export default class ServiceProcessRetrieve extends SfCommand<ServiceProcessRetrieveResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'service-process-id': Flags.salesforceId({
      summary: messages.getMessage('flags.service-process-id.summary'),
      char: 'i',
      required: true,
      length: 'both',
      startsWith: '01t',
    }),
    'output-dir': Flags.directory({
      summary: messages.getMessage('flags.output-dir.summary'),
      char: 'd',
    }),
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
  };

  private static serviceProcessRetrieveRequest(flags: Record<string, unknown>): ServiceProcessRetrieveRequest {
    const serviceProcessId = flags['service-process-id'] as string;
    const outputDir = resolve((flags['output-dir'] as string | undefined) ?? 'service-process');
    const org = flags['target-org'] as Org;
    const apiVersion = flags['api-version'] as string | undefined;
    const connection = org.getConnection(apiVersion);

    const orgMetadata: OrgMetadata = {
      orgInstanceUrl: connection.instanceUrl,
      orgId: org.getOrgId(),
      apiVersion: apiVersion ?? connection.getApiVersion(),
    };
    return {
      serviceProcessId,
      outputDir,
      org,
      apiVersion,
      connection,
      orgMetadata,
    };
  }

  public async run(): Promise<ServiceProcessRetrieveResult> {
    const { flags } = await this.parse(ServiceProcessRetrieve);

    // Create child logger for debug output
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const logger = await Logger.child('service-process-retrieve', { runId });

    const request: ServiceProcessRetrieveRequest = ServiceProcessRetrieve.serviceProcessRetrieveRequest(flags);
    logger.info(
      `Retrieve started: serviceProcessId=${flags['service-process-id']}, org=${
        flags['target-org'].getUsername() ?? '(unknown)'
      }, apiVersion=${flags['api-version'] ?? 'default'}, outputDir=${flags['output-dir'] ?? process.cwd()}`
    );
    logger.debug(`Run ID: ${runId}`);
    const apiContext: ValidationContext = {
      conn: request.connection,
      expectedApiVersion: flags['api-version'],
    };
    logger.debug(`Validating API version constraints: requested=${flags['api-version'] ?? 'default'}`);
    const minApiResult = await MinApiVersionValidator.validate(apiContext);
    if (minApiResult.status === 'FAIL' && minApiResult.message) {
      logger.error(`Min API version validation failed: ${minApiResult.message}`);
      throw new SfError(minApiResult.message, 'UnsupportedApiVersion');
    }
    logger.debug(`Min API version validation passed: ${minApiResult.message ?? 'OK'}`);
    const maxApiResult = await MaxApiVersionValidator.validate(apiContext);
    if (maxApiResult.status === 'FAIL' && maxApiResult.message) {
      logger.error(`Max API version validation failed: ${maxApiResult.message}`);
      throw new SfError(maxApiResult.message, 'UnsupportedApiVersion');
    }
    logger.debug(`Max API version validation passed: ${maxApiResult.message ?? 'OK'}`);

    const connection = flags['target-org'].getConnection(flags['api-version']);
    logger.debug('Running preflight validation');
    await PreflightValidator.validate(connection, flags['target-org']);
    logger.debug('Preflight validation passed');

    const orgUrl = request.connection.instanceUrl;
    const retrieveStages = new RetrieveStages(this, 'Service Process Retrieval', orgUrl);
    retrieveStages.start();

    let result;
    try {
      result = await retrieveServiceProcess(request, retrieveStages, logger);
      logger.info(`Retrieve completed successfully: zipFile=${result.zipFilePath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Retrieve failed: ${errorMessage}`);
      logger.debug(`Retrieve failed (raw): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (!this.jsonEnabled()) {
        retrieveStages.stop();
      }
      throw error;
    }
    if (!this.jsonEnabled()) {
      this.log(`ZIP created at: ${result.zipFilePath}\n`);
    }
    return result.result;
  }
}
