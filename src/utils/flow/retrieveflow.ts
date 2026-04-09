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
import { Org } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';

/**
 * Retrieve a single Flow from the source org and save it to given outputDir
 */
export async function retrieveflow(sourceOrg: Org, flowName: string, outputDir: string): Promise<void> {
  const connection = sourceOrg.getConnection();
  const resolvedOutputDir = path.resolve(outputDir);

  // Ensure the output directory exists
  if (!fs.existsSync(resolvedOutputDir)) {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }

  const componentSet = new ComponentSet([
    {
      type: 'Flow',
      fullName: flowName,
    },
  ]);

  const retrieveResult = await componentSet.retrieve({
    usernameOrConnection: connection,
    output: resolvedOutputDir,
    merge: true,
  });

  await retrieveResult.pollStatus();
}
