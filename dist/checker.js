"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChecksOnSourceFile = runChecksOnSourceFile;
function runChecksOnSourceFile(ts, program, sf, opts) {
    const checker = program.getTypeChecker();
    const diags = [];
    const KNOWN_HTML_TAGS = new Set([
        'div', 'span', 'input', 'button', 'a', 'label', 'ul', 'li', 'ol', 'p', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'img', 'textarea', 'select', 'option', 'form', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'video', 'audio', 'canvas', 'svg'
    ]);
    const KNOWN_SVG_TAGS = new Set([
        'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'defs', 'clipPath', 'mask', 'use'
    ]);
    const GLOBAL_ATTR_ALLOWLIST = new Set([
        'id', 'class', 'style', 'slot', 'part', 'lang', 'title', 'dir', 'hidden', 'tabindex', 'draggable', 'inert',
        'contenteditable', 'enterkeyhint', 'inputmode', 'spellcheck', 'autocapitalize', 'exportparts', 'nonce',
        'popover', 'translate', 'is', 'itemid', 'itemprop', 'itemref', 'itemscope', 'itemtype', 'accesskey', 'autofocus'
    ]);
    const DEBUG_CACHE = !!opts.debugCache;
    const IGNORE_UNDEFINED = !!opts.ignoreUndefined;
    const IGNORE_ATTRIBUTE = !!opts.ignoreAttribute;
    // --- Caches (par exécution de diagnostics)
    const scopedElementsCache = new WeakMap();
    const instanceTypeCache = new WeakMap();
    const propTypeCache = new WeakMap();
    const arrayElemTypeCache = new WeakMap();
    const widenedTypeCache = new WeakMap();
    const log = (m) => { var _a; if ((DEBUG_CACHE) && ((_a = ts.sys) === null || _a === void 0 ? void 0 : _a.log))
        ts.sys.log(`[lit-plugin] ${m}`); };
    const isNativeTag = (tag) => (!tag.includes('-')) || KNOWN_HTML_TAGS.has(tag) || KNOWN_SVG_TAGS.has(tag);
    const kebabToCamel = (s) => s.replace(/-([\da-z])/g, (_m, c) => c.toUpperCase());
    const typeToString = (t) => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
        ts.TypeFormatFlags.UseFullyQualifiedType);
    function findLitClasses(file) {
        const out = [];
        const isLitElement = (node) => {
            var _a, _b, _c, _d, _e;
            const ext = (_a = node.heritageClauses) === null || _a === void 0 ? void 0 : _a.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
            const expr = (_c = (_b = ext === null || ext === void 0 ? void 0 : ext.types) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.expression;
            if (!expr)
                return false;
            const t = checker.getTypeAtLocation(expr);
            const name = (_e = (_d = t.symbol) === null || _d === void 0 ? void 0 : _d.getName()) !== null && _e !== void 0 ? _e : '';
            if (name === 'LitElement')
                return true;
            return /\bLitElement\b/.test(typeToString(t));
        };
        const visit = (n) => {
            if (ts.isClassDeclaration(n) && n.name && isLitElement(n))
                out.push(n);
            n.forEachChild(visit);
        };
        file.forEachChild(visit);
        return out;
    }
    function readScopedElementsMapRaw(cls) {
        const map = new Map();
        const staticProp = cls.members.find(m => {
            var _a;
            return ts.isPropertyDeclaration(m) &&
                ((_a = m.modifiers) === null || _a === void 0 ? void 0 : _a.some(md => md.kind === ts.SyntaxKind.StaticKeyword)) &&
                ts.isIdentifier(m.name) && m.name.text === 'scopedElements';
        });
        if ((staticProp === null || staticProp === void 0 ? void 0 : staticProp.initializer) && ts.isObjectLiteralExpression(staticProp.initializer)) {
            for (const p of staticProp.initializer.properties)
                if (ts.isPropertyAssignment(p)) {
                    const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
                    if (key)
                        map.set(key, p.initializer);
                }
            return map;
        }
        const staticGetter = cls.members.find(m => {
            var _a;
            return ts.isGetAccessor(m) &&
                ((_a = m.modifiers) === null || _a === void 0 ? void 0 : _a.some(md => md.kind === ts.SyntaxKind.StaticKeyword)) &&
                ts.isIdentifier(m.name) && m.name.text === 'scopedElements';
        });
        if (staticGetter === null || staticGetter === void 0 ? void 0 : staticGetter.body) {
            const ret = staticGetter.body.statements.find(st => ts.isReturnStatement(st));
            const expr = ret === null || ret === void 0 ? void 0 : ret.expression;
            if (expr && ts.isObjectLiteralExpression(expr)) {
                for (const p of expr.properties)
                    if (ts.isPropertyAssignment(p)) {
                        const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
                        if (key)
                            map.set(key, p.initializer);
                    }
            }
        }
        return map;
    }
    const readScopedElementsMap = (cls) => {
        var _a;
        const cached = scopedElementsCache.get(cls);
        if (cached)
            return { map: cached };
        const map = readScopedElementsMapRaw(cls);
        scopedElementsCache.set(cls, map);
        log(`scopedElements cached for ${(_a = cls.name) === null || _a === void 0 ? void 0 : _a.getText()}`);
        return { map };
    };
    function getInstanceTypeFromClassRef(expr) {
        const c = instanceTypeCache.get(expr);
        if (c)
            return c;
        let v = null;
        const sym = checker.getSymbolAtLocation(expr);
        if (sym) {
            try {
                const inst = checker.getDeclaredTypeOfSymbol(sym);
                if (inst)
                    v = inst;
            }
            catch { }
        }
        if (!v) {
            const t = checker.getTypeAtLocation(expr);
            const proto = t.getProperty('prototype');
            if (proto) {
                const protoType = checker.getTypeOfSymbolAtLocation(proto, expr);
                v = checker.getApparentType(protoType);
            }
        }
        if (v)
            instanceTypeCache.set(expr, v);
        return v;
    }
    function getPropTypeOnElementClass(elemInstanceType, propName) {
        var _a, _b;
        let map = propTypeCache.get(elemInstanceType);
        if (!map) {
            map = new Map();
            propTypeCache.set(elemInstanceType, map);
        }
        if (map.has(propName))
            return map.get(propName);
        const sym = elemInstanceType.getProperty(propName);
        if (!sym) {
            map.set(propName, null);
            return null;
        }
        const decl = (_a = sym.valueDeclaration) !== null && _a !== void 0 ? _a : (_b = sym.declarations) === null || _b === void 0 ? void 0 : _b[0];
        if (!decl) {
            map.set(propName, null);
            return null;
        }
        let result;
        if (ts.isPropertyDeclaration(decl) || ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl)) {
            if (decl.type) {
                result = checker.getTypeFromTypeNode(decl.type);
            }
            else {
                const init = decl.initializer;
                result = init ? checker.getTypeAtLocation(init) : checker.getTypeAtLocation(decl);
            }
        }
        else {
            result = checker.getTypeAtLocation(decl);
        }
        map.set(propName, result);
        return result;
    }
    function getArrayElementType(t) {
        var _a;
        if (arrayElemTypeCache.has(t))
            return arrayElemTypeCache.get(t);
        const idx = (_a = checker.getIndexTypeOfType(t, ts.IndexKind.Number)) !== null && _a !== void 0 ? _a : null;
        arrayElemTypeCache.set(t, idx);
        return idx;
    }
    const typeHasFlag = (t, flag) => t.isUnion() ? t.types.some(tp => typeHasFlag(tp, flag)) : !!(t.flags & flag);
    const hasUndefined = (t) => typeHasFlag(t, ts.TypeFlags.Undefined);
    const hasNull = (t) => typeHasFlag(t, ts.TypeFlags.Null);
    function dropUndefinedForAssignability(t) {
        if (hasUndefined(t) && !hasNull(t))
            return checker.getNonNullableType(t);
        return t;
    }
    function widenLiterals(t) {
        if (widenedTypeCache.has(t))
            return widenedTypeCache.get(t);
        const v = checker.getBaseTypeOfLiteralType
            ? checker.getBaseTypeOfLiteralType(t)
            : checker.getApparentType(t);
        widenedTypeCache.set(t, v);
        return v;
    }
    function rebuildTemplateAndOffsets(tagged, file) {
        if (!ts.isTemplateExpression(tagged.template)) {
            const headText = tagged.template.text;
            const start = tagged.template.getStart(file) + 1;
            const text = headText;
            const offsetToPos = (i) => start + i;
            return { text, offsetToPos };
        }
        const { head } = tagged.template;
        const spans = tagged.template.templateSpans;
        const chunks = [];
        const headStart = head.getStart(file) + 1;
        chunks.push({ text: head.text, startInFile: headStart });
        for (const span of spans) {
            const lit = span.literal;
            const litStart = lit.getStart(file) + 1;
            chunks.push({ text: lit.text, startInFile: litStart });
        }
        const text = chunks.map(c => c.text).join('');
        const cumulative = [];
        let acc = 0;
        for (const c of chunks) {
            cumulative.push(acc);
            acc += c.text.length;
        }
        const offsetToPos = (i) => {
            let lo = 0, hi = chunks.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const base = cumulative[mid];
                const next = mid + 1 < cumulative.length ? cumulative[mid + 1] : text.length;
                if (i < base)
                    hi = mid - 1;
                else if (i >= next)
                    lo = mid + 1;
                else
                    return chunks[mid].startInFile + (i - base);
            }
            return chunks[0].startInFile + i;
        };
        return { text, offsetToPos };
    }
    function collectBindingsFromTemplate(tagged) {
        const results = [];
        if (!ts.isTemplateExpression(tagged.template))
            return results;
        let currentTag = null;
        const updateTagFromText = (text) => {
            const m = /<([\da-z-]+)([^>]*)$/i.exec(text);
            if (m)
                currentTag = m[1].toLowerCase();
        };
        const findPropLeft = (text) => {
            const m = /\.(\w+)\s*=\s*$/.exec(text);
            return m ? m[1] : null;
        };
        const headText = tagged.template.head.text;
        updateTagFromText(headText);
        let leftTail = headText;
        for (const span of tagged.template.templateSpans) {
            const expr = span.expression;
            const leftText = leftTail;
            const prop = findPropLeft(leftText);
            if (currentTag && prop)
                results.push({ tag: currentTag, prop, expr });
            const lit = span.literal.text;
            updateTagFromText(`${leftText}\${...}${lit}`);
            leftTail = lit;
        }
        return results;
    }
    function isGlobalAttr(attr) {
        if (GLOBAL_ATTR_ALLOWLIST.has(attr))
            return true;
        if (/^aria-[\w-]+$/.test(attr))
            return true;
        if (/^data-[\w-]+$/.test(attr))
            return true;
        if (attr === 'role')
            return true;
        return false;
    }
    function collectStaticAttrsFromTemplate(tagged, file) {
        const out = [];
        const { text } = rebuildTemplateAndOffsets(tagged, file);
        const scrubbed = text.replace(/\${[\S\s]*?}/g, '§EXPR§');
        const tagRe = /<\s*([\da-z-]+)\b([^>]*?)>/gi;
        let m;
        while ((m = tagRe.exec(scrubbed))) {
            const tag = m[1].toLowerCase();
            const attrsChunk = m[2];
            if (isNativeTag(tag))
                continue;
            const attrRe = /([.:?@]?)([\w:-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=>]+))?/g;
            let a;
            while ((a = attrRe.exec(attrsChunk))) {
                const prefix = a[1];
                const rawName = a[2];
                const attrStartInTag = a.index;
                const indexInText = m.index + m[0].indexOf(attrsChunk) + attrStartInTag;
                if (prefix === '.' || prefix === '@' || prefix === '?')
                    continue;
                if (!rawName)
                    continue;
                const name = rawName.toLowerCase();
                if (isGlobalAttr(name))
                    continue;
                if (name === 'part' || name === 'slot')
                    continue;
                if (name.startsWith('xmlns'))
                    continue;
                const slice = attrsChunk.slice(attrStartInTag, attrStartInTag + a[0].length);
                if (slice.includes('§EXPR§'))
                    continue;
                const hasEquals = slice.includes('=');
                out.push({ tag, attr: name, booleanish: !hasEquals, indexInText });
            }
        }
        return out;
    }
    function isEmptyArrayLiteral(node) {
        if (ts.isArrayLiteralExpression(node))
            return node.elements.length === 0;
        if (ts.isParenthesizedExpression(node))
            return isEmptyArrayLiteral(node.expression);
        return false;
    }
    function checkClass(cls) {
        var _a, _b;
        const clsName = (_b = (_a = cls.name) === null || _a === void 0 ? void 0 : _a.getText()) !== null && _b !== void 0 ? _b : '<anonymous>';
        const { map: scopedMap } = readScopedElementsMap(cls);
        const visit = (n) => {
            if (ts.isTaggedTemplateExpression(n)) {
                const { tag } = n;
                const isHtmlTag = (ts.isIdentifier(tag) && tag.text === 'html') ||
                    (ts.isPropertyAccessExpression(tag) && tag.name.text === 'html');
                if (isHtmlTag) {
                    // 1) .prop bindings
                    for (const b of collectBindingsFromTemplate(n)) {
                        if (isNativeTag(b.tag))
                            continue;
                        const elemExpr = scopedMap.get(b.tag);
                        if (!elemExpr) {
                            diags.push({
                                file: sf,
                                category: ts.DiagnosticCategory.Error,
                                code: 90010,
                                messageText: `${clsName} → <${b.tag}> non résolu dans scopedElements`,
                                start: b.expr.getStart(),
                                length: b.expr.getWidth(),
                            });
                            continue;
                        }
                        const instanceType = getInstanceTypeFromClassRef(elemExpr) || checker.getTypeAtLocation(elemExpr);
                        const propType = getPropTypeOnElementClass(instanceType, b.prop);
                        if (!propType) {
                            diags.push({
                                file: sf, category: ts.DiagnosticCategory.Error, code: 90011,
                                messageText: `${clsName} → <${b.tag}> .${b.prop} introuvable sur la classe`,
                                start: b.expr.getStart(), length: b.expr.getWidth()
                            });
                            continue;
                        }
                        const exprType = checker.getTypeAtLocation(b.expr);
                        const propTypeW = widenLiterals(propType);
                        const exprTypeW = widenLiterals(exprType);
                        let ok = checker.isTypeAssignableTo(exprTypeW, propTypeW);
                        const elemOfProp = getArrayElementType(propTypeW);
                        if (!ok && elemOfProp && isEmptyArrayLiteral(b.expr))
                            ok = true;
                        if (!ok && IGNORE_UNDEFINED) {
                            const exprAdj = dropUndefinedForAssignability(exprTypeW);
                            const propAdj = dropUndefinedForAssignability(propTypeW);
                            if (checker.isTypeAssignableTo(exprAdj, propTypeW) ||
                                checker.isTypeAssignableTo(exprTypeW, propAdj) ||
                                checker.isTypeAssignableTo(exprAdj, propAdj))
                                ok = true;
                        }
                        if (!ok) {
                            const expected = typeToString(propType);
                            const got = typeToString(exprType);
                            diags.push({
                                file: sf, category: ts.DiagnosticCategory.Error, code: 90012,
                                messageText: `${clsName} → <${b.tag}> .${b.prop} type mismatch. Attendu: ${expected}, reçu: ${got}`,
                                start: b.expr.getStart(), length: b.expr.getWidth()
                            });
                        }
                    }
                    // 2) attributs statiques (optionnel)
                    if (!IGNORE_ATTRIBUTE) {
                        const staticAttrs = collectStaticAttrsFromTemplate(n, sf);
                        const { offsetToPos } = rebuildTemplateAndOffsets(n, sf);
                        for (const sa of staticAttrs) {
                            const elemExpr = scopedMap.get(sa.tag);
                            const pos = offsetToPos(sa.indexInText);
                            if (!elemExpr) {
                                diags.push({
                                    file: sf, category: ts.DiagnosticCategory.Warning, code: 90020,
                                    messageText: `${clsName} → <${sa.tag}> attribut "${sa.attr}" non résolu (élément non typé)`,
                                    start: pos, length: sa.attr.length
                                });
                                continue;
                            }
                            const instanceType = getInstanceTypeFromClassRef(elemExpr) || checker.getTypeAtLocation(elemExpr);
                            const propName = kebabToCamel(sa.attr);
                            const propType = getPropTypeOnElementClass(instanceType, propName);
                            if (!propType) {
                                diags.push({
                                    file: sf, category: ts.DiagnosticCategory.Warning, code: 90021,
                                    messageText: `${clsName} → <${sa.tag}> attribut inconnu: ${sa.attr} (propriété "${propName}" absente)`,
                                    start: pos, length: sa.attr.length
                                });
                            }
                        }
                    }
                }
            }
            n.forEachChild(visit);
        };
        cls.forEachChild(visit);
    }
    for (const cls of findLitClasses(sf))
        checkClass(cls);
    return diags;
}
