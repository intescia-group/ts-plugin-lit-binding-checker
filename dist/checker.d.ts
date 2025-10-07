import ts from 'typescript';
import type { TS, PluginOptions } from './types';
export declare function runChecksOnSourceFile(ts: TS, program: ts.Program, sf: ts.SourceFile, opts: PluginOptions): ts.Diagnostic[];
