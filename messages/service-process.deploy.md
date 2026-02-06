# summary

Deploys a Unified Catalog Service Process into a Salesforce org.

# description

This command assumes that all prerequisite metadata required by the
Service Process (such as Apex classes, custom objects, and other
non-supported dependencies) already exist in the org.

The command does not create missing prerequisites. Deployment failures
caused by missing dependencies are surfaced. Supported metadata is
Service Process Attributes, Intake flow, Fulfillment flow, Preprocessor.

# flags.input-dir.summary

Path to retrieved Service Process directory.

# examples

- Deploy a Service Process located in "./service-process/Reclaim_Hardware" directory:

  <%= config.bin %> <%= command.id %> -d ./service-process/Reclaim_Hardware -o prod
