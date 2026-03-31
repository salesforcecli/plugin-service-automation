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
import { validateRequest } from '../validation/validators/retrieveServiceProcessRequestValidator.js';
import { ServiceProcessRetrieveRequest } from '../types/types.js';
import { getFlowDeploymentIntentByName, type FlowDeploymentIntent } from '../utils/flow/flowMetadata.js';
import type { DeploymentMetadata } from '../workspace/deploymentMetadata.js';
import type { RetrieveStages } from '../utils/retrieveStages.js';
import { publishLifecycleMetric, estimateJsonSizeKb } from '../utils/lifecycleMetrics.js';
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

  logger?.debug(`Fetching Service Process details from API 2: ${url}`);
  const fetchStart = Date.now();

  try {
    const serviceProcessData = await connection.requestGet<Record<string, unknown>>(url);
    await publishLifecycleMetric(logger, 'spConnectApiInvoke', {
      serviceProcessId,
      responseSizeKB: estimateJsonSizeKb(serviceProcessData),
      stepExecutionDurationMs: Date.now() - fetchStart,
      status: 'SUCCESS',
    });
    logger?.debug(`Service Process API response received: ${Object.keys(serviceProcessData).length} fields`);
    const filtered = filteredServiceProcessData(serviceProcessData);
    logger?.debug(`Filtered Service Process data: ${Object.keys(filtered).length} supported fields`);
    return filtered;
  } catch (error) {
    await publishLifecycleMetric(logger, 'spConnectApiInvoke', {
      serviceProcessId,
      responseSizeKB: 0,
      stepExecutionDurationMs: Date.now() - fetchStart,
      status: 'FAILURE',
      errorTrigger: error instanceof Error ? error.message : String(error),
    });
    const err = error as { errorCode?: string; data?: { errorCode?: string } };
    const errorCode = err?.errorCode ?? err?.data?.errorCode;
    logger?.error(`Service Process data retrieval failed: errorCode=${errorCode ?? 'unknown'}`);
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
  flowIntents: {
    intakeFlow?: FlowDeploymentIntent;
    fulfillmentFlow?: FlowDeploymentIntent;
  };
};

type FlowSelection = {
  flowIntent?: FlowDeploymentIntent;
  apiNameToFetch?: string;
};

async function resolveIntakeFlowSelection(
  intakeForm: Record<string, unknown> | undefined,
  connection: Connection,
  logger?: Logger
): Promise<FlowSelection> {
  if (!intakeForm) return {};
  const intakeFormType = (intakeForm.type as string | undefined) ?? 'Flow';
  logger?.debug(`Intake form type: ${intakeFormType}`);
  if (intakeFormType !== 'Flow') return {};

  const intakeFormApiName = intakeForm.apiName as string | undefined;
  const intakeFormNamespacePrefix = (intakeForm.namespacePrefix as string | null) ?? null;
  if (!intakeFormApiName) return {};

  const flowIntent = (await getFlowDeploymentIntentByName(
    connection,
    intakeFormApiName,
    intakeFormNamespacePrefix,
    'regular'
  )) ?? {
    apiName: intakeFormApiName,
    namespace: intakeFormNamespacePrefix,
    deploymentIntent: 'deploy',
    flowType: 'regular',
  };

  if (flowIntent.deploymentIntent === 'link') {
    logger?.debug(
      `Skipping intake flow retrieval (intent=link): ${intakeFormApiName} (namespace: ${
        intakeFormNamespacePrefix ?? 'none'
      })`
    );
    return { flowIntent };
  }

  logger?.debug(`Added intake flow to retrieve (intent=deploy): ${intakeFormApiName}`);
  return { flowIntent, apiNameToFetch: intakeFormApiName };
}

async function resolveFulfillmentFlowSelection(
  fulfillmentFlow: Record<string, unknown> | undefined,
  connection: Connection,
  logger?: Logger
): Promise<FlowSelection> {
  if (!fulfillmentFlow) return {};

  const fulfillmentFlowApiName = fulfillmentFlow.apiName as string | undefined;
  const fulfillmentFlowNamespacePrefix = (fulfillmentFlow.namespacePrefix as string | null) ?? null;
  if (!fulfillmentFlowApiName) return {};

  const flowType =
    fulfillmentFlow.type === 'FlowOrchestrator' || fulfillmentFlow.type === 'FLOW_ORCHESTRATOR'
      ? 'orchestrator'
      : 'regular';
  const flowIntent = (await getFlowDeploymentIntentByName(
    connection,
    fulfillmentFlowApiName,
    fulfillmentFlowNamespacePrefix,
    flowType
  )) ?? {
    apiName: fulfillmentFlowApiName,
    namespace: fulfillmentFlowNamespacePrefix,
    deploymentIntent: 'deploy',
    flowType,
  };

  if (flowIntent.deploymentIntent === 'link') {
    logger?.debug(
      `Skipping fulfillment flow retrieval (intent=link): ${fulfillmentFlowApiName} (namespace: ${
        fulfillmentFlowNamespacePrefix ?? 'none'
      })`
    );
    return { flowIntent };
  }

  logger?.debug(`Added fulfillment flow to retrieve (intent=deploy): ${fulfillmentFlowApiName}`);
  return { flowIntent, apiNameToFetch: fulfillmentFlowApiName };
}

