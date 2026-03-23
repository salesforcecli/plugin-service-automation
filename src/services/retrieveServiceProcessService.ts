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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Connection, SfError, type Logger } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import JSZip from 'jszip';
import { ServiceProcessDataRetrievalFailure } from '../errors.js';
import {
  MIN_SERVICE_PROCESS_API_VERSION,
  isApiVersionAtLeast,
  getUnsupportedApiVersionMessage,
} from '../utils/apiVersion.js';
import { validateRequest } from '../validation/validators/retrieveServiceProcessRequestValidator.js';
import { ServiceProcessRetrieveRequest } from '../types/types.js';
import { getFlowDeploymentIntentByName } from '../utils/flow/flowMetadata.js';
import type { DeploymentMetadata } from '../workspace/deploymentMetadata.js';
import type { RetrieveStages } from '../utils/retrieveStages.js';
import {
  createZipFile,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  ensureDirectoryExists,
} from './fileSystemService.js';

const SUPPORTED_SERVICE_PROCESS_ELEMENTS = new Set([
  'name',
  'description',
  'usedFor',
  'targetObject',
  'isActive',
  'displayUrl',
  'sections',
  'contextDefinitionDevNameOrId',
  'intakeForm',
  'fulfillmentFlow',
  'preProcessors',
]);

function filteredServiceProcessData(serviceProcessData: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(serviceProcessData)) {
    if (SUPPORTED_SERVICE_PROCESS_ELEMENTS.has(key)) {
      filtered[key] = serviceProcessData[key];
    }
  }
  return filtered;
}

export async function retrieveServiceProcessDetails(
  serviceProcessId: string,
  connection: Connection,
  apiVersion?: string,
  logger?: Logger
): Promise<Record<string, unknown>> {
  const url = apiVersion
    ? `/services/data/v${apiVersion}/connect/service-automation/service-process/${serviceProcessId}`
    : `/connect/service-automation/service-process/${serviceProcessId}`;

  logger?.debug('Fetching Service Process details from API: %s', url);

  try {
    const serviceProcessData = await connection.requestGet<Record<string, unknown>>(url);
    logger?.debug('Service Process API response received: %d fields', Object.keys(serviceProcessData).length);
    const filtered = filteredServiceProcessData(serviceProcessData);
    logger?.debug('Filtered Service Process data: %d supported fields', Object.keys(filtered).length);
    return filtered;
  } catch (error) {
    const err = error as { errorCode?: string; data?: { errorCode?: string } };
    const errorCode = err?.errorCode ?? err?.data?.errorCode;
    logger?.error('Service Process data retrieval failed: errorCode=%s', errorCode ?? 'unknown');
    if (errorCode === 'FUNCTIONALITY_NOT_ENABLED') {
      throw new SfError(
        'User does not have the required permissions to use this feature. Check with your admin.',
        'FUNCTIONALITY_NOT_ENABLED'
      );
    }
    throw new ServiceProcessDataRetrievalFailure(
      `Failed to retrieve service process data from the org for service process ID '${serviceProcessId}'. Please try again.`
    );
  }
}

export type ExtractDependenciesResult = {
  deps: Record<string, unknown>;
  flowMetadata: Array<{ apiName: string; xmlContent: string }>;
};

