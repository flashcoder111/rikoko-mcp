# Contributing

Contributions to local editing, model adapters, reproducible templates, and documentation are welcome. Template distribution and model billing are separate services; keep local creation usable independently.

Run relevant tests before making changes, and add regression coverage for configuration, costs, permissions, and job recovery where applicable. Before submitting, run `pnpm typecheck`, the relevant `pnpm test` suites, and `pnpm build`. Media-processing changes also require `pnpm test:media`. Use isolated directories and mock providers; do not point automated tests at real paid services.

Preserve upstream copyright and license notices, and record reused sources in [Third-party notices](THIRD_PARTY_NOTICES.md). Submit only code, templates, and media you have the right to redistribute. Do not commit API keys, personal data, databases, `.env`, `*.local.json`, or real job logs.

When reporting a bug, include the version, reproduction steps, and a redacted error message. Keep job IDs available for private billing investigation, and leave provider keys and payment details out of public reports.
