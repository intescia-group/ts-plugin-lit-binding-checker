"use strict";
const checker_1 = require("./checker");
function init(modules) {
    const ts = modules.typescript;
    function create(info) {
        var _a, _b, _c, _d, _e, _f;
        const config = {
            ignoreUndefined: (_b = (_a = info.config) === null || _a === void 0 ? void 0 : _a.ignoreUndefined) !== null && _b !== void 0 ? _b : false,
            ignoreAttribute: (_d = (_c = info.config) === null || _c === void 0 ? void 0 : _c.ignoreAttribute) !== null && _d !== void 0 ? _d : false,
            debugCache: (_f = (_e = info.config) === null || _e === void 0 ? void 0 : _e.debugCache) !== null && _f !== void 0 ? _f : false,
        };
        const proxy = Object.create(null);
        const oldLS = info.languageService;
        for (const k of Object.keys(oldLS)) {
            const x = oldLS[k];
            proxy[k] = typeof x === 'function' ? x.bind(oldLS) : x;
        }
        proxy.getSemanticDiagnostics = (fileName) => {
            var _a, _b, _c;
            const prior = oldLS.getSemanticDiagnostics(fileName);
            const program = (_a = oldLS.getProgram) === null || _a === void 0 ? void 0 : _a.call(oldLS);
            if (!program)
                return prior;
            const sf = program.getSourceFile(fileName);
            if (!sf)
                return prior;
            try {
                const ours = (0, checker_1.runChecksOnSourceFile)(ts, program, sf, config);
                return prior.concat(ours);
            }
            catch (e) {
                (_c = (_b = ts.sys) === null || _b === void 0 ? void 0 : _b.log) === null || _c === void 0 ? void 0 : _c.call(_b, `[lit-plugin] error on ${fileName}: ${String(e)}`);
                return prior;
            }
        };
        return proxy;
    }
    return { create };
}
module.exports = init;
