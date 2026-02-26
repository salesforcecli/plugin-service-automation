# summary

Deploys a Unified Catalog Service Process into a Salesforce org.

# description

This command assumes that all prerequisite metadata required by the
Service Process (such as Apex classes, custom objects, and other
non-supported dependencies) already exist in the org.

The command does not create missing prerequisites. Deployment failures
caused by missing dependencies are surfaced. Supported metadata is
Service Process Attributes, Intake flow, Fulfillment flow, Preprocessor.

Use SF_LOG_LEVEL=debug for detailed logs in the log file, or DEBUG=sf:service-process-deploy for terminal output. The CLI supports --loglevel globally. Logs are written to ~/.sf/sf-YYYY-MM-DD.log.

# flags.input-zip.summary

Path to a zip file containing metadata for deployment.

# flags.input-zip.description

Path to a zip file containing metadata for deployment.

# examples

- Deploy a Service Process from a zip file:

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

- Deploy with detailed debug logs:

  SF_LOG_LEVEL=debug <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

  DEBUG=sf:service-process-deploy <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod
