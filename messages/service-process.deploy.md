# summary

Deploy a Unified Catalog Service Process into a Salesforce org.

# description

Deploys a Service Process packaged as a zip file (typically produced by the
`service-process retrieve` command) into a target Salesforce org.

The command deploys supported Service Process metadata, including:

- Service Process Attributes (anchor, custom, context)
- Intake flow
- Fulfillment flow
- Preprocessor reference

All other dependencies must already exist in the target org. For example:

- Apex classes used in flows
- Apex classes referenced by the preprocessor
- Unified Catalog context definition whitelisting

If any required dependency is missing, the deployment fails.

# flags.input-zip.summary

Path to the zip file containing the Service Process metadata to deploy.

# flags.input-zip.description

Path to the zip file produced by `service-process retrieve` that contains the Service Process definition and supported metadata.

# flags.link-intake.summary

Link an existing intake flow instead of deploying a new one.

# flags.link-intake.description

When specified, the command links the existing intake flow in the target org instead of deploying the intake flow from the zip file.

# flags.link-fulfillment.summary

Link an existing fulfillment artifact instead of deploying one.

# flags.link-fulfillment.description

When specified, the command links an existing fulfillment artifact(flow or flow orchestrator) in the target org instead of deploying
the fulfillment flow from the zip file.

# examples

- Deploy a Service Process from a zip file:

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

- Deploy while linking an existing intake flow:

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod --link-intake

- Deploy while linking existing intake and fulfillment artifacts:

  <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod --link-intake --link-fulfillment

- Run with debug logging written to the Salesforce CLI log file:

  SF_LOG_LEVEL=debug <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod

- Enable terminal debug output (if debug namespaces are enabled):

  DEBUG=sf:service-process-deploy <%= config.bin %> <%= command.id %> -z ./service-process.zip -o prod
