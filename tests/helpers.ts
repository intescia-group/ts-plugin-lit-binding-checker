import * as ts from 'typescript';
import { runChecksOnSourceFile } from '../src/checker';
import type { PluginOptions } from '../src/types';

/**
 * Stubs for LitElement / ScopedElementsMixin so inline test sources compile.
 */
const LIT_STUB = `
declare class LitElement {
  static styles: any;
  render(): any;
  connectedCallback(): void;
  disconnectedCallback(): void;
  requestUpdate(): void;
  updated(props: Map<string, unknown>): void;
}

type Constructor<T = {}> = new (...args: any[]) => T;

interface ScopedElementsHostConstructor {
  new (...args: any[]): LitElement;
}

declare function ScopedElementsMixin<T extends Constructor<LitElement>>(
  base: T
): T & ScopedElementsHostConstructor;

declare function html(strings: TemplateStringsArray, ...values: any[]): any;
`;

export interface DiagResult {
  code: number;
  message: string;
  category: ts.DiagnosticCategory;
}

/**
 * Compile an inline TypeScript source together with the Lit stubs,
 * run the checker, and return simplified diagnostics.
 */
export function check(source: string, opts: PluginOptions = {}): DiagResult[] {
  const fileName = '/test.ts';
  const stubName = '/lit-stub.d.ts';

  const files: Record<string, string> = {
    [stubName]: LIT_STUB,
    [fileName]: `/// <reference path="./lit-stub.d.ts" />\n` + source,
  };

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2020.d.ts'],
  };

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion) => {
    if (files[name]) {
      return ts.createSourceFile(name, files[name], languageVersion, true);
    }
    return origGetSourceFile(name, languageVersion);
  };
  host.fileExists = (name) => name in files || ts.sys.fileExists(name);
  host.readFile = (name) => files[name] ?? ts.sys.readFile(name);

  const program = ts.createProgram([stubName, fileName], compilerOptions, host);
  const sf = program.getSourceFile(fileName)!;

  const diags = runChecksOnSourceFile(ts as any, program, sf, opts);

  return diags.map((d) => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    category: d.category,
  }));
}