export async function extractServiceProcessDependencies(
  serviceProcessData: Record<string, unknown>,
  connection: Connection,
  outputDir: string,
  logger?: Logger
): Promise<ExtractDependenciesResult> {
  const serviceProcessDeps: Record<string, unknown> = {};
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;

  const flowApiNames: string[] = [];

  if (intakeForm) {
    const intakeFormType = (intakeForm.type as string | undefined) ?? 'Flow';
    logger?.debug('Intake form type: %s', intakeFormType);
    if (intakeFormType === 'Flow') {
      const intakeFormApiName = intakeForm.apiName as string | undefined;
      const intakeFormNamespacePrefix = intakeForm.namespacePrefix as string | undefined;

      if (intakeFormApiName && !intakeFormNamespacePrefix) {
        flowApiNames.push(intakeFormApiName);
        logger?.debug('Added intake flow to retrieve: %s', intakeFormApiName);
      } else if (intakeFormNamespacePrefix) {
        logger?.debug(
          'Skipping namespaced intake flow: %s (namespace: %s)',
          intakeFormApiName,
          intakeFormNamespacePrefix
        );
      }
    }
    // Omniscript intake form is not fetched; user is notified via getRetrievingMetadataLines
  }

  if (fulfillmentFlow) {
    const fulfillmentFlowApiName = fulfillmentFlow.apiName as string | undefined;
    const fulfillmentFlowNamespacePrefix = fulfillmentFlow.namespacePrefix as string | undefined;

    if (fulfillmentFlowApiName && !fulfillmentFlowNamespacePrefix) {
      flowApiNames.push(fulfillmentFlowApiName);
      logger?.debug('Added fulfillment flow to retrieve: %s', fulfillmentFlowApiName);
    } else if (fulfillmentFlowNamespacePrefix) {
      logger?.debug(
        'Skipping namespaced fulfillment flow: %s (namespace: %s)',
        fulfillmentFlowApiName,
        fulfillmentFlowNamespacePrefix
      );
    }
  }

  const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];

  if (flowApiNames.length > 0) {
    logger?.info('Fetching %d flow(s): %s', flowApiNames.length, flowApiNames.join(', '));
    const fetched = await fetchFlows(flowApiNames, connection, outputDir, logger);
    flowMetadata.push(...fetched);

    for (const flow of fetched) {
      if (intakeForm && flow.apiName === (intakeForm.apiName as string)) {
        serviceProcessDeps.intakeForm = flow.xmlContent;
        logger?.debug('Stored intake form metadata for: %s', flow.apiName);
      }
      if (fulfillmentFlow && flow.apiName === (fulfillmentFlow.apiName as string)) {
        serviceProcessDeps.fulfillmentForm = flow.xmlContent;
        logger?.debug('Stored fulfillment flow metadata for: %s', flow.apiName);
      }
    }
  } else {
    logger?.debug('No flows to retrieve (all flows are namespaced or missing)');
  }

  return { deps: serviceProcessDeps, flowMetadata };
}

/**
 * Derive counts for "Resolving related components" from service process API data.
 */
function getResolvingCounts(serviceProcessData: Record<string, unknown>): {
  preprocessors: number;
  intakeFlow: number;
  fulfillmentFlow: number;
} {
  const preProcessors = serviceProcessData.preProcessors;
  const preprocessors = Array.isArray(preProcessors) ? preProcessors.length : 0;
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const intakeFormType = intakeForm != null ? (intakeForm.type as string) ?? 'Flow' : undefined;
  const intakeFlow = intakeForm != null && intakeFormType === 'Flow' ? 1 : 0;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow != null ? 1 : 0;
  return { preprocessors, intakeFlow, fulfillmentFlow };
}

/**
 * Build display lines for "Retrieving metadata" (flow names and preprocessor names).
 */
function getRetrievingMetadataLines(
  serviceProcessData: Record<string, unknown>,
  flowMetadata: Array<{ apiName: string }>
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;

  if (intakeForm) {
    const intakeFormType = (intakeForm.type as string | undefined) ?? 'Flow';
    if (intakeFormType === 'Omniscript') {
      lines.push({ label: 'Intake Form', value: 'Omniscript (skipped - not fetched)' });
    } else {
      const matched = flowMetadata.find((f) => f.apiName === (intakeForm.apiName as string));
      if (matched) {
        lines.push({ label: 'Intake Flow', value: matched.apiName });
      }
    }
  }

  for (const flow of flowMetadata) {
    if (fulfillmentFlow && flow.apiName === (fulfillmentFlow.apiName as string)) {
      lines.push({ label: 'Fulfillment Flow', value: flow.apiName });
    }
  }

  const preProcessors = serviceProcessData.preProcessors;
  if (Array.isArray(preProcessors)) {
    for (const pp of preProcessors) {
      const name =
        (pp as { devNameOrId?: string }).devNameOrId ??
        (pp as { apiName?: string }).apiName ??
        (pp as { name?: string }).name ??
        'Preprocessor';
      lines.push({ label: 'Preprocessor', value: String(name) });
    }
  }

  return lines;
}

