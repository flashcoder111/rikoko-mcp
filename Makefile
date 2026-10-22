.PHONY: setup dev test verify-provenance verify-contracts verify-local verify-media-ai verify-live verify-clients verify-service verify-release
setup:
	pnpm install --frozen-lockfile
	uv sync --project python --frozen --python 3.12
	pnpm build
dev:
	pnpm dev
test:
	pnpm test
	uv run --project python python -m unittest discover -s tests -p '*_test.py'
verify-provenance:
	pnpm verify provenance
verify-contracts:
	pnpm exec vitest run tests/core.test.ts tests/api.test.ts
verify-local:
	pnpm exec vitest run tests/render.test.ts
	pnpm demo
verify-media-ai:
	pnpm verify media-ai
verify-live:
	pnpm verify live
verify-clients:
	pnpm verify clients
verify-service:
	pnpm exec vitest run tests/reliability.test.ts tests/api.test.ts
verify-release:
	pnpm verify release
