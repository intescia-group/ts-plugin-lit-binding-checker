import ts from 'typescript';
import type { TS } from './types';
declare function init(modules: {
    typescript: TS;
}): {
    create: (info: ts.server.PluginCreateInfo) => ts.LanguageService;
};
export = init;
