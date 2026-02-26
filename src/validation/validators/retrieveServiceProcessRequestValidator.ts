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

import type { Connection } from '@salesforce/core';
import { SfError } from '@salesforce/core';
import { ServiceProcessRetrieveValidationError } from '../../errors.js';
import type { ServiceProcessRetrieveRequest, ServiceProcessRecord } from '../../types/types.js';

const SINGLE_RECORD_QUERY_ERROR_NAMES = ['SingleRecordQuery_NoRecords', 'SingleRecordQuery_MultipleRecords'];

/**
 * Validates a service process retrieve request (service process ID required and exists in org).
 */
export class RetrieveServiceProcessRequestValidator {
  public static async validate(request: ServiceProcessRetrieveRequest): Promise<void> {
    if (!request.serviceProcessId) {
      throw new ServiceProcessRetrieveValidationError('Service Process ID is required');
    }
    await RetrieveServiceProcessRequestValidator.validateServiceProcessExists(
      request.serviceProcessId,
      request.connection
    );
  }

  private static async validateServiceProcessExists(serviceProcessId: string, connection: Connection): Promise<void> {
    try {
      await connection.singleRecordQuery<ServiceProcessRecord>(
        `SELECT Id, Name, UsedFor FROM Product2 WHERE Id = '${serviceProcessId}' AND UsedFor = 'ServiceProcess'`
      );
    } catch (error) {
      const isSingleRecordQueryError = error instanceof SfError && SINGLE_RECORD_QUERY_ERROR_NAMES.includes(error.name);
      if (isSingleRecordQueryError) {
        throw new ServiceProcessRetrieveValidationError(
          `Service Process with ID '${serviceProcessId}' does not exist in the org. Please try again with a valid service process ID.`
        );
      }
      throw new ServiceProcessRetrieveValidationError(
        `Failed to validate existence of service process with ID '${serviceProcessId}'. Please try again.`
      );
    }
  }
}

/** Convenience: validate a retrieve request using the default validator. */
export async function validateRequest(request: ServiceProcessRetrieveRequest): Promise<void> {
  await RetrieveServiceProcessRequestValidator.validate(request);
}
