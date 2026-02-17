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

import { Connection, SfError } from '@salesforce/core';
import { ServiceProcessRetrieveValidationError } from '../../errors.js';
import { ServiceProcessRetrieveRequest, ServiceProcessRecord } from '../../types/types.js';

export async function validateRequest(request: ServiceProcessRetrieveRequest): Promise<void> {
  if (!request.serviceProcessId) {
    throw new ServiceProcessRetrieveValidationError('Service process ID is required');
  }
  await validateServiceProcessExists(request.serviceProcessId, request.connection);
}

async function validateServiceProcessExists(serviceProcessId: string, connection: Connection): Promise<void> {
  try {
    await connection.singleRecordQuery<ServiceProcessRecord>(
      `SELECT Id, Name, UsedFor FROM Product2 WHERE Id = '${serviceProcessId}' AND UsedFor = 'ServiceProcess'`
    );
  } catch (error) {
    if (error instanceof SfError && isSingleRecordQueryError(error as SfError)) {
      throw new ServiceProcessRetrieveValidationError(
        `Service process with ID '${serviceProcessId}' does not exist in the org. Please try again with a valid service process ID.`
      );
    }
    throw new ServiceProcessRetrieveValidationError(
      `Failed to validate existence of service process with ID '${serviceProcessId}'. Please try again.`
    );
  }
}

function isSingleRecordQueryError(error: SfError): boolean {
  return error.name === 'SingleRecordQuery_NoRecords' || error.name === 'SingleRecordQuery_MultipleRecords';
}
