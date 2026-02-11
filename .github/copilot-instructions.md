# Copilot Instructions

## Build & Run

```bash
yarn build          # Compile TypeScript (tsc -p tsconfig.build.json) → dist/
yarn check          # Run the CLI checker on this repo (node dist/cli.js tsconfig.json --ignore-undefined)
npm test            # Run unit tests (vitest)
npx vitest run tests/checker.test.ts -t "reports type mismatch"  # Run a single test by name
```

There are no linters configured. Validation: `yarn build` (must compile cleanly) + `npm test`.

Releases are automated via semantic-release on the `main` branch — use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).

## Architecture

This is a **TypeScript Language Service plugin** that validates Lit element templates. It has two entry points:

- **`src/index.ts`** — The TS Language Service plugin. Exports an `init()` function that wraps the LanguageService proxy, hooking into `getSemanticDiagnostics`, `getDefinitionAndBoundSpan`, and `getQuickInfoAtPosition`. It handles IDE features (go-to-definition, hover) by locating properties/events/tags at cursor positions within `html` tagged template literals.

- **`src/cli.ts`** — Standalone CLI (`lit-binding-check`) that creates a `ts.Program` and runs the checker on all source files. Used for CI pipelines.

Both entry points delegate the core validation to:

- **`src/checker.ts`** — `runChecksOnSourceFile()` is the main function. It finds LitElement classes, resolves their scoped element registries (`scopedElements` / `elementDefinitions`), then walks `html` tagged templates to validate `.prop` bindings, `@event` handlers, static attributes, and `slot` assignments against the child component types.

- **`src/types.d.ts`** — Shared `PluginOptions` interface and `TS` type alias.

### Key concepts

- **Scoped element resolution**: The plugin reads `static scopedElements` (Open-WC) or `static elementDefinitions` (Lit Labs) to map custom element tag names → class references, then uses the TypeChecker to resolve instance types.
- **Template parsing**: Uses regex-based parsing on the raw template string text (with `${...}` expressions masked to `§` characters) rather than AST-based template parsing.
- **Caching**: `checker.ts` uses `WeakMap` caches (keyed on AST nodes/types) per diagnostic run for scoped elements, instance types, property types, etc.
- **Error codes**: Custom diagnostics use codes `90010`–`90041` (see README for the full table).

## Conventions

- The codebase uses French in some log messages and comments (e.g., `"Aucun problème Lit détecté"`). Follow the existing language when editing nearby code.
- All source is in `src/` with a flat structure (no subdirectories).
- The plugin receives `typescript` as a module injection (`TS` type) — never import `typescript` at the top level in `checker.ts`; use the `ts` parameter passed into functions.
- Output targets CommonJS (`"module": "commonjs"`) for compatibility with the TS Language Service host.
