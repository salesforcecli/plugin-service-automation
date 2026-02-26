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
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Logger, Messages, SfError } from '@salesforce/core';
import { DeployError, ValidationError } from '../../errors.js';
import { DeployService } from '../../services/deployserviceprocess.js';
import { DeploymentStages } from '../../utils/deploymentStages.js';
import { getFormattedMessageForLog } from '../../utils/errorFormatter.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.deploy');

export type ServiceProcessDeployResult = {
  path: string;
  contentDocumentId?: string;
  /** Deployed flow id, name, and definitionId from Tooling API (when deployment succeeded). */
  deployedFlows?: Array<{ id: string; fullName: string; definitionId?: string }>;
};

export default class ServiceProcessDeploy extends SfCommand<ServiceProcessDeployResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'input-zip': Flags.string({
      summary: messages.getMessage('flags.input-zip.summary'),
      char: 'z',
      required: true,
      description: messages.getMessage('flags.input-zip.description'),
      parse: async (input: string): Promise<string> => {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(input);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code === 'ENOENT') {
            throw new SfError(`Input zip file does not exist: ${input}`, 'InvalidInputPath');
          }
          throw err;
        }
        if (!stat.isFile()) {
          throw new SfError(`Input must be a file, not a directory: ${input}`, 'InvalidNotFile');
        }
        if (path.extname(input).toLowerCase() !== '.zip') {
          throw new SfError(`Input file must have a .zip extension: ${input}`, 'InvalidFileType');
        }
        return input;
      },
    }),
  };

  public async run(): Promise<ServiceProcessDeployResult> {
    const { flags } = await this.parse(ServiceProcessDeploy);
    const inputZipRaw = flags['input-zip'];
    const inputZip = typeof inputZipRaw === 'string' ? inputZipRaw : inputZipRaw?.[0];
    if (inputZip == null || inputZip === '') {
      throw new SfError('Required flag input-zip is missing.', 'MissingRequiredFlag');
    }

    const logger = await Logger.child('service-process-deploy');
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    logger.info(`[${runId}] Deploy started: inputZip=${inputZip}`);
    const apiVersion = flags['api-version'];
    const deployStages = new DeploymentStages(
      this,
      'Service Process Deployment',
      flags['target-org'].getConnection(apiVersion).instanceUrl
    );
    deployStages.start();

    let result;
    try {
      const deployService = new DeployService({
        org: flags['target-org'],
        expectedApiVersion: flags['api-version'],
        command: this,
        logger,
        deployStages,
      });
      result = await deployService.deploy(inputZip);
      // deployStages.stop() is called inside deploy() for success case
    } catch (err) {
      const deployErr = err as DeployError;
      const formattedMessage = getFormattedMessageForLog(err);
      const rawMessage = err instanceof Error ? err.message : String(err);

      // Check if this error was already formatted and displayed by DeploymentStages
      // If failPhase was called with a custom format, the error message would have been shown
      // and MSO stopped, so we should just exit without rethrowing
      const wasFormattedByDeploymentStages =
        (err instanceof ValidationError && Boolean(err.failures)) ||
        deployErr?.code === 'TemplateDeployFailed' ||
        deployErr?.code === 'FlowDeploymentFailed' ||
        deployErr?.code === 'TestFlowDeploymentFailure' ||
        deployErr?.code === 'FinalizationFailed';

      if (wasFormattedByDeploymentStages) {
        logger.error(`[${runId}] Deploy failed [inputZip=${inputZip}]: ${formattedMessage}`);
        logger.debug(`[${runId}] Deploy failed (raw): ${rawMessage}`);
        deployStages.stop();
        const code = deployErr?.code ?? 'ValidationFailed';
        const message = (deployErr?.message ?? formattedMessage).replace(/^Validation failed:\s*/i, '');
        throw new SfError(message, code);
      }

      // For other DeployErrors, stop MSO and rethrow
      if (deployErr?.code) {
        logger.error(`[${runId}] Deploy failed [inputZip=${inputZip}]: ${formattedMessage}`);
        logger.debug(`[${runId}] Deploy failed (raw): ${rawMessage}`);
        deployStages.stop();
        const message = deployErr.message.replace(/^Validation failed:\s*/i, '');
        throw new SfError(message, deployErr.code);
      }

      // Generic errors
      logger.error(`[${runId}] Deploy failed [inputZip=${inputZip}]: ${formattedMessage}`);
      logger.debug(`[${runId}] Deploy failed (raw): ${rawMessage}`);
      deployStages.stop();
      throw err;
    }

    logger.info(`[${runId}] Deploy completed successfully`);

    // JSON mode - structured output only
    if (this.jsonEnabled()) {
      return {
        path: inputZip,
        contentDocumentId: result.contentDocumentId,
        deployedFlows: result.deployedFlows,
      };
    }

    // Default mode - output is already handled by DeploymentStages
    return {
      path: inputZip,
      contentDocumentId: result.contentDocumentId,
      deployedFlows: result.deployedFlows,
    };
  }
}
