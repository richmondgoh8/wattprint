# Wattprint Makefile
# Convenience targets for common dev workflows.

.PHONY: help install dev run build build-win build-linux build-mac typecheck check rebuild clean distclean release

.DEFAULT_GOAL := help

help: ## Show this help
	@echo "Wattprint — make targets:"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo

install: ## Install dependencies (postinstall auto-rebuilds better-sqlite3 for Electron)
	npm install

dev: install ## Install deps if needed, then run the dev server
	npm run dev

run: dev ## Alias for `make dev` — install deps and launch the app

build: ## Build all three (main + preload + renderer) to out/
	npm run build

build-win: ## Build a Windows portable .exe (uses electron-builder)
	npm run build:win

build-linux: ## Build a Linux AppImage
	npm run build:linux

build-mac: ## Build a macOS dmg
	npm run build:mac

typecheck: ## Type-check main + preload + renderer
	npm run typecheck

check: ## Run svelte-check on the renderer
	npm run check

rebuild: ## Rebuild native modules for the current Electron ABI
	npm run rebuild

clean: ## Remove build artifacts
	rm -rf out dist

distclean: clean ## Also remove node_modules
	rm -rf node_modules

release: ## Tag a release and push (run from a clean main)
	@if [ -z "$(V)" ]; then echo "Usage: make release V=0.1.0"; exit 1; fi
	git tag v$(V) && git push origin v$(V)
	@echo "Tagged v$(V). CI will build the Windows .exe."
