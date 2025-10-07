#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ts = __importStar(require("typescript"));
const path = __importStar(require("node:path"));
const checker_1 = require("./checker");
function parseConfig(tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
    }
    const basePath = path.dirname(tsconfigPath); // <-- au lieu de ts.getDirectoryPath
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath, undefined, tsconfigPath);
    if (parsed.errors.length) {
        const msg = parsed.errors
            .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
            .join('\n');
        throw new Error(msg);
    }
    return parsed;
}
function formatDiag(sf, d) {
    var _a;
    const { line, character } = sf.getLineAndCharacterOfPosition((_a = d.start) !== null && _a !== void 0 ? _a : 0);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    return `${sf.fileName}:${line + 1}:${character + 1} - ${msg} (code ${d.code})`;
}
(async () => {
    var _a;
    const tsconfig = process.argv[2] || 'tsconfig.json';
    const opts = {
        ignoreUndefined: process.argv.includes('--ignore-undefined'),
        ignoreAttribute: process.argv.includes('--ignore-attribute'),
        debugCache: process.argv.includes('--debug-cache'),
    };
    const parsed = parseConfig(tsconfig);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    let count = 0;
    for (const sf of program.getSourceFiles()) {
        if (sf.isDeclarationFile)
            continue;
        const diags = (0, checker_1.runChecksOnSourceFile)(ts, program, sf, opts);
        for (const d of diags) {
            const file = (_a = d.file) !== null && _a !== void 0 ? _a : sf;
            console.error(formatDiag(file, d));
        }
        count += diags.length;
    }
    if (count > 0) {
        console.error(`\n⚠️  ${count} erreur(s)/warning(s) Lit détecté(s).`);
        process.exit(1);
    }
    else {
        console.log('✅ Aucun problème Lit détecté.');
    }
})();
