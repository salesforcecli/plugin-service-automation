# summary

The service-process retrieve command allows users to export a Unified Catalog
Service Process from a Salesforce org.

# description

The command connects to the source org, downloads the Service Process definition,
identifies supported dependent metadata, retrieves those components, and packages
everything into a zip file that can be deployed to another org. Supported
metadata is Service Process Attributes, Intake flow, Fulfillment flow, Preprocessor.

# flags.service-process-id.summary

ID of the Unified Catalog Service Process to retrieve.

# flags.output-dir.summary

Directory to write retrieved artifacts.

# examples

- Retrieve a Service Process by ID:

  <%= config.bin %> <%= command.id %> -id 0SPxx0000008ABC -o devSandbox

- Retrieve and write to a custom directory:

  <%= config.bin %> <%= command.id %> -id 0SPxx0000008ABC -o devSandbox -d ./sp-artifacts
