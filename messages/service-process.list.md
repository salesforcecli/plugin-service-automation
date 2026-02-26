# summary

The service-process list command allows users to view Unified Catalog
Service Processes available in a Salesforce org.

# description

The command connects to the specifiedorg, retrieves Service Process
records in batches, and displays their Name and Id in a human-readable
table. To ensure predictable performance and prevent excessively
large output, the command enforces a maximum retrieval limit.
If the limit is reached, the output is truncated and a warning is
displayed Users can explicitly control the number of results returned
using the --limit flag.

# flags.limit.summary

Maximum number of Service Processes to return.

# examples

- List Service Processes using default limits:

  <%= config.bin %> <%= command.id %> -o devSandbox

- List up to 100 Service Processes:

  <%= config.bin %> <%= command.id %> -o devSandbox --limit 100