export async function extractServiceProcessDependencies(
  serviceProcessData: Record<string, unknown>,
  connection: Connection,
  outputDir: string,
  logger?: Logger
): Promise<ExtractDependenciesResult> {
  const parseStart = Date.now();
  const serviceProcessDeps: Record<string, unknown> = {};
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;
  const flowIntents: {
    intakeFlow?: FlowDeploymentIntent;
    fulfillmentFlow?: FlowDeploymentIntent;
  } = {};

  const flowApiNames: string[] = [];
  const intakeSelection = await resolveIntakeFlowSelection(intakeForm, connection, logger);
  if (intakeSelection.flowIntent) {
    flowIntents.intakeFlow = intakeSelection.flowIntent;
  }
  if (intakeSelection.apiNameToFetch) {
    flowApiNames.push(intakeSelection.apiNameToFetch);
  }
  // Omniscript intake form is not fetched; user is notified via getRetrievingMetadataLines

  const fulfillmentSelection = await resolveFulfillmentFlowSelection(fulfillmentFlow, connection, logger);
  if (fulfillmentSelection.flowIntent) {
    flowIntents.fulfillmentFlow = fulfillmentSelection.flowIntent;
  }
  if (fulfillmentSelection.apiNameToFetch) {
    flowApiNames.push(fulfillmentSelection.apiNameToFetch);
  }

  const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];
  const preProcessors = serviceProcessData.preProcessors;
  const preProcessorCount = Array.isArray(preProcessors) ? preProcessors.length : 0;
  const flowCount = flowApiNames.length;
  const dependencyCount = flowCount + preProcessorCount;
  await publishLifecycleMetric(logger, 'spDependencyParsing', {
    flowCount,
    dependencyCount,
    stepExecutionDurationMs: Date.now() - parseStart,
    status: 'SUCCESS',
  });

  if (flowApiNames.length > 0) {
    logger?.info(`Fetching ${flowApiNames.length} flow(s): ${flowApiNames.join(', ')}`);
    const fetched = await fetchFlows(flowApiNames, connection, outputDir, logger);
    flowMetadata.push(...fetched);

    for (const flow of fetched) {
      if (intakeForm && flow.apiName === (intakeForm.apiName as string)) {
        serviceProcessDeps.intakeForm = flow.xmlContent;
        logger?.debug(`Stored intake form metadata for: ${flow.apiName}`);
      }
      if (fulfillmentFlow && flow.apiName === (fulfillmentFlow.apiName as string)) {
        serviceProcessDeps.fulfillmentForm = flow.xmlContent;
        logger?.debug(`Stored fulfillment flow metadata for: ${flow.apiName}`);
      }
    }
  } else {
    logger?.debug('No flows to retrieve (all flow intents are link or flow API names are missing)');
  }

  return { deps: serviceProcessDeps, flowMetadata, flowIntents };
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
  logger?.debug(`Creating temporary directory for flow retrieval: ${tempRetrieveDir}`);
  await createTemporaryDirectory(tempRetrieveDir);

  try {
    const components = flowApiNames.map((apiName) => ({
      fullName: apiName,
      type: 'Flow',
    }));
    const componentSet = new ComponentSet(components);
    logger?.debug(`Retrieving ${flowApiNames.length} flow(s) via Metadata API`);
    const metadataRetrieveStart = Date.now();
    const retrieveResult = await componentSet.retrieve({
      usernameOrConnection: connection,
      output: tempRetrieveDir,
      merge: true,
    });
    await retrieveResult.pollStatus();
    await publishLifecycleMetric(logger, 'spMetadataRetrieval', {
      metadataTypes: 'Flow',
      flowCount: flowApiNames.length,
      stepExecutionDurationMs: Date.now() - metadataRetrieveStart,
      status: 'SUCCESS',
    });
    logger?.debug('Flow retrieval completed');

    const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];

    for (const apiName of flowApiNames) {
      const flowXmlPath = join(tempRetrieveDir, 'main', 'default', 'flows', `${apiName}.flow-meta.xml`);

      if (existsSync(flowXmlPath)) {
        // eslint-disable-next-line no-await-in-loop
        const xmlContent = await readFile(flowXmlPath, 'utf-8');
        flowMetadata.push({ apiName, xmlContent });
        logger?.debug(`Flow metadata read: ${apiName} (${xmlContent.length} bytes)`);
      } else {
        logger?.error(`Flow XML file not found: ${apiName} at ${flowXmlPath}`);
        throw new Error(`Flow XML file not found for '${apiName}' at: ${flowXmlPath}`);
      }
    }
    return flowMetadata;
  } catch (error) {
    await publishLifecycleMetric(logger, 'spMetadataRetrieval', {
      metadataTypes: 'Flow',
      flowCount: flowApiNames.length,
      stepExecutionDurationMs: 0,
      status: 'FAILURE',
      errorTrigger: error instanceof Error ? error.message : String(error),
    });
    logger?.error(`Flow fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(`Failed to fetch flow metadata: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    logger?.debug(`Cleaning up temporary directory: ${tempRetrieveDir}`);
    await removeTemporaryDirectory(tempRetrieveDir, true);
  }
}