export async function fetchFlows(
  flowApiNames: string[],
  connection: Connection,
  outputDir: string,
  logger?: Logger
): Promise<Array<{ apiName: string; xmlContent: string }>> {
  if (!flowApiNames || flowApiNames.length === 0) {
    return [];
  }

  const tempRetrieveDir = join(outputDir, '.temp');
  logger?.debug('Creating temporary directory for flow retrieval: %s', tempRetrieveDir);
  await createTemporaryDirectory(tempRetrieveDir);

  try {
    const components = flowApiNames.map((apiName) => ({
      fullName: apiName,
      type: 'Flow',
    }));
    const componentSet = new ComponentSet(components);
    logger?.debug('Retrieving %d flow(s) via Metadata API', flowApiNames.length);
    const retrieveResult = await componentSet.retrieve({
      usernameOrConnection: connection,
      output: tempRetrieveDir,
      merge: true,
    });
    await retrieveResult.pollStatus();
    logger?.debug('Flow retrieval completed');

    const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];

    for (const apiName of flowApiNames) {
      const flowXmlPath = join(tempRetrieveDir, 'main', 'default', 'flows', `${apiName}.flow-meta.xml`);

      if (existsSync(flowXmlPath)) {
        // eslint-disable-next-line no-await-in-loop
        const xmlContent = await readFile(flowXmlPath, 'utf-8');
        flowMetadata.push({ apiName, xmlContent });
        logger?.debug('Flow metadata read: %s (%d bytes)', apiName, xmlContent.length);
      } else {
        logger?.error('Flow XML file not found: %s at %s', apiName, flowXmlPath);
        throw new Error(`Flow XML file not found for '${apiName}' at: ${flowXmlPath}`);
      }
    }
    return flowMetadata;
  } catch (error) {
    logger?.error('Flow fetch failed: %s', error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to fetch flow metadata: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    logger?.debug('Cleaning up temporary directory: %s', tempRetrieveDir);
    await removeTemporaryDirectory(tempRetrieveDir, true);
  }
}

