#!/usr/bin/env node
import * as ts from 'typescript';
import * as path from 'node:path';
import { runChecksOnSourceFile } from './checker';
import type { PluginOptions } from './types';

function parseConfig(tsconfigPath: string) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const basePath = path.dirname(tsconfigPath); // <-- au lieu de ts.getDirectoryPath
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath,
    undefined,
    tsconfigPath
  );
  if (parsed.errors.length) {
    const msg = parsed.errors
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(msg);
  }
  return parsed;
}

function formatDiag(sf: ts.SourceFile, d: ts.Diagnostic) {
  const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  return `${sf.fileName}:${line + 1}:${character + 1} - ${msg} (code ${d.code})`;
}

(async () => {
  const tsconfig = process.argv[2] || 'tsconfig.json';
  
  // Parse --ignore-files patterns
  const ignoreFiles: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--ignore-files' && process.argv[i + 1]) {
      ignoreFiles.push(...process.argv[i + 1].split(','));
      i++;
    }
  }

  const opts: PluginOptions = {
    ignoreUndefined: process.argv.includes('--ignore-undefined'),
    ignoreAttribute: process.argv.includes('--ignore-attribute'),
    debugCache: process.argv.includes('--debug-cache'),
    ignoreFiles,
  };

  const ignorePatterns = ignoreFiles.map(p => new RegExp(p));
  const shouldIgnoreFile = (fileName: string): boolean => {
    const normalized = fileName.replace(/\\/g, '/');
    return ignorePatterns.some(re => re.test(normalized));
  };

  const parsed = parseConfig(tsconfig);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

  let count = 0;
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (shouldIgnoreFile(sf.fileName)) continue;
    const diags = runChecksOnSourceFile(ts as any, program, sf, opts);
    for (const d of diags) {
      const file = d.file ?? sf;
      console.error(formatDiag(file, d));
    }
    count += diags.length;
  }

  if (count > 0) {
    console.error(`\n⚠️  ${count} erreur(s)/warning(s) Lit détecté(s).`);
    process.exit(1);
  } else {
    console.log('✅ Aucun problème Lit détecté.');
  }
})();
