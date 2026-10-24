# Browser account connection (0.1.33)

`account_connect` starts a local authorization-code/S256 flow against rikoko's website. The browser reuses the user's existing Clerk session; consent returns only a single-use code to a random loopback port. The native runtime exchanges it without displaying an API key. `account_connection_status` verifies the account's real shared credits, and `account_disconnect` revokes the connection.

The implementation lives in `packages/cloud-client/src/account-connection.ts`. `apps/server/src/runtime.ts` restores credentials and connects the generation gateway using a renewable credential bound to the local workspace owner. Gateway preparation/reference cache identities use the stable connection ID, not a rotating access token. The platform owns consent, token issuance, account mapping and the wallet.

The website defaults to `https://rikoko.ai` and publishes `/account-connection.json` with its API origin. `RIKOKO_ACCOUNT_WEBSITE_URL` is a development override. If the system browser cannot open, the tool returns a URL for the user to open on the same computer. Only a local runtime owner can use the flow; remote/shared runtimes retain their configured authentication.

Credentials are atomically saved under `<DATA_DIR>/account/account-connection.json` with owner-only Unix permissions. Windows uses an additional DPAPI CurrentUser envelope. Access tokens last fifteen minutes, refresh is serialized, and the server enforces a ninety-day absolute connection lifetime. A lost refresh response may require disconnect/reconnect. Never expose credentials in tools, logs or URLs. Disconnect preserves a nonsecret marker and does not switch billing sources.

The account connection shares the existing website wallet and cumulative connection limit. Connecting performs no purchase or generation and does not bypass quotation/confirmation. Explicit custom-provider configuration remains on disk; an authorized account connection selects official billing until the user changes their configuration deliberately.

This version has been built and packaged locally for rikoko-platform. It has not been published as a public installer. macOS/browser and local platform integration tests are recorded in the platform's `docs/acceptance/account-connection-2026-10-23.md`; Windows DPAPI has not been exercised on Windows.
