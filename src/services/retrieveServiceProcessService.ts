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
import { Connection, SfError } from '@salesforce/core';
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

export async function retrieveServiceProcessDetails(
  serviceProcessId: string,
  connection: Connection,
  apiVersion?: string
): Promise<Record<string, unknown>> {
  const url = apiVersion
    ? `/services/data/v${apiVersion}/connect/service-automation/service-process/${serviceProcessId}`
    : `/connect/service-automation/service-process/${serviceProcessId}`;

  try {
    const serviceProcessData = await connection.requestGet<Record<string, unknown>>(url);
    return serviceProcessData;
  } catch (error) {
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
  outputDir: string
): Promise<ExtractDependenciesResult> {
  const serviceProcessDeps: Record<string, unknown> = {};
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;

  const flowApiNames: string[] = [];

  if (intakeForm) {
    const intakeFormType = (intakeForm.type as string | undefined) ?? 'Flow';
    if (intakeFormType === 'Flow') {
      const intakeFormApiName = intakeForm.apiName as string | undefined;
      const intakeFormNamespacePrefix = intakeForm.namespacePrefix as string | undefined;

      if (intakeFormApiName && !intakeFormNamespacePrefix) {
        flowApiNames.push(intakeFormApiName);
      }
    }
    // Omniscript intake form is not fetched; user is notified via getRetrievingMetadataLines
  }

  if (fulfillmentFlow) {
    const fulfillmentFlowApiName = fulfillmentFlow.apiName as string | undefined;
    const fulfillmentFlowNamespacePrefix = fulfillmentFlow.namespacePrefix as string | undefined;

    if (fulfillmentFlowApiName && !fulfillmentFlowNamespacePrefix) {
      flowApiNames.push(fulfillmentFlowApiName);
    }
  }

  const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];

  if (flowApiNames.length > 0) {
    const fetched = await fetchFlows(flowApiNames, connection, outputDir);
    flowMetadata.push(...fetched);

    for (const flow of fetched) {
      if (intakeForm && flow.apiName === (intakeForm.apiName as string)) {
        serviceProcessDeps.intakeForm = flow.xmlContent;
      }
      if (fulfillmentFlow && flow.apiName === (fulfillmentFlow.apiName as string)) {
        serviceProcessDeps.fulfillmentForm = flow.xmlContent;
      }
    }
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
  outputDir: string
): Promise<Array<{ apiName: string; xmlContent: string }>> {
  if (!flowApiNames || flowApiNames.length === 0) {
    return [];
  }

  const tempRetrieveDir = join(outputDir, '.temp');
  await createTemporaryDirectory(tempRetrieveDir);

  try {
    const components = flowApiNames.map((apiName) => ({
      fullName: apiName,
      type: 'Flow',
    }));
    const componentSet = new ComponentSet(components);
    const retrieveResult = await componentSet.retrieve({
      usernameOrConnection: connection,
      output: tempRetrieveDir,
      merge: true,
    });
    await retrieveResult.pollStatus();

    const flowMetadata: Array<{ apiName: string; xmlContent: string }> = [];

    for (const apiName of flowApiNames) {
      const flowXmlPath = join(tempRetrieveDir, 'main', 'default', 'flows', `${apiName}.flow-meta.xml`);

      if (existsSync(flowXmlPath)) {
        // eslint-disable-next-line no-await-in-loop
        const xmlContent = await readFile(flowXmlPath, 'utf-8');
        flowMetadata.push({ apiName, xmlContent });
      } else {
        throw new Error(`Flow XML file not found for '${apiName}' at: ${flowXmlPath}`);
      }
    }
    return flowMetadata;
  } catch (error) {
    throw new Error(`Failed to fetch flow metadata: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await removeTemporaryDirectory(tempRetrieveDir, true);
  }
}

async function generateDeploymentMetadata(
  serviceProcessData: Record<string, unknown>,
  connection: Connection
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

    // Query FlowRecord by ApiName+NamespacePrefix and determine deployment intent
    const flowIntent = await getFlowDeploymentIntentByName(connection, apiName, namespace, flowType);

    if (flowIntent) {
      deploymentMetadata.intakeFlow = flowIntent;
    } else {
      // Flow not found - default to deploy intent
      deploymentMetadata.intakeFlow = {
        apiName,
        namespace,
        deploymentIntent: 'deploy',
        flowType: 'regular',
      };
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

    // Query FlowRecord/FlowOrchestration by ApiName+NamespacePrefix and determine deployment intent
    const flowIntent = await getFlowDeploymentIntentByName(connection, apiName, namespace, flowType);

    if (flowIntent) {
      deploymentMetadata.fulfillmentFlow = flowIntent;
    } else {
      // Flow not found - default to deploy intent
      deploymentMetadata.fulfillmentFlow = {
        apiName,
        namespace,
        deploymentIntent: 'deploy',
        flowType,
      };
    }
  }

  return deploymentMetadata;
}

export async function generateZippedArtifacts(
  request: ServiceProcessRetrieveRequest,
  serviceProcessData: Record<string, unknown>,
  serviceProcessDeps: Record<string, unknown>,
  retrieveStages?: RetrieveStages
): Promise<string> {
  const zipFileName = `${request.serviceProcessId}.zip`;
  const zipFilePath = join(request.outputDir, zipFileName);

  retrieveStages?.startPhase('Generating consolidated package');

  const serviceProcessJson = JSON.stringify(serviceProcessData, null, 2);
  const zip = new JSZip();
  zip.file('templateData.json', serviceProcessJson);

  // Single combined metadata file (org + service process flows)
  const serviceProcessMetadata = await generateDeploymentMetadata(serviceProcessData, request.connection);
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
  zip.file('service-process.metadata.json', JSON.stringify(combinedMetadata, null, 2));

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
  }

  if (serviceProcessDeps.fulfillmentForm && fulfillmentFlowApiName) {
    const fulfillmentFormXmlContent = serviceProcessDeps.fulfillmentForm as string;
    flowMetadataFolder?.file(`${fulfillmentFlowApiName}.flow-meta.xml`, fulfillmentFormXmlContent);
  }

  retrieveStages?.succeedPhase('Generating consolidated package');
  retrieveStages?.startPhase('Creating ZIP archive');

  await createZipFile(zipFilePath, zip);

  retrieveStages?.succeedPhase('Creating ZIP archive');
  return zipFilePath;
}

export type RetrieveServiceProcessResult = {
  zipFilePath: string;
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
  retrieveStages?: RetrieveStages
): Promise<RetrieveServiceProcessResult> {
  let currentPhase: RetrievePhase = 'Validating Request';

  try {
    retrieveStages?.startPhase('Validating Request');
    currentPhase = 'Validating Request';

    const effectiveVersion = request.orgMetadata.apiVersion;
    if (!isApiVersionAtLeast(effectiveVersion, MIN_SERVICE_PROCESS_API_VERSION)) {
      throw new SfError(getUnsupportedApiVersionMessage(effectiveVersion), 'UnsupportedApiVersion');
    }

    await validateRequest(request);
    retrieveStages?.succeedPhase('Validating Request');

    retrieveStages?.startPhase('Fetching Service Process');
    currentPhase = 'Fetching Service Process';
    const serviceProcessData = await retrieveServiceProcessDetails(
      request.serviceProcessId,
      request.connection,
      request.apiVersion
    );
    const name = (serviceProcessData.name as string) ?? 'Unknown';
    const recordId = (serviceProcessData.id as string) ?? request.serviceProcessId;
    const productCode = serviceProcessData.productCode != null ? String(serviceProcessData.productCode) : undefined;
    retrieveStages?.setServiceProcessDetails(name, recordId, productCode);
    retrieveStages?.succeedPhase('Fetching Service Process');

    retrieveStages?.startPhase('Resolving related components');
    currentPhase = 'Resolving related components';
    const counts = getResolvingCounts(serviceProcessData);
    retrieveStages?.setResolvingCounts(counts.preprocessors, counts.intakeFlow, counts.fulfillmentFlow);
    retrieveStages?.succeedPhase('Resolving related components');

    retrieveStages?.startPhase('Retrieving metadata');
    currentPhase = 'Retrieving metadata';
    const { deps: serviceProcessDeps, flowMetadata } = await extractServiceProcessDependencies(
      serviceProcessData,
      request.connection,
      request.outputDir
    );
    const retrievingLines = getRetrievingMetadataLines(serviceProcessData, flowMetadata);
    retrieveStages?.setRetrievingMetadataLines(retrievingLines);
    retrieveStages?.succeedPhase('Retrieving metadata');

    await ensureDirectoryExists(request.outputDir);

    currentPhase = 'Generating consolidated package';
    const zipFilePath = await generateZippedArtifacts(request, serviceProcessData, serviceProcessDeps, retrieveStages);

    retrieveStages?.startPhase('Done');
    currentPhase = 'Done';
    retrieveStages?.succeedPhase('Done');
    retrieveStages?.stop();

    return { zipFilePath };
  } catch (error) {
    retrieveStages?.failPhase(currentPhase, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
