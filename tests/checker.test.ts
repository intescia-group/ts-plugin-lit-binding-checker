import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { check } from './helpers';

// ---------------------------------------------------------------------------
// 1) Property bindings (.prop)
// ---------------------------------------------------------------------------
describe('property bindings (.prop)', () => {
  const base = `
    class ChildEl extends LitElement {
      value: number = 0;
      label: string = '';
      optional?: string;
    }
  `;

  it('accepts correct property type', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el .value=\${42}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(0);
  });

  it('reports type mismatch (90012)', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el .value=\${"not a number"}></child-el>\`;
        }
      }
    `);
    const errs = diags.filter((d) => d.code === 90012);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('.value');
  });

  it('reports unknown property (90011)', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el .nonExistent=\${1}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90011)).toHaveLength(1);
  });

  it('reports unresolved tag (90010)', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = {};
        render() {
          return html\`<child-el .value=\${1}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90010)).toHaveLength(1);
  });

  it('accepts optional property with undefined value', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        val: string | undefined;
        render() {
          return html\`<child-el .optional=\${this.val}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(0);
  });

  it('ignores undefined mismatch when ignoreUndefined is set', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        val: string | undefined;
        render() {
          return html\`<child-el .label=\${this.val}></child-el>\`;
        }
      }
    `, { ignoreUndefined: true });
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(0);
  });

  it('accepts empty array for array property', () => {
    const diags = check(`
      class Items extends LitElement { items: string[] = []; }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'my-items': Items };
        render() {
          return html\`<my-items .items=\${[]}></my-items>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2) Static attributes
// ---------------------------------------------------------------------------
describe('static attributes', () => {
  const base = `
    class ChildEl extends LitElement {
      size: 'small' | 'medium' | 'large' = 'medium';
      count: number = 0;
      active: boolean = false;
    }
  `;

  it('accepts known attribute with valid value', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el size="small"></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90021 || d.code === 90022)).toHaveLength(0);
  });

  it('reports unknown attribute (90021)', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el unknown="x"></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(1);
  });

  it('reports invalid attribute value for string literal union (90022)', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el size="extra-large"></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90022)).toHaveLength(1);
  });

  it('allows global attributes without warning', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el id="foo" class="bar" aria-label="x" data-id="1"></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('resolves kebab-case attribute to camelCase property', () => {
    const diags = check(`
      class El extends LitElement { myProp: string = ''; }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'my-el': El };
        render() {
          return html\`<my-el my-prop="hello"></my-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('skips checks when ignoreAttribute is set', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el unknown="x"></child-el>\`;
        }
      }
    `, { ignoreAttribute: true });
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('accepts boolean attribute (no value) for boolean property', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el active></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90022)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3) Dynamic attribute bindings (attr=${expr}) — the parsing-bug fix
// ---------------------------------------------------------------------------
describe('dynamic attribute bindings (expression placeholders)', () => {
  const base = `
    class ChildEl extends LitElement {
      label: string = '';
      count: number = 0;
    }
  `;

  it('does not false-positive on the attribute after a dynamic binding', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          const v = "hello";
          return html\`<child-el label=\${v} count="5"></child-el>\`;
        }
      }
    `);
    // 'count' should be parsed as its own attribute, not as the value of 'label'
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('still reports unknown static attr after a dynamic binding', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          const v = "hello";
          return html\`<child-el label=\${v} badattr="x"></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(1);
    expect(diags.filter((d) => d.code === 90021)[0].message).toContain('badattr');
  });

  it('skips the dynamic-bound attribute itself', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          const v = 42;
          return html\`<child-el count=\${v}></child-el>\`;
        }
      }
    `);
    // count=${v} is dynamic, should not be checked as a static attribute
    expect(diags.filter((d) => d.code === 90021 || d.code === 90022)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) Event bindings (@event)
// ---------------------------------------------------------------------------
describe('event bindings (@event)', () => {
  it('accepts matching event handler type', () => {
    const diags = check(`
      class ChildEl extends LitElement {
        fire() {
          this.dispatchEvent(new CustomEvent('value-changed', { detail: { v: 1 } }));
        }
      }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler(e: CustomEvent<{ v: number }>) {}
        render() {
          return html\`<child-el @value-changed=\${this.handler}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90030)).toHaveLength(0);
  });

  it('reports handler type mismatch (90030)', () => {
    const diags = check(`
      class ChildEl extends LitElement {
        fire() {
          this.dispatchEvent(new CustomEvent<number>('count-changed', { detail: 1 }));
        }
      }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler(e: CustomEvent<string>) {}
        render() {
          return html\`<child-el @count-changed=\${this.handler}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90030)).toHaveLength(1);
  });

  it('allows handler with no parameters', () => {
    const diags = check(`
      class ChildEl extends LitElement {
        fire() { this.dispatchEvent(new CustomEvent('ping')); }
      }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler() {}
        render() {
          return html\`<child-el @ping=\${this.handler}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90030)).toHaveLength(0);
  });

  it('reports detail type mismatch when @fires has union with undefined (90031)', () => {
    const diags = check(`
      /**
       * @fires date-from-changed - Emitted when start date changes with \`{ value: number | undefined }\`.
       */
      class DatePicker extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'date-picker': DatePicker };
        dateFrom = '';
        private handleDateFromChanged({ detail }: CustomEvent<{ value: number }>) {
          this.dateFrom = detail.value.toString();
        }
        render() {
          return html\`<date-picker @date-from-changed=\${this.handleDateFromChanged}></date-picker>\`;
        }
      }
    `);
    const errs = diags.filter((d) => d.code === 90031);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('date-from-changed');
  });

  it('accepts handler with wider type (undefined) than @fires detail (90031)', () => {
    const diags = check(`
      /**
       * @fires value-changed - Emitted with \`{ value: number }\`.
       */
      class MyInput extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'my-input': MyInput };
        handler(e: CustomEvent<{ value: number | undefined }>) {}
        render() {
          return html\`<my-input @value-changed=\${this.handler}></my-input>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90031)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5) Unknown event warning (90032)
// ---------------------------------------------------------------------------
describe('unknown event warning (90032)', () => {
  const child = `
    /**
     * @fires item-selected - Emitted when item is selected.
     * @fires item-removed - Emitted when item is removed.
     */
    class ChildEl extends LitElement {}
  `;

  it('warns when event is not among declared @fires', () => {
    const diags = check(`
      ${child}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler() {}
        render() {
          return html\`<child-el @item-clicked=\${this.handler}></child-el>\`;
        }
      }
    `);
    const warns = diags.filter((d) => d.code === 90032);
    expect(warns).toHaveLength(1);
    expect(warns[0].category).toBe(ts.DiagnosticCategory.Warning);
    expect(warns[0].message).toContain('item-clicked');
    expect(warns[0].message).toContain('item-selected');
  });

  it('does not warn for a declared event', () => {
    const diags = check(`
      ${child}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler() {}
        render() {
          return html\`<child-el @item-selected=\${this.handler}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90032)).toHaveLength(0);
  });

  it('warns when component declares no events at all', () => {
    const diags = check(`
      class ChildEl extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler() {}
        render() {
          return html\`<child-el @anything=\${this.handler}></child-el>\`;
        }
      }
    `);
    const warns = diags.filter((d) => d.code === 90032);
    expect(warns).toHaveLength(1);
    expect(warns[0].category).toBe(ts.DiagnosticCategory.Warning);
    expect(warns[0].message).toContain('anything');
    expect(warns[0].message).toContain('no events declared');
  });

  it('warns for each undeclared event when component declares no events', () => {
    const diags = check(`
      class ChildEl extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handleClear() {}
        handleAck() {}
        render() {
          return html\`<child-el @clear=\${this.handleClear} @ack=\${this.handleAck}></child-el>\`;
        }
      }
    `);
    const warns = diags.filter((d) => d.code === 90032);
    expect(warns).toHaveLength(2);
    expect(warns[0].message).toContain('clear');
    expect(warns[1].message).toContain('ack');
  });

  it('skips event checks when ignoreEvent is set', () => {
    const diags = check(`
      class ChildEl extends LitElement {
        fire() { this.dispatchEvent(new CustomEvent<number>('count-changed', { detail: 1 })); }
      }
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler(e: CustomEvent<string>) {}
        render() {
          return html\`<child-el @count-changed=\${this.handler} @unknown=\${this.handler}></child-el>\`;
        }
      }
    `, { ignoreEvent: true });
    expect(diags.filter((d) => d.code === 90030)).toHaveLength(0);
    expect(diags.filter((d) => d.code === 90032)).toHaveLength(0);
  });

  it('does not warn for native DOM events (click, blur, focus, etc.)', () => {
    const diags = check(`
      class ChildEl extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handleClick() {}
        handleBlur() {}
        handleFocus() {}
        handleKeydown() {}
        render() {
          return html\`<child-el
            @click=\${this.handleClick}
            @blur=\${this.handleBlur}
            @focus=\${this.handleFocus}
            @keydown=\${this.handleKeydown}
          ></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90032)).toHaveLength(0);
  });

  it('still warns for custom events alongside native ones', () => {
    const diags = check(`
      class ChildEl extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        handler() {}
        render() {
          return html\`<child-el @click=\${this.handler} @my-custom=\${this.handler}></child-el>\`;
        }
      }
    `);
    const warns = diags.filter((d) => d.code === 90032);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('my-custom');
  });
});

// ---------------------------------------------------------------------------
// 6) Slot validation
// ---------------------------------------------------------------------------
describe('slot validation', () => {
  const child = `
    /**
     * @slot (default) - Default slot.
     * @slot header - Header slot.
     * @slot footer - Footer slot.
     */
    class ChildEl extends LitElement {}
  `;

  it('accepts declared named slot', () => {
    const diags = check(`
      ${child}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el><div slot="header">H</div></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90040)).toHaveLength(0);
  });

  it('warns on undeclared named slot (90040)', () => {
    const diags = check(`
      ${child}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el><div slot="sidebar">S</div></child-el>\`;
        }
      }
    `);
    const warns = diags.filter((d) => d.code === 90040);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('sidebar');
  });

  it('accepts default slot content when default slot is declared', () => {
    const diags = check(`
      ${child}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el><span>content</span></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90041)).toHaveLength(0);
  });

  it('warns on default slot content when no default slot declared (90041)', () => {
    const diags = check(`
      /**
       * @slot header - Header only.
       */
      class NoDefault extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'no-default': NoDefault };
        render() {
          return html\`<no-default><span>content</span></no-default>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90041)).toHaveLength(1);
  });

  it('skips slot validation when component has no @slot docs', () => {
    const diags = check(`
      class NoSlots extends LitElement {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'no-slots': NoSlots };
        render() {
          return html\`<no-slots><div slot="any">A</div></no-slots>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90040 || d.code === 90041)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7) Scoped elements resolution
// ---------------------------------------------------------------------------
describe('scoped elements resolution', () => {
  it('resolves static getter scopedElements', () => {
    const diags = check(`
      class ChildEl extends LitElement { value: number = 0; }
      class Host extends ScopedElementsMixin(LitElement) {
        static get scopedElements() {
          return { 'child-el': ChildEl };
        }
        render() {
          return html\`<child-el .value=\${42}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90010)).toHaveLength(0);
  });

  it('resolves static elementDefinitions (lit-labs)', () => {
    const diags = check(`
      class ChildEl extends LitElement { value: number = 0; }
      class Host extends ScopedElementsMixin(LitElement) {
        static elementDefinitions = { 'child-el': ChildEl };
        render() {
          return html\`<child-el .value=\${"wrong"}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(1);
  });

  it('ignores native HTML tags', () => {
    const diags = check(`
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = {};
        render() {
          return html\`<div .innerText=\${"hello"}></div>\`;
        }
      }
    `);
    // Native tags should not trigger 90010
    expect(diags.filter((d) => d.code === 90010)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lit directives (ref, spread, etc.)
// ---------------------------------------------------------------------------
describe('Lit directives', () => {
  const base = `
    class ChildEl extends LitElement {
      value: number = 0;
      label: string = '';
    }
    declare function ref(r: any): any;
    declare function classMap(c: Record<string, boolean>): any;
    declare function styleMap(s: Record<string, string>): any;
    declare function spread(o: any): any;
  `;

  it('ignores ref() directive as standalone expression in a tag', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        tableRef: any;
        render() {
          return html\`<child-el
            \${ref(this.tableRef)}
            .value=\${42}
          ></child-el>\`;
        }
      }
    `);
    expect(diags).toHaveLength(0);
  });

  it('still validates .prop bindings alongside ref()', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        tableRef: any;
        render() {
          return html\`<child-el
            \${ref(this.tableRef)}
            .value=\${"wrong type"}
          ></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(1);
  });

  it('ignores ref() directive with other directives like classMap', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        tableRef: any;
        render() {
          return html\`<child-el
            \${ref(this.tableRef)}
            class=\${classMap({ flex: true })}
            .value=\${42}
          ></child-el>\`;
        }
      }
    `);
    expect(diags).toHaveLength(0);
  });

  it('ignores spread directive as standalone expression', () => {
    const diags = check(`
      ${base}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el
            \${spread({ value: 42 })}
          ></child-el>\`;
        }
      }
    `);
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JSDoc @property declarations
// ---------------------------------------------------------------------------
describe('JSDoc @property declarations', () => {
  const childWithJsDoc = `
    /**
     * @property {string=} value - value input
     * @property {string} placeholder - placeholder input
     * @property {number=} maxLength - maxLength input
     * @property {boolean} invalid - invalid input
     * @attr charCounter - charCounter input
     */
    class JsDocChild extends LitElement {
      render() { return html\`<div></div>\`; }
    }
  `;

  it('accepts .prop binding for JSDoc-declared property (no 90011)', () => {
    const diags = check(`
      ${childWithJsDoc}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'jsdoc-child': JsDocChild };
        render() {
          return html\`<jsdoc-child .value=\${"hello"}></jsdoc-child>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90011)).toHaveLength(0);
  });

  it('skips type checking for JSDoc-declared property (no 90012)', () => {
    const diags = check(`
      ${childWithJsDoc}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'jsdoc-child': JsDocChild };
        render() {
          return html\`<jsdoc-child .value=\${123}></jsdoc-child>\`;
        }
      }
    `);
    // Even though JSDoc says {string=}, we skip type checking — no 90012
    expect(diags.filter((d) => d.code === 90012)).toHaveLength(0);
  });

  it('still reports unknown property not in JSDoc (90011)', () => {
    const diags = check(`
      ${childWithJsDoc}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'jsdoc-child': JsDocChild };
        render() {
          return html\`<jsdoc-child .nonExistent=\${1}></jsdoc-child>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90011)).toHaveLength(1);
  });

  it('accepts static attribute matching JSDoc property (no 90021)', () => {
    const diags = check(`
      ${childWithJsDoc}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'jsdoc-child': JsDocChild };
        render() {
          return html\`<jsdoc-child placeholder="hello"></jsdoc-child>\`;
        }
      }
    `, { ignoreAttribute: false });
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('accepts static attribute matching JSDoc @attr (no 90021)', () => {
    const diags = check(`
      ${childWithJsDoc}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'jsdoc-child': JsDocChild };
        render() {
          return html\`<jsdoc-child charCounter></jsdoc-child>\`;
        }
      }
    `, { ignoreAttribute: false });
    expect(diags.filter((d) => d.code === 90021)).toHaveLength(0);
  });

  it('supports JSDoc @property on parent class (inheritance)', () => {
    const diags = check(`
      /**
       * @property {string} parentProp - from parent
       */
      class ParentEl extends LitElement {
        render() { return html\`<div></div>\`; }
      }
      class ChildEl extends ParentEl {}
      class Host extends ScopedElementsMixin(LitElement) {
        static scopedElements = { 'child-el': ChildEl };
        render() {
          return html\`<child-el .parentProp=\${"hello"}></child-el>\`;
        }
      }
    `);
    expect(diags.filter((d) => d.code === 90011)).toHaveLength(0);
  });
});
