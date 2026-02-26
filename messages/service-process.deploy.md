# summary

Deploys a Unified Catalog Service Process into a Salesforce org.

# description

This command assumes that all prerequisite metadata required by the
Service Process (such as Apex classes, custom objects, and other
non-supported dependencies) already exist in the org.

The command does not create missing prerequisites. Deployment failures
caused by missing dependencies are surfaced. Supported metadata is
Service Process Attributes, Intake flow, Fulfillment flow, Preprocessor.

Use --loglevel debug for detailed internal logs (API requests/responses, IDs, validation details). You can also set SF_LOG_LEVEL=debug.

# flags.input-zip.summary

Path to a zip file containing metadata for deployment.

# flags.input-zip.description

Path to a zip file containing metadata for deployment.

# flags.loglevel.summary

Log level for diagnostic output.

# flags.loglevel.description

Set to debug (or trace) for detailed internal logs (API requests/responses, IDs, validation details). You can also set SF_LOG_LEVEL=debug.

# examples

- Deploy a Service Process from a zip file:

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

- Deploy with detailed debug logs (use either form):

  SF_LOG_LEVEL=debug <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod --loglevel debug
