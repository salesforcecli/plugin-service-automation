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

import * as path from 'node:path';
import { SfCommand, Flags, StandardColors } from '@salesforce/sf-plugins-core';
import { Logger, Messages, SfError } from '@salesforce/core';
import { DeployError, ValidationError } from '../../errors.js';
import { DeployService } from '../../services/deployserviceprocess.js';
import { DeploymentStages } from '../../utils/deploymentStages.js';
import type { DeploymentSummary } from '../../utils/deploymentStages.js';
import { getFormattedMessageForLog, getValidationErrorMessage } from '../../utils/errorFormatter.js';
import { formatSuccessJsonOutput, formatFailureJsonOutput } from '../../utils/deployJsonFormatter.js';
import type { DeployJsonOutput } from '../../types/jsonOutput.js';
import type { DeploymentContext } from '../../services/deploymentContext.js';
import { PreflightValidator } from '../../validation/PreflightValidator.js';
import { MaxApiVersionValidator } from '../../validation/validators/MaxApiVersionValidator.js';
import { MinApiVersionValidator } from '../../validation/validators/MinApiVersionValidator.js';
import type { ValidationContext } from '../../validation/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.deploy');

export type ServiceProcessDeployResult =
  | DeployJsonOutput['result']
  | {
      path: string;
      serviceProcessId?: string;
    };

