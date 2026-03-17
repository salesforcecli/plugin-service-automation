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

import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { ServiceProcessRetrieveValidationError } from '../../../src/errors.js';
import type { ServiceProcessRetrieveRequest } from '../../../src/types/types.js';
import {
  RetrieveServiceProcessRequestValidator,
  validateRequest,
} from '../../../src/validation/validators/retrieveServiceProcessRequestValidator.js';

describe('RetrieveServiceProcessRequestValidator', () => {
  function minimalRequest(overrides: Partial<ServiceProcessRetrieveRequest> = {}): ServiceProcessRetrieveRequest {
    return {
      serviceProcessId: '01txx0000008ABC',
      outputDir: '/tmp',
      org: {} as ServiceProcessRetrieveRequest['org'],
      apiVersion: '66.0',
      connection: {} as ServiceProcessRetrieveRequest['connection'],
      orgMetadata: { orgInstanceUrl: 'https://test.salesforce.com', orgId: '00Dxx', apiVersion: '66.0' },
      ...overrides,
    };
  }

  it('throws ServiceProcessRetrieveValidationError when serviceProcessId is missing', async () => {
    const request = minimalRequest({ serviceProcessId: undefined as unknown as string });
    try {
      await RetrieveServiceProcessRequestValidator.validate(request);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ServiceProcessRetrieveValidationError);
      expect((err as Error).message).to.equal('Service Process ID is required');
    }
  });

  it('throws ServiceProcessRetrieveValidationError when serviceProcessId is empty string', async () => {
    const request = minimalRequest({ serviceProcessId: '' });
    try {
      await RetrieveServiceProcessRequestValidator.validate(request);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ServiceProcessRetrieveValidationError);
      expect((err as Error).message).to.equal('Service Process ID is required');
    }
  });

  it('does not throw when serviceProcessId is present and singleRecordQuery succeeds', async () => {
    const request = minimalRequest();
    request.connection = {
      singleRecordQuery: async () => ({ Id: '01txx', Name: 'SP', UsedFor: 'ServiceProcess' }),
    } as unknown as ServiceProcessRetrieveRequest['connection'];
    await RetrieveServiceProcessRequestValidator.validate(request);
  });

  it('throws ServiceProcessRetrieveValidationError when singleRecordQuery returns SingleRecordQuery_NoRecords', async () => {
    const request = minimalRequest();
    const noRecordsError = new SfError('No records', 'SingleRecordQuery_NoRecords');
    request.connection = {
      singleRecordQuery: async () => {
        throw noRecordsError;
      },
    } as unknown as ServiceProcessRetrieveRequest['connection'];
    try {
      await RetrieveServiceProcessRequestValidator.validate(request);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ServiceProcessRetrieveValidationError);
      expect((err as Error).message).to.include('does not exist in the org');
      expect((err as Error).message).to.include('01txx0000008ABC');
    }
  });

  it('throws ServiceProcessRetrieveValidationError when singleRecordQuery returns SingleRecordQuery_MultipleRecords', async () => {
    const request = minimalRequest();
    const multiError = new SfError('Multiple records', 'SingleRecordQuery_MultipleRecords');
    request.connection = {
      singleRecordQuery: async () => {
        throw multiError;
      },
    } as unknown as ServiceProcessRetrieveRequest['connection'];
    try {
      await RetrieveServiceProcessRequestValidator.validate(request);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ServiceProcessRetrieveValidationError);
      expect((err as Error).message).to.include('does not exist in the org');
    }
  });

  it('throws ServiceProcessRetrieveValidationError with generic message when singleRecordQuery throws other error', async () => {
    const request = minimalRequest();
    request.connection = {
      singleRecordQuery: async () => {
        throw new Error('Network error');
      },
    } as unknown as ServiceProcessRetrieveRequest['connection'];
    try {
      await RetrieveServiceProcessRequestValidator.validate(request);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ServiceProcessRetrieveValidationError);
      expect((err as Error).message).to.include('Failed to validate existence');
      expect((err as Error).message).to.include('01txx0000008ABC');
    }
  });

  it('validateRequest calls RetrieveServiceProcessRequestValidator.validate', async () => {
    const request = minimalRequest();
    request.connection = {
      singleRecordQuery: async () => ({ Id: '01txx', Name: 'SP', UsedFor: 'ServiceProcess' }),
    } as unknown as ServiceProcessRetrieveRequest['connection'];
    await validateRequest(request);
  });
});
