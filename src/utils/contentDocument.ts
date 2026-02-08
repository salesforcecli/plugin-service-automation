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
import * as fs from 'node:fs';
import { Connection } from '@salesforce/core';

export type CreateContentDocumentResult = {
  contentVersionId: string;
  contentDocumentId: string;
};

type ContentVersionCreateResponse = { success: boolean; id: string };
type ContentVersionRecord = { ContentDocumentId?: string };

export class ContentDocumentUtil {
  public static async createFromFile(
    connection: Connection,
    filePath: string,
    title?: string
  ): Promise<CreateContentDocumentResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const derivedTitle = title ?? fileName.replace(path.extname(fileName), '');

    const createResp = (await connection.sobject('ContentVersion').create({
      Title: derivedTitle,
      PathOnClient: fileName,
      VersionData: base64Data,
    })) as ContentVersionCreateResponse;

    if (!createResp?.success) {
      throw new Error(`Failed to upload file to ContentVersion: ${JSON.stringify(createResp)}`);
    }

    const contentVersionId: string = createResp.id;
    const cv = (await connection.sobject('ContentVersion').retrieve(contentVersionId)) as ContentVersionRecord;
    const contentDocumentId: string = cv?.ContentDocumentId ?? '';
    if (!contentDocumentId) {
      throw new Error('ContentDocumentId not returned from ContentVersion retrieval.');
    }

    return { contentVersionId, contentDocumentId };
  }
}
