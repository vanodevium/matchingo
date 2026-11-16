.DEFAULT_GOAL: help
.PHONY: help fix test test-verbose coverage bench

help: ## Show this help message
	@sed -rn 's/^([a-zA-Z_-]+):.*## (.*)$$/"\1" "\2"/p' < $(MAKEFILE_LIST) | xargs printf "make %-20s# %s\n"

fix: ## Run prettier to fix formatting
	npx prettier --write src tests benchmarks examples index.js

test: ## Run tests
	npx vitest run

test-verbose: ## Run tests with verbose output
	npx vitest run --reporter=verbose

coverage: ## Show test coverage report
	npx vitest run --coverage

bench: ## Run all benchmarks (mitata)
	node --expose-gc benchmarks/run.js