function generateDeploymentMetadata(
  serviceProcessData: Record<string, unknown>,
  flowIntents: { intakeFlow?: FlowDeploymentIntent; fulfillmentFlow?: FlowDeploymentIntent },
  logger?: Logger
): DeploymentMetadata {
  const deploymentMetadata: DeploymentMetadata = {
    version: '1.0',
  };

  // Process intake flow (only when type is Flow; Omniscript is not deployed as a flow)
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const intakeFormType = intakeForm != null ? (intakeForm.type as string) ?? 'Flow' : undefined;
  if (intakeForm?.apiName && intakeFormType === 'Flow') {
    if (flowIntents.intakeFlow) {
      deploymentMetadata.intakeFlow = flowIntents.intakeFlow;
      logger?.debug(`Intake flow intent: ${flowIntents.intakeFlow.deploymentIntent}`);
    }
  }

  // Process fulfillment flow
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;
  if (fulfillmentFlow?.apiName) {
    if (flowIntents.fulfillmentFlow) {
      deploymentMetadata.fulfillmentFlow = flowIntents.fulfillmentFlow;
      logger?.debug(`Fulfillment flow intent: ${flowIntents.fulfillmentFlow.deploymentIntent}`);
    }
  }

  return deploymentMetadata;
}

export async function generateZippedArtifacts(
  request: ServiceProcessRetrieveRequest,
  serviceProcessData: Record<string, unknown>,
  serviceProcessDeps: Record<string, unknown>,
  flowIntents: {
    intakeFlow?: FlowDeploymentIntent;
    fulfillmentFlow?: FlowDeploymentIntent;
  },
  retrieveStages?: RetrieveStages,
  logger?: Logger
): Promise<string> {
  const zipFileName = `${request.serviceProcessId}.zip`;
  const zipFilePath = join(request.outputDir, zipFileName);

  retrieveStages?.startPhase('Generating consolidated package');
  logger?.debug(`Generating ZIP package: ${zipFilePath}`);

  const serviceProcessJson = JSON.stringify(serviceProcessData, null, 2);
  const zip = new JSZip();
  zip.file('templateData.json', serviceProcessJson);
  logger?.debug(`Added templateData.json to ZIP (${serviceProcessJson.length} bytes)`);

  // Single combined metadata file (org + service process flows)
  logger?.debug('Generating deployment metadata');
  const serviceProcessMetadata = generateDeploymentMetadata(serviceProcessData, flowIntents, logger);
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
  logger?.debug(`Added service-process.metadata.json to ZIP (${metadataJson.length} bytes)`);

  let flowMetadataFolder: JSZip | null | undefined;

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
    flowMetadataFolder ??= zip.folder('metadata')?.folder('flows');
    const intakeFormXmlContent = serviceProcessDeps.intakeForm as string;
    flowMetadataFolder?.file(`${intakeFormApiName}.flow-meta.xml`, intakeFormXmlContent);
    logger?.debug(
      `Added intake flow to ZIP: ${intakeFormApiName}.flow-meta.xml (${intakeFormXmlContent.length} bytes)`
    );
  }

  if (serviceProcessDeps.fulfillmentForm && fulfillmentFlowApiName) {
    flowMetadataFolder ??= zip.folder('metadata')?.folder('flows');
    const fulfillmentFormXmlContent = serviceProcessDeps.fulfillmentForm as string;
    flowMetadataFolder?.file(`${fulfillmentFlowApiName}.flow-meta.xml`, fulfillmentFormXmlContent);
    logger?.debug(
      `Added fulfillment flow to ZIP: ${fulfillmentFlowApiName}.flow-meta.xml (${fulfillmentFormXmlContent.length} bytes)`
    );
  }

  retrieveStages?.succeedPhase('Generating consolidated package');
  retrieveStages?.startPhase('Creating ZIP archive');

  logger?.debug(`Writing ZIP file to disk: ${zipFilePath}`);
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
  let packageStartTime: number | undefined;

  try {
    retrieveStages?.startPhase('Validating Request');
    currentPhase = 'Validating Request';
    logger?.debug('Starting validation phase');

    await validateRequest(request);
    logger?.debug('Request validation completed');
    retrieveStages?.succeedPhase('Validating Request');

    retrieveStages?.startPhase('Fetching Service Process');
    currentPhase = 'Fetching Service Process';
    logger?.info(`Fetching Service Process: id=${request.serviceProcessId}`);
    const serviceProcessData = await retrieveServiceProcessDetails(
      request.serviceProcessId,
      request.connection,
      request.apiVersion,
      logger
    );
    const name = (serviceProcessData.name as string) ?? 'Unknown';
    const recordId = (serviceProcessData.id as string) ?? request.serviceProcessId;
    const productCode = serviceProcessData.productCode != null ? String(serviceProcessData.productCode) : undefined;
    logger?.debug(`Service Process fetched: name=${name}, id=${recordId}`);
    retrieveStages?.setServiceProcessDetails(name, recordId, productCode);
    retrieveStages?.succeedPhase('Fetching Service Process');

    retrieveStages?.startPhase('Resolving related components');
    currentPhase = 'Resolving related components';
    logger?.debug('Resolving related components');
    const counts = getResolvingCounts(serviceProcessData);
    logger?.debug(
      `Related components: preprocessors=${counts.preprocessors}, intakeFlow=${counts.intakeFlow}, fulfillmentFlow=${counts.fulfillmentFlow}`
    );
    retrieveStages?.setResolvingCounts(counts.preprocessors, counts.intakeFlow, counts.fulfillmentFlow);
    retrieveStages?.succeedPhase('Resolving related components');

    retrieveStages?.startPhase('Retrieving metadata');
    currentPhase = 'Retrieving metadata';
    logger?.info('Retrieving metadata');
    const {
      deps: serviceProcessDeps,
      flowMetadata,
      flowIntents,
    } = await extractServiceProcessDependencies(serviceProcessData, request.connection, request.outputDir, logger);
    logger?.debug(`Retrieved ${flowMetadata.length} flow metadata file(s)`);
    const retrievingLines = getRetrievingMetadataLines(serviceProcessData, flowMetadata);
    retrieveStages?.setRetrievingMetadataLines(retrievingLines);
    retrieveStages?.succeedPhase('Retrieving metadata');

    logger?.debug(`Ensuring output directory exists: ${request.outputDir}`);
    await ensureDirectoryExists(request.outputDir);

    currentPhase = 'Generating consolidated package';
    logger?.info('Generating consolidated package');
    packageStartTime = Date.now();
    const zipFilePath = await generateZippedArtifacts(
      request,
      serviceProcessData,
      serviceProcessDeps,
      flowIntents,
      retrieveStages,
      logger
    );
    await publishLifecycleMetric(logger, 'spPackageGeneration', {
      stepExecutionDurationMs: Date.now() - packageStartTime,
      status: 'SUCCESS',
    });
    logger?.debug(`ZIP file created: ${zipFilePath}`);

    retrieveStages?.startPhase('Done');
    currentPhase = 'Done';
    retrieveStages?.succeedPhase('Done');
    retrieveStages?.stop();

    const duration = Date.now() - startTime;
    await publishLifecycleMetric(logger, 'spExportPerformance', {
      serviceProcessId: request.serviceProcessId,
      stepExecutionDurationMs: duration,
      status: 'SUCCESS',
    });
    logger?.info(`Retrieve completed successfully in ${duration}ms`);

    const result = buildRetrieveResult(request, serviceProcessData, flowMetadata, zipFilePath);
    return { zipFilePath, result };
  } catch (error) {
    if (currentPhase === 'Generating consolidated package' && packageStartTime !== undefined) {
      await publishLifecycleMetric(logger, 'spPackageGeneration', {
        stepExecutionDurationMs: Date.now() - packageStartTime,
        status: 'FAILURE',
        errorTrigger: error instanceof Error ? error.message : String(error),
      });
    }
    await publishLifecycleMetric(logger, 'spExportPerformance', {
      serviceProcessId: request.serviceProcessId,
      stepExecutionDurationMs: Date.now() - startTime,
      status: 'FAILURE',
      errorTrigger: error instanceof Error ? error.message : String(error),
    });
    logger?.error(
      `Retrieve failed in phase "${currentPhase}": ${error instanceof Error ? error.message : String(error)}`
    );
    logger?.debug(`Retrieve failed (raw): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    retrieveStages?.failPhase(currentPhase, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
