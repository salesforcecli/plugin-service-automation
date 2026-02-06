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
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.deploy');

export type ServiceProcessDeployResult = {
  path: string;
};

export default class ServiceProcessDeploy extends SfCommand<ServiceProcessDeployResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'input-dir': Flags.directory({
      summary: messages.getMessage('flags.input-dir.summary'),
      char: 'd',
      required: true,
      exists: true,
    }),
  };

  public async run(): Promise<ServiceProcessDeployResult> {
    const { flags } = await this.parse(ServiceProcessDeploy);
    const inputDir = flags['input-dir'];
    this.log(`hello world, directory specified: ${inputDir}`);
    return {
      path: 'hello world',
    };
  }
}
