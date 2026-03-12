# summary

Retrieve a Unified Catalog Service Process from a Salesforce org.

# description

A Unified Catalog Service Process defines a service automation workflow consisting of attributes, intake flows, fulfillment flows, and preprocessors.

Use this command to retrieve a Unified Catalog Service Process from the specified Salesforce org and packages it into a zip file for deployment to another org.

The command downloads the Service Process definition, identifies supported dependent metadata, retrieves those components, and bundles everything into a deployable artifact.

Supported metadata retrieved by this command includes:

- Service Process Attributes (anchor, custom, content)
- Intake flow
- Fulfillment flow
- Preprocessor reference

Other dependencies (for example Apex classes used by flows or preprocessors) aren't retrieved and must already exist in the target org during deployment.

# flags.service-process-id.summary

ID of the Unified Catalog Service Process to retrieve.

# flags.service-process-id.description

Specifies the ID of the Service Process to retrieve from the source org.

# flags.output-dir.summary

Directory to write retrieved artifacts.

# flags.output-dir.description

Directory where the retrieved Service Process artifacts and the generated zip file are written. If not specified, artifacts are written to the default directory.

# examples

- Retrieve a Service Process by ID:

  <%= config.bin %> <%= command.id %> -i 0SPxx0000008ABC -o devSandbox

- Retrieve a Service Process and write artifacts to a custom directory:

  <%= config.bin %> <%= command.id %> -i 0SPxx0000008ABC -o devSandbox -d ./sp-artifacts
