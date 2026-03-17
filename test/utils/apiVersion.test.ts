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
  MIN_SERVICE_PROCESS_API_VERSION,
  MIN_API_VERSION_TEMPLATE_DEPLOY_SERVICE_PROCESS_NAME,
  isApiVersionAtLeast,
  getUnsupportedApiVersionMessage,
} from '../../src/utils/apiVersion.js';

describe('apiVersion', () => {
  describe('constants', () => {
    it('exports MIN_SERVICE_PROCESS_API_VERSION', () => {
      expect(MIN_SERVICE_PROCESS_API_VERSION).to.equal('67.0');
    });
    it('exports MIN_API_VERSION_TEMPLATE_DEPLOY_SERVICE_PROCESS_NAME', () => {
      expect(MIN_API_VERSION_TEMPLATE_DEPLOY_SERVICE_PROCESS_NAME).to.equal('67.0');
    });
  });

  describe('isApiVersionAtLeast', () => {
    it('returns true when version equals min', () => {
      expect(isApiVersionAtLeast('66.0', '66.0')).to.be.true;
      expect(isApiVersionAtLeast('67.0', '67.0')).to.be.true;
    });
    it('returns true when version is greater than min (same major)', () => {
      expect(isApiVersionAtLeast('66.1', '66.0')).to.be.true;
      expect(isApiVersionAtLeast('67.10', '67.0')).to.be.true;
    });
    it('returns true when version major is greater', () => {
      expect(isApiVersionAtLeast('67.0', '66.0')).to.be.true;
      expect(isApiVersionAtLeast('68.0', '66.0')).to.be.true;
    });
    it('returns false when version minor is less than min (same major)', () => {
      expect(isApiVersionAtLeast('66.0', '66.1')).to.be.false;
      expect(isApiVersionAtLeast('67.0', '67.5')).to.be.false;
    });
    it('returns false when version major is less', () => {
      expect(isApiVersionAtLeast('65.0', '66.0')).to.be.false;
      expect(isApiVersionAtLeast('65.9', '66.0')).to.be.false;
    });
    it('returns false for invalid version format (empty)', () => {
      expect(isApiVersionAtLeast('', '66.0')).to.be.false;
      expect(isApiVersionAtLeast('66.0', '')).to.be.false;
    });
    it('returns false for invalid version format (single segment)', () => {
      expect(isApiVersionAtLeast('66', '66.0')).to.be.false;
      expect(isApiVersionAtLeast('66.0', '66')).to.be.false;
    });
    it('returns false for invalid version format (non-numeric)', () => {
      expect(isApiVersionAtLeast('x.0', '66.0')).to.be.false;
      expect(isApiVersionAtLeast('66.0', '66.x')).to.be.false;
    });
    it('trims whitespace and parses', () => {
      expect(isApiVersionAtLeast('  66.0  ', '66.0')).to.be.true;
      expect(isApiVersionAtLeast('66.0', '  66.0  ')).to.be.true;
    });
  });

  describe('getUnsupportedApiVersionMessage', () => {
    it('returns message referencing --api-version when fromFlag is true', () => {
      const msg = getUnsupportedApiVersionMessage('65.0', true);
      expect(msg).to.include('--api-version');
      expect(msg).to.include(MIN_SERVICE_PROCESS_API_VERSION);
      expect(msg).to.include('65.0');
    });
    it('returns message referencing target org when fromFlag is false', () => {
      const msg = getUnsupportedApiVersionMessage('65.0', false);
      expect(msg).to.include('Target org');
      expect(msg).to.include(MIN_SERVICE_PROCESS_API_VERSION);
      expect(msg).to.include('65.0');
    });
    it('returns message referencing target org when fromFlag is undefined', () => {
      const msg = getUnsupportedApiVersionMessage('64.0');
      expect(msg).to.include('Target org');
      expect(msg).to.include('64.0');
    });
  });
});
