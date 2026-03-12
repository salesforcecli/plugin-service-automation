# Service Process Automation Plugin

[![NPM](https://img.shields.io/npm/v/@salesforce/plugin-service-automation.svg?label=@salesforce/plugin-service-automation)](https://www.npmjs.com/package/@salesforce/plugin-service-automation) [![Downloads/week](https://img.shields.io/npm/dw/@salesforce/plugin-service-automation.svg)](https://npmjs.org/package/@salesforce/plugin-service-automation) [![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/license/apache-2-0)

Service automation transforms manual tasks into orchestrated workflows—from intake forms to fulfillment—delivering consistency, scalability, and speed. A Service Process combines Data (records) and Metadata (code and configuration). Migrating a process from Sandbox to Production typically requires manual export and deployment of interdependent components—an error-prone and time-consuming approach that can compromise tested configurations.

This plugin automates the extraction and deployment of Service Process, ensuring faster, safer deployments where the validated golden copy is exactly what reaches Production.

### Supported Metadata Types

- Service Process Attributes (anchor, custom, content)
- Intake Flow
- Fulfillment Flow
- Preprocessor (Apex class must already exist in the target org)

**Prerequisite:** All other dependencies (e.g., Apex used in flows, Unified Catalog content definition whitelisting) must already exist in the target org.

## Before You Begin

- Install and authenticate the [Salesforce CLI](https://developer.salesforce.com/tools/sfdxcli).
- Ensure your target org supports the Service Process API (minimum API version 66.0).

## Install the Plugin

```bash
sf plugins install @salesforce/plugin-service-automation
```

To install a specific version:

```bash
sf plugins install @salesforce/plugin-service-automation@x.y.z
```

## Running the Plugin

After installation, use the `sf service-process` topic:

```bash
# List Service Processes in an org
sf service-process list -o YOUR_ORG_ALIAS

# Retrieve a Service Process zip to an org
sf service-process retrieve -i 01txx0000008ABC -o devSandbox -d ./sp-artifacts

# Deploy a retrieved Service Process zip to an org
sf service-process deploy -z ./service-process.zip -o prod
```

## Commands

### sf service-process list

Lists Unified Catalog Service Processes available in a Salesforce org.

**USAGE**

```bash
sf service-process list -o <value> [--limit <number>] [--api-version <value>] [--json]
```

**FLAGS**

| Short | Flag                  | Description                                                                          |
| ----- | --------------------- | ------------------------------------------------------------------------------------ |
| -o    | --target-org=<value>  | (required) Username or alias of the target org. Not required if `target-org` is set. |
|       | --limit=<number>      | Maximum number of Service Processes to return.                                       |
|       | --api-version=<value> | Override the API version used for requests.                                          |
|       | --json                | Format output as JSON.                                                               |

**EXAMPLES**

```bash
# List Service Processes using default limits
sf service-process list -o devSandbox

# List up to 100 Service Processes
sf service-process list -o devSandbox --limit 100
```

---

### sf service-process retrieve

Exports a Unified Catalog Service Process from a Salesforce org: downloads the definition, retrieves supported dependent metadata (Service Process Attributes, Intake flow, Fulfillment flow, Preprocessor), and packages everything into a zip for deployment to another org.

**USAGE**

```bash
sf service-process retrieve -i <value> -o <value> [--api-version <value>] [-d <value>] [--json]
```

**FLAGS**

| Short | Flag                         | Description                                                                               |
| ----- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| -i    | --service-process-id=<value> | (required) ID of the Unified Catalog Service Process to retrieve.                         |
| -o    | --target-org=<value>         | (required) Username or alias of the target org. Not required if `target-org` is set.      |
| -d    | --output-dir=<value>         | Directory to write retrieved artifacts. Default: `./service-process/<service-process-id>` |
|       | --api-version=<value>        | Override the API version used for requests.                                               |
|       | --json                       | Format output as JSON.                                                                    |

**EXAMPLES**

```bash
# Retrieve a Service Process by ID
sf service-process retrieve -i 01txx0000008ABC -o devSandbox

# Retrieve and write to a custom directory
sf service-process retrieve -i 01txx0000008ABC -o devSandbox -d ./sp-artifacts
```

---

### sf service-process deploy

Deploys a Unified Catalog Service Process (from a zip produced by `retrieve`) into a target Salesforce org.

**Supported metadata types** (retrieved and deployed by this command): Service Process Attributes (anchor, custom, content), Intake flow, Fulfillment flow. All other dependencies must already exist in the target org—for example, Apex used in intake or fulfillment flows, Apex used for preprocessor, and whitelisting of content definition for Unified Catalog. The command does not create these prerequisites; deployment failures caused by missing dependencies are surfaced.

**USAGE**

```bash
sf service-process deploy -z <value> -o <value> [--link-intake] [--link-fulfillment] [--api-version <value>] [--json]
```

**FLAGS**

| Short | Flag                  | Description                                                                          |
| ----- | --------------------- | ------------------------------------------------------------------------------------ |
| -z    | --input-zip=<value>   | (required) Path to the zip file containing the retrieved Service Process.            |
| -o    | --target-org=<value>  | (required) Username or alias of the target org. Not required if `target-org` is set. |
|       | --link-intake         | Link existing intake artifact (flow) instead of deploying a new one.                 |
|       | --link-fulfillment    | Link existing fulfillment artifact (flow, flow orchestrator) instead of deploying.   |
|       | --api-version=<value> | Override the API version used for requests.                                          |
|       | --json                | Format output as JSON.                                                               |

**EXAMPLES**

```bash
# Deploy a Service Process from a zip file
sf service-process deploy -z ./service-process.zip -o prod

# Deploy with debug logs
SF_LOG_LEVEL=debug sf service-process deploy -z ./service-process.zip -o prod
DEBUG=sf:service-process-deploy sf service-process deploy -z ./service-process.zip -o prod
```

## Build (Developers)

```bash
git clone git@github.com:salesforcecli/plugin-service-automation
cd plugin-service-automation
yarn && yarn build
```

Run commands locally:

```bash
./bin/dev service-process list -o YOUR_ORG
```

Or link the plugin and use `sf`:

```bash
sf plugins link .
sf service-process list -o YOUR_ORG
```

## Issues

Report issues at [Salesforce CLI issues](https://github.com/forcedotcom/cli/issues).

## Contributing

1. Please read our [Code of Conduct](CODE_OF_CONDUCT.md)
2. Create a new issue before starting your project so that we can keep track of
   what you are trying to add/fix. That way, we can also offer suggestions or
   let you know if there is already an effort in progress.
3. Fork this repository.
4. [Build the plugin locally](#build-developers)
5. Create a _topic_ branch in your fork. Note, this step is recommended but technically not required if contributing using a fork.
6. Edit the code in your fork.
7. Write appropriate tests for your changes. Try to achieve at least 95% code coverage on any new code. No pull request will be accepted without unit tests.
8. Sign CLA (see [CLA](#cla) below).
9. Send us a pull request when you are done. We'll review your code, suggest any needed changes, and merge it in.

### CLA

External contributors will be required to sign a Contributor's License
Agreement. You can do so by going to https://cla.salesforce.com/sign-cla.