async function generateDeploymentMetadata(
  serviceProcessData: Record<string, unknown>,
  connection: Connection,
  logger?: Logger
): Promise<DeploymentMetadata> {
  const deploymentMetadata: DeploymentMetadata = {
    version: '1.0',
  };

  // Process intake flow (only when type is Flow; Omniscript is not deployed as a flow)
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const intakeFormType = intakeForm != null ? (intakeForm.type as string) ?? 'Flow' : undefined;
  if (intakeForm?.apiName && intakeFormType === 'Flow') {
    const flowType = 'regular'; // Intake flows are always regular
    const apiName = intakeForm.apiName as string;
    const namespace = (intakeForm.namespacePrefix as string | null) ?? null;

    logger?.debug('Determining deployment intent for intake flow: %s (namespace: %s)', apiName, namespace ?? 'none');
    // Query FlowRecord by ApiName+NamespacePrefix and determine deployment intent
    const flowIntent = await getFlowDeploymentIntentByName(connection, apiName, namespace, flowType);

    if (flowIntent) {
      deploymentMetadata.intakeFlow = flowIntent;
      logger?.debug('Intake flow intent: %s', flowIntent.deploymentIntent);
    } else {
      // Flow not found - default to deploy intent
      deploymentMetadata.intakeFlow = {
        apiName,
        namespace,
        deploymentIntent: 'deploy',
        flowType: 'regular',
      };
      logger?.debug('Intake flow not found in target, defaulting to deploy intent');
    }
  }

  // Process fulfillment flow
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;
  if (fulfillmentFlow?.apiName) {
    // Check if it's an orchestrator flow
    const flowType =
      fulfillmentFlow.type === 'FlowOrchestrator' || fulfillmentFlow.type === 'FLOW_ORCHESTRATOR'
        ? 'orchestrator'
        : 'regular';

    const apiName = fulfillmentFlow.apiName as string;
    const namespace = (fulfillmentFlow.namespacePrefix as string | null) ?? null;

    logger?.debug(
      'Determining deployment intent for fulfillment flow: %s (type: %s, namespace: %s)',
      apiName,
      flowType,
      namespace ?? 'none'
    );
    // Query FlowRecord/FlowOrchestration by ApiName+NamespacePrefix and determine deployment intent
    const flowIntent = await getFlowDeploymentIntentByName(connection, apiName, namespace, flowType);

    if (flowIntent) {
      deploymentMetadata.fulfillmentFlow = flowIntent;
      logger?.debug('Fulfillment flow intent: %s', flowIntent.deploymentIntent);
    } else {
      // Flow not found - default to deploy intent
      deploymentMetadata.fulfillmentFlow = {
        apiName,
        namespace,
        deploymentIntent: 'deploy',
        flowType,
      };
      logger?.debug('Fulfillment flow not found in target, defaulting to deploy intent');
    }
  }

  return deploymentMetadata;
}

export async function generateZippedArtifacts(
  request: ServiceProcessRetrieveRequest,
  serviceProcessData: Record<string, unknown>,
  serviceProcessDeps: Record<string, unknown>,
  retrieveStages?: RetrieveStages,
  logger?: Logger
): Promise<string> {
  const zipFileName = `${request.serviceProcessId}.zip`;
  const zipFilePath = join(request.outputDir, zipFileName);

  retrieveStages?.startPhase('Generating consolidated package');
  logger?.debug('Generating ZIP package: %s', zipFilePath);

  const serviceProcessJson = JSON.stringify(serviceProcessData, null, 2);
  const zip = new JSZip();
  zip.file('templateData.json', serviceProcessJson);
  logger?.debug('Added templateData.json to ZIP (%d bytes)', serviceProcessJson.length);

  // Single combined metadata file (org + service process flows)
  logger?.debug('Generating deployment metadata');
  const serviceProcessMetadata = await generateDeploymentMetadata(serviceProcessData, request.connection, logger);
  const combinedMetadata = {
    version: '1.0',
    org: {
      instanceUrl: request.orgMetadata.orgInstanceUrl,
      id: request.orgMetadata.orgId,
      apiVersion: request.orgMetadata.apiVersion,
    },
    serviceProcess: {
      intakeFlow: serviceProcessMetadata.intakeFlow,
      fulfillmentFlow: serviceProcessMetadata.fulfillmentFlow,
    },
  };
  const metadataJson = JSON.stringify(combinedMetadata, null, 2);
  zip.file('service-process.metadata.json', metadataJson);
  logger?.debug('Added service-process.metadata.json to ZIP (%d bytes)', metadataJson.length);

  const flowMetadataFolder = zip.folder('metadata')?.folder('flows');

  // Extract apiNames from serviceProcessData (templateData.json)
  const getFlowApiName = (flowData: unknown): string | undefined => {
    if (typeof flowData === 'string' && flowData.trim().length > 0) return flowData.trim();
    if (
      flowData &&
      typeof flowData === 'object' &&
      'apiName' in flowData &&
      typeof (flowData as { apiName: unknown }).apiName === 'string'
    ) {
      return (flowData as { apiName: string }).apiName.trim();
    }
    return undefined;
  };

  const intakeFormApiName = getFlowApiName(serviceProcessData.intakeForm);
  const fulfillmentFlowApiName = getFlowApiName(serviceProcessData.fulfillmentFlow);

  if (serviceProcessDeps.intakeForm && intakeFormApiName) {
    const intakeFormXmlContent = serviceProcessDeps.intakeForm as string;
    flowMetadataFolder?.file(`${intakeFormApiName}.flow-meta.xml`, intakeFormXmlContent);
    logger?.debug(
      'Added intake flow to ZIP: %s.flow-meta.xml (%d bytes)',
      intakeFormApiName,
      intakeFormXmlContent.length
    );
  }

  if (serviceProcessDeps.fulfillmentForm && fulfillmentFlowApiName) {
    const fulfillmentFormXmlContent = serviceProcessDeps.fulfillmentForm as string;
    flowMetadataFolder?.file(`${fulfillmentFlowApiName}.flow-meta.xml`, fulfillmentFormXmlContent);
    logger?.debug(
      'Added fulfillment flow to ZIP: %s.flow-meta.xml (%d bytes)',
      fulfillmentFlowApiName,
      fulfillmentFormXmlContent.length
    );
  }

  retrieveStages?.succeedPhase('Generating consolidated package');
  retrieveStages?.startPhase('Creating ZIP archive');

  logger?.debug('Writing ZIP file to disk: %s', zipFilePath);
  await createZipFile(zipFilePath, zip);
  logger?.debug('ZIP file created successfully');

  retrieveStages?.succeedPhase('Creating ZIP archive');
  return zipFilePath;
}

