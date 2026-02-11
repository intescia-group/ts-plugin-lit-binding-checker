# ts-plugin-lit-binding-checker

A TypeScript Language Service plugin that provides type checking for Lit element templates. It validates property bindings, event handlers, attributes, and slots against your web component definitions.

## Features

- **Property binding validation** — Type-check `.prop=${value}` bindings against component properties
- **Event handler validation** — Verify `@event=${handler}` matches the `CustomEvent<T>` type dispatched by the component
- **Attribute validation** — Check static attributes against component properties
- **Slot validation** — Ensure `slot="name"` attributes reference declared slots (`@slot` JSDoc)
- **Go to definition** — Ctrl+Click on properties and events to jump to their definitions
- **Hover information** — See property types and event signatures on hover
- **CLI tool** — Run checks in CI/CD pipelines

## Supported Patterns

### Scoped Element Registries

Works with both scoped registry implementations:

**Open-WC (`@open-wc/scoped-elements`)**
```typescript
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';

class MyComponent extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'child-element': ChildElement,
  };
  // or as a getter
  static get scopedElements() {
    return { 'child-element': ChildElement };
  }
}
```

**Lit Labs (`@lit-labs/scoped-registry-mixin`)**
```typescript
import { ScopedRegistryHost } from '@lit-labs/scoped-registry-mixin';

class MyComponent extends ScopedRegistryHost(LitElement) {
  static elementDefinitions = {
    'child-element': ChildElement,
  };
}
```

### Event Detection

The plugin automatically detects events from your TypeScript code:

**Automatic detection from `new CustomEvent()`**
```typescript
class MyInput extends LitElement {
  private onChange() {
    // Plugin detects the event name and infers the detail type
    this.dispatchEvent(new CustomEvent('value-changed', {
      detail: { value: this.value }
    }));
  }
}
```

**Explicit type annotation**
```typescript
this.dispatchEvent(new CustomEvent<{ value: string }>('value-changed', {
  detail: { value: this.value }
}));
```

**JSDoc `@fires` tag (useful for `.d.ts` files or documentation)**
```typescript
/**
 * @fires value-changed - Emitted when value changes with `{ value: string }`.
 * @fires selection-changed - Emitted with `{ items: Item[] }`.
 */
class MyInput extends LitElement { ... }
```

> **Note:** For components distributed as `.d.ts` declaration files, only JSDoc `@fires` tags are available since the source code is not present.

### Slot Documentation

Document slots with the `@slot` JSDoc tag:

```typescript
/**
 * @slot (default) - Default slot for main content.
 * @slot header - Slot for header content.
 * @slot footer - Slot for footer content.
 */
class MyCard extends LitElement {
  render() {
    return html`
      <slot name="header"></slot>
      <slot></slot>
      <slot name="footer"></slot>
    `;
  }
}

## Installation

```bash
npm install -D @intescia/ts-plugin-lit-binding-checker
```

## Configuration

Add the plugin to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@intescia/ts-plugin-lit-binding-checker",
        "ignoreUndefined": true,
        "ignoreAttribute": false,
        "ignoreFiles": ["**/*.test.ts", "**/*.spec.ts"]
      }
    ]
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignoreUndefined` | `boolean` | `false` | Ignore type mismatches caused only by `\| undefined` |
| `ignoreAttribute` | `boolean` | `false` | Disable attribute validation (keep only `.prop` checks) |
| `ignoreFiles` | `string[]` | `[]` | Glob patterns for files to exclude from checking |
| `debugCache` | `boolean` | `false` | Log cache diagnostics to tsserver log |

### VS Code Setup

To use the plugin in VS Code, configure the workspace to use the local TypeScript version:

1. Create or edit `.vscode/settings.json`:
```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

2. Open a TypeScript file and click on the TypeScript version in the status bar
3. Select "Use Workspace Version"

## CLI Usage

Run type checking from the command line or in CI:

```bash
# Basic usage
npx lit-binding-check tsconfig.json

# With options
npx lit-binding-check tsconfig.json --ignore-undefined --ignore-attribute

# Ignore specific files
npx lit-binding-check tsconfig.json --ignore-files "**/*.test.ts" "**/*.spec.ts"
```

### Exit Codes

- `0` — No errors found
- `1` — Type errors detected

## Error Codes

| Code | Description |
|------|-------------|
| `90010` | Custom element tag not found in `scopedElements`/`elementDefinitions` |
| `90011` | Property not found on the component class |
| `90012` | Property type mismatch |
| `90020` | Attribute on unresolved element (warning) |
| `90021` | Unknown attribute on component (warning) |
| `90030` | Event handler type mismatch |
| `90031` | Event detail type mismatch (JSDoc-based) |
| `90032` | Event not declared on component (warning) |
| `90040` | Named slot not declared on component (warning) |
| `90041` | Default slot content but no default slot declared (warning) |

## Examples

### Property Binding Error

```typescript
class MyPage extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'user-card': UserCard,
  };

  render() {
    return html`
      <user-card
        .userId=${123}        <!-- ✓ OK if userId: number -->
        .userName=${"Alice"}  <!-- ✗ Error if userName: number -->
      ></user-card>
    `;
  }
}
```

### Event Handler Error

```typescript
// UserCard dispatches: CustomEvent<{ id: string }>
// But handler expects: CustomEvent<{ id: number }>

render() {
  return html`
    <user-card
      @user-selected=${(e: CustomEvent<{ id: number }>) => {
        // ✗ Error: event detail type mismatch
        console.log(e.detail.id);
      }}
    ></user-card>
  `;
}
```

### Slot Error

```typescript
// MyCard only declares: @slot header, @slot footer

render() {
  return html`
    <my-card>
      <div slot="header">OK</div>
      <div slot="sidebar">✗ Error: slot "sidebar" not declared</div>
    </my-card>
  `;
}
```

## License

MIT
