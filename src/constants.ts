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

/** Filename for Service Process template metadata in workspace. */
export const TEMPLATE_DATA_FILENAME = 'templateData.json';

/** Filename for org metadata in workspace (e.g. from retrieve); contains apiVersion for validation. */
export const ORG_METADATA_FILENAME = 'org-metadata.json';

/** Filename for combined service process metadata (org + deployment) written by retrieve and read by deploy. */
export const SERVICE_PROCESS_METADATA_FILENAME = 'service-process.metadata.json';

/** Relative path under workspace root where flow files live: metadata/flows. */
export const METADATA_FLOWS_RELATIVE_PATH = 'metadata/flows';

/** Flow file extensions used for deployment (flow-meta.xml and .xml). */
export const FLOW_EXTENSIONS = ['.flow-meta.xml', '.xml'] as const;

/** Flow definition file extension (.flow). */
export const FLOW_EXTENSION_FLOW = '.flow';

/** Connect API path prefix for template deploy (without content document id). */
export const CONNECT_TEMPLATE_DEPLOY_PATH_PREFIX = 'service-automation/template/deploy';

/** Connect API path prefix for catalog item (without service process id). */
export const CONNECT_CATALOG_ITEM_PATH_PREFIX = 'service-automation/catalog/catalog-item';

/** Build Connect API path for a catalog item by service process id. */
export function buildCatalogItemPath(serviceProcessId: string): string {
  return `${CONNECT_CATALOG_ITEM_PATH_PREFIX}/${serviceProcessId}`;
}

/** Temp directory prefix for extracted workspace. */
export const TEMP_WORKSPACE_PREFIX = 'service-process-deploy-';

/** Temp file prefix for upload zip. */
export const TEMP_UPLOAD_ZIP_PREFIX = 'service-process-upload-';
