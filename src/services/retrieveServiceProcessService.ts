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
import { Connection } from '@salesforce/core';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import JSZip from 'jszip';
import { ServiceProcessDataRetrievalFailure } from '../errors.js';
import { validateRequest } from '../validation/validators/retrieveServiceProcessRequestValidator.js';
import { ServiceProcessRetrieveRequest } from '../types/types.js';
import { getFlowDeploymentIntentByName } from '../utils/flow/flowMetadata.js';
import type { DeploymentMetadata } from '../workspace/deploymentMetadata.js';
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

export async function extractServiceProcessDependencies(
  serviceProcessData: Record<string, unknown>,
  connection: Connection,
  outputDir: string
): Promise<Record<string, unknown>> {
  const serviceProcessDeps: Record<string, unknown> = {};

  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  const fulfillmentFlow = serviceProcessData.fulfillmentFlow as Record<string, unknown> | undefined;

  const flowApiNames: string[] = [];

  if (intakeForm) {
    const intakeFormApiName = intakeForm.apiName as string | undefined;
    const intakeFormNamespacePrefix = intakeForm.namespacePrefix as string | undefined;

    if (intakeFormApiName && !intakeFormNamespacePrefix) {
      flowApiNames.push(intakeFormApiName);
    }
  }

  if (fulfillmentFlow) {
    const fulfillmentFlowApiName = fulfillmentFlow.apiName as string | undefined;
    const fulfillmentFlowNamespacePrefix = fulfillmentFlow.namespacePrefix as string | undefined;

    if (fulfillmentFlowApiName && !fulfillmentFlowNamespacePrefix) {
      flowApiNames.push(fulfillmentFlowApiName);
    }
  }

  if (flowApiNames.length > 0) {
    const flowMetadata = await fetchFlows(flowApiNames, connection, outputDir);

    for (const flow of flowMetadata) {
      if (intakeForm && flow.apiName === (intakeForm.apiName as string)) {
        serviceProcessDeps.intakeForm = flow.xmlContent;
      }
      if (fulfillmentFlow && flow.apiName === (fulfillmentFlow.apiName as string)) {
        serviceProcessDeps.fulfillmentForm = flow.xmlContent;
      }
    }
  }

  return serviceProcessDeps;
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

  // Process intake flow
  const intakeForm = serviceProcessData.intakeForm as Record<string, unknown> | undefined;
  if (intakeForm?.apiName) {
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
  serviceProcessDeps: Record<string, unknown>
): Promise<void> {
  const zipFileName = `${request.serviceProcessId}.zip`;
  const zipFilePath = join(request.outputDir, zipFileName);

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

  await createZipFile(zipFilePath, zip);
}

export async function retrieveServiceProcess(request: ServiceProcessRetrieveRequest): Promise<void> {
  await validateRequest(request);
  const serviceProcessData = await retrieveServiceProcessDetails(
    request.serviceProcessId,
    request.connection,
    request.apiVersion
  );
  const serviceProcessDeps = await extractServiceProcessDependencies(
    serviceProcessData,
    request.connection,
    request.outputDir
  );
  await ensureDirectoryExists(request.outputDir);
  await generateZippedArtifacts(request, serviceProcessData, serviceProcessDeps);
}
