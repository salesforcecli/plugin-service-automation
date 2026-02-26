# summary

Deploy a Unified Catalog Service Process into a Salesforce org.

# description

This command assumes that all prerequisite metadata required by the Service Process, such as Apex classes, custom objects, and other non-supported dependencies, already exist in the org. The command doesn't create any missing prerequisites; missing dependencies causes the deployment to fail.

Supported metadata types are Service Process Attributes, Intake flow, Fulfillment flow, and Preprocessor.

# flags.input-dir.summary

Path to the directory that contains the Unified Catalog Service Process.

# examples

- Deploy a Service Process located in "./service-process/Reclaim_Hardware" directory to an org with alias "prod":

  <%= config.bin %> <%= command.id %> --input-dir ./service-process/Reclaim_Hardware --target-org prod
