# Local open-source and official cloud boundaries

The local open-source component includes the workspace, MCP, projects/media/versions, rendering, template format, synchronization client, and model adapters. Official cloud services provide template update distribution and unified model API billing. Template definitions and media carry their own rights attribution.

Template synchronization does not upload user projects or local media. Model API requests submit only the inputs required by the model, and generated outputs are downloaded locally. Provider result URLs may expire; the official service does not promise long-term project storage.

The public client exposes service protocols and request logic. The official publishing backend, account operations, and provider cost management are maintained separately. Clients cannot change official prices or balances. Requests using a user's own key are charged to that user's provider account.

Releases use an explicit file manifest and exclude the official cloud backend, real configuration, databases, runtime logs, research, and third-party development samples. Public distribution still requires review of reused code and all media licenses; file-exclusion checks are not a complete rights audit.

New installations and current runtime code use `RIKOKO_CONFIG_FILE`, `RIKOKO_*`, and the MCP registration name `rikoko`. Upgrades from older versions require migration of legacy host configuration and credentials. Project provenance and third-party dependencies are described according to actual reuse.

## Naming

Use the lowercase name `rikoko` or `rikoko MCP` in product descriptions, pages, tutorials, and Agent conversations. New model configuration, MCP registration names and prompts, Keychain identifiers, and browser storage keys use `rikoko`. Generic `VIDEOWORKBENCH_*` interfaces remain supported. Preserve the original names in third-party references and historical acceptance records.
