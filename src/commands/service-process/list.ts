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
const messages = Messages.loadMessages('@salesforce/plugin-service-automation', 'service-process.list');

export type ServiceProcessListResult = {
  path: string;
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
      default: 10,
    }),
  };

  public async run(): Promise<ServiceProcessListResult> {
    const { flags } = await this.parse(ServiceProcessList);

    const name = flags.limit ?? 10;
    this.log(`hello ${name} from src/commands/service-process/list.ts`);
    return {
      path: 'src/commands/service-process/list.ts',
    };
  }
}