export default class ServiceProcessDeploy extends SfCommand<ServiceProcessDeployResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'input-zip': Flags.file({
      summary: messages.getMessage('flags.input-zip.summary'),
      char: 'z',
      required: true,
      exists: true,
      description: messages.getMessage('flags.input-zip.description'),
      parse: (input: string): Promise<string> => {
        if (path.extname(input).toLowerCase() !== '.zip') {
          throw new SfError(`Input file must have a .zip extension: ${input}`, 'InvalidFileType');
        }
        return Promise.resolve(input);
      },
    }),
    'link-intake': Flags.boolean({
      summary: messages.getMessage('flags.link-intake.summary'),
      description: messages.getMessage('flags.link-intake.description'),
      default: false,
    }),
    'link-fulfillment': Flags.boolean({
      summary: messages.getMessage('flags.link-fulfillment.summary'),
      description: messages.getMessage('flags.link-fulfillment.description'),
      default: false,
    }),
  };

  public async run(): Promise<ServiceProcessDeployResult> {
    const { flags } = await this.parse(ServiceProcessDeploy);
    const inputZipRaw = flags['input-zip'];
    const inputZip = typeof inputZipRaw === 'string' ? inputZipRaw : inputZipRaw?.[0];
    if (inputZip == null || inputZip === '') {
      throw new SfError('Required flag input-zip is missing.', 'MissingRequiredFlag');
    }

    const apiVersion = flags['api-version'];
    const connection = flags['target-org'].getConnection(apiVersion);
    const apiContext: ValidationContext = {
      conn: connection,
      expectedApiVersion: flags['api-version'],
    };
    const minApiResult = await MinApiVersionValidator.validate(apiContext);
    if (minApiResult.status === 'FAIL' && minApiResult.message) {
      throw new SfError(minApiResult.message, 'UnsupportedApiVersion');
    }
    const maxApiResult = await MaxApiVersionValidator.validate(apiContext);
    if (maxApiResult.status === 'FAIL' && maxApiResult.message) {
      throw new SfError(maxApiResult.message, 'UnsupportedApiVersion');
    }

    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const logger = await Logger.child('service-process-deploy', { runId });
    await PreflightValidator.validate(connection, flags['target-org'], logger);
    logger.debug('Preflight check passed');
    logger.info(`Deploy started: inputZip=${inputZip}`);
    const deployApiVersion = flags['api-version'];
    const deployStages = new DeploymentStages(
      this,
      'Service Process Deployment',
      flags['target-org'].getConnection(deployApiVersion).instanceUrl
    );
    deployStages.start();
    const startTime = Date.now();

    let result;
    try {
      const deployService = new DeployService({
        org: flags['target-org'],
        expectedApiVersion: flags['api-version'],
        command: this,
        logger,
        deployStages,
        linkIntake: flags['link-intake'],
        linkFulfillment: flags['link-fulfillment'],
      });
      result = await deployService.deploy(inputZip);
      // deployStages.stop() is called inside deploy() for success case
    } catch (err) {
      // Extract context from error if available (attached by DeployService)
      const errorWithContext = err as Error & { context?: DeploymentContext };
      return this.handleDeployFailure(
        err,
        deployStages,
        startTime,
        runId,
        inputZip,
        logger,
        flags['link-intake'],
        flags['link-fulfillment'],
        errorWithContext.context
      );
    }

    logger.info('Deploy completed successfully');

    // JSON mode - structured output only
    if (this.jsonEnabled()) {
      if (!result.context) {
        // Fallback if context is missing (shouldn't happen)
        throw new SfError('Deployment context is missing from result', 'MissingContext');
      }
      // SfCommand wraps with {status, result, warnings}, so return only the result property
      return formatSuccessJsonOutput(result.context, inputZip, flags['link-intake'], flags['link-fulfillment']).result;
    }

    // Default mode - output is already handled by DeploymentStages
    return {
      path: inputZip,
      serviceProcessId: result.context?.targetServiceProcessId,
    };
  }

  /** Build failed summary payload for logSummary (single place for consistency). */
  // eslint-disable-next-line class-methods-use-this -- factory for shared failure summary shape
  private getFailedSummary(durationMs: number): DeploymentSummary {
    return {
      status: 'FAILED',
      serviceProcessName: '-',
      serviceProcessId: '-',
      deployedCount: 0,
      linkedCount: 0,
      duration: durationMs,
    };
  }

  /** Handle deploy failure: log, stop stages, show summary, then return JSON or throw. */
  // eslint-disable-next-line complexity
  private handleDeployFailure(
    err: unknown,
    deployStages: DeploymentStages,
    startTime: number,
    runId: string,
    inputZip: string,
    logger: Logger,
    linkIntake: boolean,
    linkFulfillment: boolean,
    context?: DeploymentContext
  ): ServiceProcessDeployResult {
    const deployErr = err as DeployError;
    const formattedMessage = getFormattedMessageForLog(err);
    logger.error(`Deploy failed [inputZip=${inputZip}]: ${formattedMessage}`);
    logger.debug(`Deploy failed (raw): ${err instanceof Error ? err.message : String(err)}`);
    deployStages.stop();
    const isValidationFailure = err instanceof ValidationError && Boolean(err.failures?.length);
    if (isValidationFailure && !this.jsonEnabled() && err instanceof ValidationError) {
      const msg = getValidationErrorMessage(err);
      const firstNewline = msg.indexOf('\n');
      const header = firstNewline >= 0 ? msg.slice(0, firstNewline) : msg;
      const rest = firstNewline >= 0 ? msg.slice(firstNewline) : '';
      this.log('\n' + StandardColors.error(header) + rest);
    }
    deployStages.logSummary(this.getFailedSummary(Date.now() - startTime));

    // JSON mode - return formatted JSON instead of throwing
    if (this.jsonEnabled()) {
      const error = err instanceof Error ? err : new Error(String(err));
      // SfCommand wraps with {status, result, warnings}, so return only the result property
      return formatFailureJsonOutput(
        inputZip,
        error,
        linkIntake,
        linkFulfillment,
        context,
        context?.rollback?.attempted,
        context?.rollback?.succeeded
      ).result;
    }

    // Non-JSON mode - throw errors as before
    const wasFormattedByDeploymentStages =
      (err instanceof ValidationError && Boolean(err.failures)) ||
      deployErr?.code === 'TemplateDeployFailed' ||
      deployErr?.code === 'FlowDeploymentFailed' ||
      deployErr?.code === 'TestFlowDeploymentFailure' ||
      deployErr?.code === 'FinalizationFailed';
    if (wasFormattedByDeploymentStages || deployErr?.code) {
      const code = deployErr?.code ?? 'ValidationFailed';
      const message = isValidationFailure
        ? 'Deployment validation failed.'
        : code === 'TemplateDeployFailed'
        ? 'Service Process Creation Failed.'
        : (deployErr?.message ?? formattedMessage).replace(/^Validation failed:\s*/i, '');
      if (deployErr?.code === 'MissingMetadataFile') {
        throw new SfError(message, code, [
          'Use `sf service-process retrieve ...` to get a metadata-supported package.',
        ]);
      }
      if (isValidationFailure && err instanceof ValidationError && err.failures?.length) {
        const minApiFailure = err.failures.find((f) => f.name === 'MinApiVersion');
        if (minApiFailure?.status === 'FAIL' && minApiFailure.message) {
          throw new SfError(minApiFailure.message, 'UnsupportedApiVersion');
        }
      }
      throw new SfError(message, code);
    }
    throw err;
  }
}
