# summary

List the available Unified Catalog Service Processes in a Salesforce org.

# description

A Unified Catalog Service Process defines a service automation workflow consisting of attributes, intake flows, fulfillment flows, and preprocessors.

Use this command to list Unified Catalog Service Process records from the specified org and display their **Name** and **Id** in a human-readable table.

To ensure predictable performance and avoid excessively large output, the command limits the number of records returned. If the maximum limit is reached, the results are truncated and a warning is displayed.

Use the `--limit` flag to control the maximum number of Service Processes returned.

# flags.limit.summary

Maximum number of Service Processes to return.

# examples

- List the available Service Processes in the org with alias "devSandbox"; use the default limit:

  <%= config.bin %> <%= command.id %> --target-org devSandbox

- List up to 100 Service Processes:

  <%= config.bin %> <%= command.id %> --target-org devSandbox --limit 100
