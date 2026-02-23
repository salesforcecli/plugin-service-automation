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
import { Messages, SfError } from '@salesforce/core';
import type { DeployError } from '../../errors.js';
import { DeployService } from '../../services/deployserviceprocess.js';

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
    const org = flags['target-org'];
    const username = org.getUsername();
    if (username) {
      this.log(`Deploying to org: ${username}`);
    }
    this.log(`Input zip file: ${inputZip}`);

    const apiVersion = flags['api-version'];
    const connection = org.getConnection(apiVersion);
    this.log(`Org API version: ${connection.getApiVersion()}`);

    let result;
    try {
      const deployService = new DeployService({
        org: flags['target-org'],
        expectedApiVersion: apiVersion,
        logger: {
          log: (msg: string) => this.log(msg),
          logJson: this.logJson.bind(this),
        },
      });
      result = await deployService.deploy(inputZip);
    } catch (err) {
      const deployErr = err as DeployError;
      if (deployErr?.code) {
        throw new SfError(deployErr.message, deployErr.code);
      }
      throw err;
    }

    this.log('Deploy completed successfully.');
    if (result.contentDocumentId) {
      this.log(`Content Document ID: ${result.contentDocumentId}`);
    }
    if (result.deployedFlows?.length) {
      for (const f of result.deployedFlows) {
        const defId = f.definitionId ? ` (definitionId: ${f.definitionId})` : '';
        this.log(`${f.id} for ${f.fullName}${defId}`);
      }
    }
    return {
      path: inputZip,
      contentDocumentId: result.contentDocumentId,
      deployedFlows: result.deployedFlows,
    };
  }
}