/**
 * Single file entry in the retrieve result.
 */
export type RetrieveResultFile = {
  name: string;
  type: 'ServiceProcessDetails' | 'ServiceProcessMetadata' | 'Flow';
  filePath: string;
};

/**
 * Result payload for --json output.
 */
export type RetrieveResult = {
  success: boolean;
  serviceProcess: { id: string; name: string };
  zipFilePath: string;
  files: RetrieveResultFile[];
};

/**
 * Build the structured result for --json output.
 */
function buildRetrieveResult(
  request: ServiceProcessRetrieveRequest,
  serviceProcessData: Record<string, unknown>,
  flowMetadata: Array<{ apiName: string }>,
  zipFilePath: string
): RetrieveResult {
  const serviceProcessName = (serviceProcessData.name as string) ?? 'Unknown';
  const serviceProcessId = (serviceProcessData.id as string) ?? request.serviceProcessId;
  const files: RetrieveResultFile[] = [];

  // Service Process details (templateData.json)
  files.push({
    name: serviceProcessName,
    type: 'ServiceProcessDetails',
    filePath: 'templateData.json',
  });

  // Service Process metadata
  files.push({
    name: 'Service Process Metadata',
    type: 'ServiceProcessMetadata',
    filePath: 'service-process.metadata.json',
  });

  // Flow entries
  for (const flow of flowMetadata) {
    files.push({
      name: flow.apiName,
      type: 'Flow',
      filePath: `metadata/flows/${flow.apiName}.flow-meta.xml`,
    });
  }

  return {
    success: true,
    serviceProcess: { id: serviceProcessId, name: serviceProcessName },
    zipFilePath,
    files,
  };
}

export type RetrieveServiceProcessResult = {
  zipFilePath: string;
  result: RetrieveResult;
};

type RetrievePhase =
  | 'Validating Request'
  | 'Fetching Service Process'
  | 'Resolving related components'
  | 'Retrieving metadata'
  | 'Generating consolidated package'
  | 'Creating ZIP archive'
  | 'Done';

