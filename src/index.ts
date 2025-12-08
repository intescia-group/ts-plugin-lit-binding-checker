import ts from 'typescript';
import { runChecksOnSourceFile } from './checker';
import type { PluginOptions, TS } from './types';

function init(modules: { typescript: TS }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const log = (msg: string) => info.project.projectService.logger.info(`[lit-plugin] ${msg}`);
    log('Plugin loaded');

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
      log(`getSemanticDiagnostics called for: ${fileName}`);
      const prior = oldLS.getSemanticDiagnostics(fileName);
      const program = oldLS.getProgram?.();
      if (!program) {
        log('No program available');
        return prior;
      }
      // Normalize path for cross-platform compatibility (Windows uses backslashes)
      const normalizedFileName = fileName.replace(/\\/g, '/');
      const sf = program.getSourceFile(fileName) ?? program.getSourceFile(normalizedFileName);
      if (!sf) {
        log(`SourceFile not found for: ${fileName}`);
        return prior;
      }
      try {
        const ours = runChecksOnSourceFile(ts, program, sf, config);
        log(`Found ${ours.length} diagnostics for: ${fileName}`);
        return prior.concat(ours);
      } catch (e) {
        log(`Error on ${fileName}: ${String(e)}`);
        return prior;
      }
    };

    return proxy;
  }

  return { create };
}

export = init;
