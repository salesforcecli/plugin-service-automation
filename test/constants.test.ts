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
import { TEMPLATE_DATA_FILENAME, CONNECT_CATALOG_ITEM_PATH_PREFIX, buildCatalogItemPath } from '../src/constants.js';

describe('constants', () => {
  describe('buildCatalogItemPath', () => {
    it('returns path with CONNECT_CATALOG_ITEM_PATH_PREFIX and given service process id', () => {
      expect(buildCatalogItemPath('01txx0000008ABC')).to.equal(`${CONNECT_CATALOG_ITEM_PATH_PREFIX}/01txx0000008ABC`);
    });
    it('uses exact id string', () => {
      const id = '01tSG00000CuYo5YAF';
      expect(buildCatalogItemPath(id)).to.equal('service-automation/catalog/catalog-item/01tSG00000CuYo5YAF');
    });
  });

  describe('filename constants', () => {
    it('TEMPLATE_DATA_FILENAME is templateData.json', () => {
      expect(TEMPLATE_DATA_FILENAME).to.equal('templateData.json');
    });
  });
});
