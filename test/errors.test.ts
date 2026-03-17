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
import {
  DeployError,
  ValidationError,
  TemplateDataError,
  MissingMetadataFileError,
  ServiceProcessRetrieveError,
  InsufficientAccessError,
  ServiceProcessRetrieveValidationError,
  ServiceProcessDataRetrievalFailure,
} from '../src/errors.js';

describe('errors', () => {
  describe('DeployError', () => {
    it('sets message and default code', () => {
      const err = new DeployError('Something failed');
      expect(err.message).to.equal('Something failed');
      expect(err.code).to.equal('DeployError');
      expect(err.name).to.equal('DeployError');
    });
    it('sets custom code', () => {
      const err = new DeployError('Failed', 'CustomCode');
      expect(err.code).to.equal('CustomCode');
    });
    it('is instanceof Error', () => {
      const err = new DeployError('Test');
      expect(err).to.be.instanceOf(Error);
      expect(err).to.be.instanceOf(DeployError);
    });
  });

  describe('ValidationError', () => {
    it('extends DeployError with ValidationFailed code', () => {
      const err = new ValidationError('Validation failed');
      expect(err.message).to.equal('Validation failed');
      expect(err.code).to.equal('ValidationFailed');
      expect(err.name).to.equal('ValidationError');
      expect(err).to.be.instanceOf(DeployError);
    });
    it('stores failures array', () => {
      const failures = [{ name: 'MinApiVersion', status: 'FAIL' as const, message: 'Too low' }];
      const err = new ValidationError('Validation failed', failures);
      expect(err.failures).to.deep.equal(failures);
    });
  });

  describe('TemplateDataError', () => {
    it('extends DeployError with InvalidTemplateData code', () => {
      const err = new TemplateDataError('Invalid template');
      expect(err.message).to.equal('Invalid template');
      expect(err.code).to.equal('InvalidTemplateData');
      expect(err.name).to.equal('TemplateDataError');
    });
  });

  describe('MissingMetadataFileError', () => {
    it('extends DeployError with MissingMetadataFile code', () => {
      const err = new MissingMetadataFileError('service-process.metadata.json not found');
      expect(err.message).to.include('service-process.metadata.json');
      expect(err.code).to.equal('MissingMetadataFile');
      expect(err.name).to.equal('MissingMetadataFileError');
    });
  });

  describe('ServiceProcessRetrieveError', () => {
    it('sets message and default name', () => {
      const err = new ServiceProcessRetrieveError('Retrieve failed');
      expect(err.message).to.equal('Retrieve failed');
      expect(err.name).to.equal('ServiceProcessRetrieveError');
    });
    it('sets custom name', () => {
      const err = new ServiceProcessRetrieveError('Failed', 'CustomName');
      expect(err.name).to.equal('CustomName');
    });
  });

  describe('InsufficientAccessError', () => {
    it('sets message and default name', () => {
      const err = new InsufficientAccessError('Missing permission');
      expect(err.message).to.equal('Missing permission');
      expect(err.name).to.equal('InsufficientAccessError');
    });
  });

  describe('ServiceProcessRetrieveValidationError', () => {
    it('extends ServiceProcessRetrieveError with ValidationError name', () => {
      const err = new ServiceProcessRetrieveValidationError('Invalid request');
      expect(err.message).to.equal('Invalid request');
      expect(err.name).to.equal('ValidationError');
    });
  });

  describe('ServiceProcessDataRetrievalFailure', () => {
    it('extends ServiceProcessRetrieveError with ServiceProcessDataRetrievalFailure name', () => {
      const err = new ServiceProcessDataRetrievalFailure('API failed');
      expect(err.message).to.equal('API failed');
      expect(err.name).to.equal('ServiceProcessDataRetrievalFailure');
    });
  });
});
