# summary

List Unified Catalog Service Processes available in a Salesforce org.

# description

A Unified Catalog Service Process defines a service automation workflow consisting of attributes, intake flows, fulfillment flows, and preprocessors.

Use this command to list Unified Catalog Service Process records from the specified org and displays their **Name** and **Id** in a human-readable table.

To ensure predictable performance and avoid excessively large output, the command limits the number of records returned. If the maximum limit is reached, the results are truncated and a warning is displayed.

Use the `--limit` flag to control the maximum number of Service Processes returned.

# flags.limit.summary

Maximum number of Service Processes to return.

# flags.limit.description

Specifies the maximum number of Service Process records returned by the command. If not provided, the command uses a default limit.

# examples

- List Service Processes using the default limit:

  <%= config.bin %> <%= command.id %> -o devSandbox

- List up to 100 Service Processes:

  <%= config.bin %> <%= command.id %> -o devSandbox --limit 100
