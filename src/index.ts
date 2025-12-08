import ts from 'typescript';
import { runChecksOnSourceFile } from './checker';
import type { PluginOptions, TS } from './types';

function init(modules: { typescript: TS }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const config: PluginOptions = {
      ignoreUndefined: (info.config as any)?.ignoreUndefined ?? false,
      ignoreAttribute: (info.config as any)?.ignoreAttribute ?? false,
      debugCache: (info.config as any)?.debugCache ?? false,
    };

    const proxy: ts.LanguageService = Object.create(null);
    const oldLS = info.languageService;
    for (const k of Object.keys(oldLS) as Array<keyof ts.LanguageService>) {
      const x = oldLS[k];
      (proxy as any)[k] = typeof x === 'function' ? x.bind(oldLS) : x;
    }

    proxy.getSemanticDiagnostics = (fileName: string) => {
      const prior = oldLS.getSemanticDiagnostics(fileName);
      const program = oldLS.getProgram?.();
      if (!program) return prior;
      // Normalize path for cross-platform compatibility (Windows uses backslashes)
      const normalizedFileName = fileName.replace(/\\/g, '/');
      const sf = program.getSourceFile(fileName) ?? program.getSourceFile(normalizedFileName);
      if (!sf) return prior;
      try {
        const ours = runChecksOnSourceFile(ts, program, sf, config);
        return prior.concat(ours);
      } catch (e) {
        (ts as any).sys?.log?.(`[lit-plugin] error on ${fileName}: ${String(e)}`);
        return prior;
      }
    };

    return proxy;
  }

  return { create };
}

export = init;
