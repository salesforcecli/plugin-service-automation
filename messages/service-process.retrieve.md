# summary

Retrieve a Unified Catalog Service Process from a Salesforce org.

# description

A Unified Catalog Service Process defines a service automation workflow consisting of attributes, intake flows, fulfillment flows, and preprocessors.

Use this command to retrieve a Unified Catalog Service Process from the specified Salesforce org and package it into a ZIP file. You can then deploy this ZIP file to another org.

The command downloads the Service Process definition, identifies supported dependent metadata, retrieves those components, and bundles everything into a deployable artifact.

Supported metadata retrieved by this command includes:

- Service Process Attributes (anchor, custom, content)
- Intake flow
- Fulfillment flow
- Preprocessor reference

Other dependencies, such as Apex classes used by flows or preprocessors, aren't retrieved and must already exist in the target org before deployment.

# flags.service-process-id.summary

ID of the Unified Catalog Service Process to retrieve from the source org.

# flags.output-dir.summary

Directory where the retrieved Service Process artifacts and the generated ZIP file are written. If not specified, artifacts are written to `./service-process`.

# examples

- Retrieve a Service Process using its ID from the org with alias "devSandbox":

  <%= config.bin %> <%= command.id %> --service-process-id 0SPxx0000008ABC --target-org devSandbox

- Retrieve a Service Process and write the artifacts to a custom directory:

  <%= config.bin %> <%= command.id %> --service-process-id 0SPxx0000008ABC --target-org devSandbox --output-dir ./sp-artifacts
