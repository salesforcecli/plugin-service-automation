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
import { ValidationError } from '../../src/errors.js';
import {
  getValidationErrorHeader,
  getValidationErrorMessage,
  formatValidationErrorAsItems,
  formatValidationError,
  getFormattedMessageForLog,
} from '../../src/utils/errorFormatter.js';

describe('errorFormatter', () => {
  describe('getValidationErrorHeader', () => {
    it('returns "Validation failed" when error has no failures', () => {
      const err = new ValidationError('Validation failed');
      expect(getValidationErrorHeader(err)).to.equal('Validation failed');
    });

    it('returns "Duplicate flows found in target org:" when only duplicate flow failures', () => {
      const err = new ValidationError('Failed', [
        { name: 'IntakeFlowUniqueness', status: 'FAIL', message: 'Flow MyFlow already exists' },
      ]);
      expect(getValidationErrorHeader(err)).to.equal('Duplicate flows found in target org:');
    });

    it('returns category-specific header for single category', () => {
      const err = new ValidationError('Failed', [
        { name: 'MinApiVersion', status: 'FAIL', message: 'API version too low' },
      ]);
      expect(getValidationErrorHeader(err)).to.equal('API version issues:');
    });

    it('returns "Validation issues:" when multiple categories', () => {
      const err = new ValidationError('Failed', [
        { name: 'IntakeFlowUniqueness', status: 'FAIL', message: 'Duplicate' },
        { name: 'MinApiVersion', status: 'FAIL', message: 'API version' },
      ]);
      expect(getValidationErrorHeader(err)).to.equal('Validation issues:');
    });
  });

  describe('getValidationErrorMessage', () => {
    it('returns error.message when no failures', () => {
      const err = new ValidationError('Custom message');
      expect(getValidationErrorMessage(err)).to.equal('Custom message');
    });

    it('returns header and bullet lines when failures present', () => {
      const err = new ValidationError('Failed', [{ name: 'MinApiVersion', status: 'FAIL', message: 'v65.0 required' }]);
      const msg = getValidationErrorMessage(err);
      expect(msg).to.include('API version issues');
      expect(msg).to.include('•');
      expect(msg).to.include('v65.0');
    });

    it('includes generic link hint for duplicate flow failures', () => {
      const err = new ValidationError('Failed', [
        { name: 'IntakeFlowUniqueness', status: 'FAIL', message: "Flow 'abcd' already exists in target org" },
      ]);
      const msg = getValidationErrorMessage(err);
      expect(msg).to.include('Duplicate flows found in target org');
      expect(msg).to.include('--link-intake');
      expect(msg).to.include('--link-fulfillment');
    });
  });

  describe('formatValidationErrorAsItems', () => {
    it('returns single fallback item when no failures', () => {
      const err = new ValidationError('Failed');
      expect(formatValidationErrorAsItems(err)).to.deep.equal([{ label: 'Validation failed', value: 'Failed' }]);
    });

    it('returns items for duplicate flow failures', () => {
      const err = new ValidationError('Failed', [
        { name: 'IntakeFlowUniqueness', status: 'FAIL', message: "Flow 'MyFlow' already exists" },
      ]);
      const items = formatValidationErrorAsItems(err);
      expect(items).to.have.lengthOf(2);
      expect(items[0].value).to.include('MyFlow');
      expect(items[1]).to.deep.equal({
        label: 'Tip',
        value: 'Use --link-intake and/or --link-fulfillment to link existing flows.',
      });
    });
  });

  describe('formatValidationError', () => {
    it('returns fallback lines when no failures', () => {
      const err = new ValidationError('Something went wrong');
      const lines = formatValidationError(err, false);
      expect(lines).to.include('Something went wrong');
      expect(lines.join('')).to.include('Deployment aborted');
      expect(lines.join('')).to.include('SF_LOG_LEVEL=debug');
    });

    it('includes debug hint when verbose is false', () => {
      const err = new ValidationError('Failed');
      const lines = formatValidationError(err, false);
      expect(lines.some((l) => l.includes('SF_LOG_LEVEL') || l.includes('DEBUG=sf'))).to.be.true;
    });

    it('returns duplicate flows section when only duplicate flow failures', () => {
      const err = new ValidationError('Failed', [
        { name: 'FulfillmentFlowUniqueness', status: 'FAIL', message: "Flow 'Fulfill' already exists" },
      ]);
      const lines = formatValidationError(err, false);
      expect(lines.some((l) => l.includes('Duplicate flows found'))).to.be.true;
      expect(lines.some((l) => l.includes('--link-intake') && l.includes('--link-fulfillment'))).to.be.true;
      expect(lines.some((l) => l.includes('Deployment aborted'))).to.be.true;
    });
  });

  describe('getFormattedMessageForLog', () => {
    it('returns ValidationError formatted when err is ValidationError with failures', () => {
      const err = new ValidationError('Failed', [
        { name: 'IntakeFlowUniqueness', status: 'FAIL', message: "Flow 'MyFlow' already exists" },
      ]);
      const msg = getFormattedMessageForLog(err);
      expect(msg).to.include('Duplicate flows found');
      expect(msg).to.include('--link-intake');
      expect(msg).to.include('--link-fulfillment');
    });

    it('returns error.message when err is plain Error', () => {
      const err = new Error('Network error');
      expect(getFormattedMessageForLog(err)).to.equal('Network error');
    });

    it('returns String(err) when err is not Error', () => {
      expect(getFormattedMessageForLog('string')).to.equal('string');
    });
  });
});