export async function retrieveServiceProcess(
  request: ServiceProcessRetrieveRequest,
  retrieveStages?: RetrieveStages,
  logger?: Logger
): Promise<RetrieveServiceProcessResult> {
  let currentPhase: RetrievePhase = 'Validating Request';
  const startTime = Date.now();

  try {
    retrieveStages?.startPhase('Validating Request');
    currentPhase = 'Validating Request';
    logger?.debug('Starting validation phase');

    const effectiveVersion = request.orgMetadata.apiVersion;
    if (!isApiVersionAtLeast(effectiveVersion, MIN_SERVICE_PROCESS_API_VERSION)) {
      logger?.error('API version validation failed: %s', effectiveVersion);
      throw new SfError(getUnsupportedApiVersionMessage(effectiveVersion), 'UnsupportedApiVersion');
    }
    logger?.debug('API version validated: %s', effectiveVersion);

    await validateRequest(request);
    logger?.debug('Request validation completed');
    retrieveStages?.succeedPhase('Validating Request');

    retrieveStages?.startPhase('Fetching Service Process');
    currentPhase = 'Fetching Service Process';
    logger?.info('Fetching Service Process: id=%s', request.serviceProcessId);
    const serviceProcessData = await retrieveServiceProcessDetails(
      request.serviceProcessId,
      request.connection,
      request.apiVersion,
      logger
    );
    const name = (serviceProcessData.name as string) ?? 'Unknown';
    const recordId = (serviceProcessData.id as string) ?? request.serviceProcessId;
    const productCode = serviceProcessData.productCode != null ? String(serviceProcessData.productCode) : undefined;
    logger?.debug('Service Process fetched: name=%s, id=%s', name, recordId);
    retrieveStages?.setServiceProcessDetails(name, recordId, productCode);
    retrieveStages?.succeedPhase('Fetching Service Process');

    retrieveStages?.startPhase('Resolving related components');
    currentPhase = 'Resolving related components';
    logger?.debug('Resolving related components');
    const counts = getResolvingCounts(serviceProcessData);
    logger?.debug(
      'Related components: preprocessors=%d, intakeFlow=%d, fulfillmentFlow=%d',
      counts.preprocessors,
      counts.intakeFlow,
      counts.fulfillmentFlow
    );
    retrieveStages?.setResolvingCounts(counts.preprocessors, counts.intakeFlow, counts.fulfillmentFlow);
    retrieveStages?.succeedPhase('Resolving related components');

    retrieveStages?.startPhase('Retrieving metadata');
    currentPhase = 'Retrieving metadata';
    logger?.info('Retrieving metadata');
    const { deps: serviceProcessDeps, flowMetadata } = await extractServiceProcessDependencies(
      serviceProcessData,
      request.connection,
      request.outputDir,
      logger
    );
    logger?.debug('Retrieved %d flow metadata file(s)', flowMetadata.length);
    const retrievingLines = getRetrievingMetadataLines(serviceProcessData, flowMetadata);
    retrieveStages?.setRetrievingMetadataLines(retrievingLines);
    retrieveStages?.succeedPhase('Retrieving metadata');

    logger?.debug('Ensuring output directory exists: %s', request.outputDir);
    await ensureDirectoryExists(request.outputDir);

    currentPhase = 'Generating consolidated package';
    logger?.info('Generating consolidated package');
    const zipFilePath = await generateZippedArtifacts(
      request,
      serviceProcessData,
      serviceProcessDeps,
      retrieveStages,
      logger
    );
    logger?.debug('ZIP file created: %s', zipFilePath);

    retrieveStages?.startPhase('Done');
    currentPhase = 'Done';
    retrieveStages?.succeedPhase('Done');
    retrieveStages?.stop();

    const duration = Date.now() - startTime;
    logger?.info('Retrieve completed successfully in %dms', duration);

    const result = buildRetrieveResult(request, serviceProcessData, flowMetadata, zipFilePath);
    return { zipFilePath, result };
  } catch (error) {
    logger?.error(
      'Retrieve failed in phase "%s": %s',
      currentPhase,
      error instanceof Error ? error.message : String(error)
    );
    logger?.debug('Retrieve failed (raw): %s', error instanceof Error ? error.stack ?? error.message : String(error));
    retrieveStages?.failPhase(currentPhase, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
