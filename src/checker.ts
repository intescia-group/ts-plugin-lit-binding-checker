import ts from 'typescript';
import type { TS, PluginOptions } from './types';

export function runChecksOnSourceFile(
  ts: TS,
  program: ts.Program,
  sf: ts.SourceFile,
  opts: PluginOptions
): ts.Diagnostic[] {
  const checker = program.getTypeChecker();
  const diags: ts.Diagnostic[] = [];

  const KNOWN_HTML_TAGS = new Set([
    'div','span','input','button','a','label','ul','li','ol','p','section','article','header','footer','nav','main','aside','img','textarea','select','option','form','table','thead','tbody','tfoot','tr','td','th','video','audio','canvas','svg'
  ]);
  const KNOWN_SVG_TAGS = new Set([
    'svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','defs','clipPath','mask','use'
  ]);
  const GLOBAL_ATTR_ALLOWLIST = new Set([
    'id','class','style','slot','part','lang','title','dir','hidden','tabindex','draggable','inert',
    'contenteditable','enterkeyhint','inputmode','spellcheck','autocapitalize','exportparts','nonce',
    'popover','translate','is','itemid','itemprop','itemref','itemscope','itemtype','accesskey','autofocus'
  ]);

  const DEBUG_CACHE = !!opts.debugCache;
  const IGNORE_UNDEFINED = !!opts.ignoreUndefined;
  const IGNORE_ATTRIBUTE = !!opts.ignoreAttribute;

  // --- Caches (par exécution de diagnostics)
  const scopedElementsCache = new WeakMap<ts.ClassDeclaration, Map<string, ts.Expression>>();
  const instanceTypeCache = new WeakMap<ts.Expression, ts.Type>();
  const propTypeCache = new WeakMap<ts.Type, Map<string, ts.Type | null>>();
  const propOptionalCache = new WeakMap<ts.Type, Map<string, boolean>>();
  const arrayElemTypeCache = new WeakMap<ts.Type, ts.Type | null>();
  const widenedTypeCache = new WeakMap<ts.Type, ts.Type>();

  const log = (m: string) => { if ((DEBUG_CACHE) && (ts as any).sys?.log) (ts as any).sys.log(`[lit-plugin] ${m}`); };
  const isNativeTag = (tag: string) => (!tag.includes('-')) || KNOWN_HTML_TAGS.has(tag) || KNOWN_SVG_TAGS.has(tag);
  const kebabToCamel = (s: string) => s.replace(/-([\da-z])/g, (_m, c: string) => c.toUpperCase());

  /** Find property name on element matching attribute (case-insensitive) */
  function findPropertyNameForAttribute(elemInstanceType: ts.Type, attrName: string): string | null {
    // First try exact match with kebab-to-camel conversion
    const camelName = kebabToCamel(attrName);
    if (elemInstanceType.getProperty(camelName)) return camelName;
    
    // Then try case-insensitive match (for attributes like showListing -> showlisting)
    const props = elemInstanceType.getProperties();
    const lowerAttr = attrName.toLowerCase();
    for (const prop of props) {
      if (prop.getName().toLowerCase() === lowerAttr) {
        return prop.getName();
      }
    }
    return null;
  }

  const typeToString = (t: ts.Type) =>
    checker.typeToString(
      t,
      undefined,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
        ts.TypeFormatFlags.UseFullyQualifiedType
    );

  function findLitClasses(file: ts.SourceFile): ts.ClassDeclaration[] {
    const out: ts.ClassDeclaration[] = [];
    const isLitElement = (node: ts.ClassDeclaration) => {
      const ext = node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
      const expr = ext?.types?.[0]?.expression;
      if (!expr) return false;
      const t = checker.getTypeAtLocation(expr);
      const name = t.symbol?.getName() ?? '';
      if (name === 'LitElement') return true;
      return /\bLitElement\b/.test(typeToString(t));
    };
    const visit = (n: ts.Node) => {
      if (ts.isClassDeclaration(n) && n.name && isLitElement(n)) out.push(n);
      n.forEachChild(visit);
    };
    file.forEachChild(visit);
    return out;
  }

  type ScopedMap = Map<string, ts.Expression>;

  function readScopedElementsMapRaw(cls: ts.ClassDeclaration): ScopedMap {
    const map: ScopedMap = new Map();
    
    // 1) Static scopedElements property
    const staticProp = cls.members.find(
      m => ts.isPropertyDeclaration(m) &&
      m.modifiers?.some(md => md.kind === ts.SyntaxKind.StaticKeyword) &&
      ts.isIdentifier(m.name) && m.name.text === 'scopedElements'
    ) as ts.PropertyDeclaration | undefined;

    if (staticProp?.initializer && ts.isObjectLiteralExpression(staticProp.initializer)) {
      for (const p of staticProp.initializer.properties) if (ts.isPropertyAssignment(p)) {
        const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
        if (key) map.set(key, p.initializer);
      }
    }

    // 2) Static scopedElements getter
    const staticGetter = cls.members.find(
      m => ts.isGetAccessor(m) &&
      m.modifiers?.some(md => md.kind === ts.SyntaxKind.StaticKeyword) &&
      ts.isIdentifier(m.name) && m.name.text === 'scopedElements'
    ) as ts.GetAccessorDeclaration | undefined;

    if (staticGetter?.body) {
      const ret = staticGetter.body.statements.find(st => ts.isReturnStatement(st)) as ts.ReturnStatement | undefined;
      const expr = ret?.expression;
      if (expr && ts.isObjectLiteralExpression(expr)) {
        for (const p of expr.properties) if (ts.isPropertyAssignment(p)) {
          const key = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
          if (key) map.set(key, p.initializer);
        }
      }
    }

    // 3) Dynamic this.registry?.define() calls throughout the class
    const visitForRegistryDefine = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        // Match: this.registry?.define(...) or this.registry.define(...)
        if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'define') {
          const obj = expr.expression;
          // this.registry?.define or this.registry.define
          const isRegistryDefine = 
            (ts.isPropertyAccessExpression(obj) && obj.name.text === 'registry') ||
            (ts.isNonNullExpression(obj) && ts.isPropertyAccessExpression(obj.expression) && obj.expression.name.text === 'registry');
          
          if (isRegistryDefine && node.arguments.length >= 2) {
            const tagArg = node.arguments[0];
            const classArg = node.arguments[1];
            if (ts.isStringLiteral(tagArg)) {
              map.set(tagArg.text, classArg);
            }
          }
        }
      }
      ts.forEachChild(node, visitForRegistryDefine);
    };
    cls.forEachChild(visitForRegistryDefine);

    return map;
  }
  const readScopedElementsMap = (cls: ts.ClassDeclaration): { map: ScopedMap } => {
    const cached = scopedElementsCache.get(cls);
    if (cached) return { map: cached };
    const map = readScopedElementsMapRaw(cls);
    scopedElementsCache.set(cls, map);
    log(`scopedElements cached for ${cls.name?.getText()}`);
    return { map };
  };

  function getInstanceTypeFromClassRef(expr: ts.Expression): ts.Type | null {
    const c = instanceTypeCache.get(expr);
    if (c) return c;
    let v: ts.Type | null = null;
    const sym = checker.getSymbolAtLocation(expr);
    if (sym) {
      try {
        const inst = checker.getDeclaredTypeOfSymbol(sym);
        if (inst) v = inst;
      } catch {}
    }
    if (!v) {
      const t = checker.getTypeAtLocation(expr);
      const proto = t.getProperty('prototype');
      if (proto) {
        const protoType = checker.getTypeOfSymbolAtLocation(proto, expr);
        v = checker.getApparentType(protoType);
      }
    }
    if (v) instanceTypeCache.set(expr, v);
    return v;
  }
function typeContainsUndefined(t: ts.Type): boolean {
  if (t.flags & ts.TypeFlags.Undefined) return true;
  if (t.flags & ts.TypeFlags.Union) {
    const ut = t as ts.UnionType;
    return ut.types.some(typeContainsUndefined);
  }
  return false;
}

function forAllNonUndefinedConstituentsAssignableTo(
  valueType: ts.Type,
  targetType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  if (valueType.flags & ts.TypeFlags.Union) {
    const ut = valueType as ts.UnionType;
    // Tous les constituants (sauf undefined) doivent être assignables
    return ut.types
      .filter(t => !(t.flags & ts.TypeFlags.Undefined))
      .every(t => checker.isTypeAssignableTo(t, targetType));
  }
  // Pas une union -> test simple
  return checker.isTypeAssignableTo(valueType, targetType);
}

  function getPropTypeOnElementClass(elemInstanceType: ts.Type, propName: string): ts.Type | null {
    let map = propTypeCache.get(elemInstanceType);
    if (!map) { map = new Map(); propTypeCache.set(elemInstanceType, map); }
    if (map.has(propName)) return map.get(propName)!;

    const sym = elemInstanceType.getProperty(propName);
    if (!sym) { map.set(propName, null); return null; }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) { map.set(propName, null); return null; }

    let result: ts.Type;
    if (ts.isPropertyDeclaration(decl) || ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl)) {
      if ((decl as ts.PropertyDeclaration).type) {
        result = checker.getTypeFromTypeNode((decl as ts.PropertyDeclaration).type!);
      } else {
        const init = (decl as ts.PropertyDeclaration).initializer;
        result = init ? checker.getTypeAtLocation(init) : checker.getTypeAtLocation(decl);
      }
    } else {
      result = checker.getTypeAtLocation(decl);
    }
    map.set(propName, result);
    return result;
  }

  function getPropOptionalOnElementClass(elemInstanceType: ts.Type, propName: string): boolean {
    let map = propOptionalCache.get(elemInstanceType);
    if (!map) { map = new Map(); propOptionalCache.set(elemInstanceType, map); }
    if (map.has(propName)) return map.get(propName)!;

    const sym = elemInstanceType.getProperty(propName);
    if (!sym) { map.set(propName, false); return false; }
    const decl = (sym as any).valueDeclaration ?? sym.declarations?.[0];
    if (!decl) { map.set(propName, false); return false; }

    let isOptional = false;
    if (ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) {
      isOptional = !!(decl as any).questionToken;
    }
    map.set(propName, isOptional);
    return isOptional;
  }

  function getArrayElementType(t: ts.Type): ts.Type | null {
    if (arrayElemTypeCache.has(t)) return arrayElemTypeCache.get(t)!;
    const idx = checker.getIndexTypeOfType(t, ts.IndexKind.Number) ?? null;
    arrayElemTypeCache.set(t, idx);
    return idx;
  }

  const typeHasFlag = (t: ts.Type, flag: ts.TypeFlags): boolean =>
    t.isUnion() ? t.types.some(tp => typeHasFlag(tp, flag)) : !!(t.flags & flag);
  const hasUndefined = (t: ts.Type) => typeHasFlag(t, ts.TypeFlags.Undefined);
  const hasNull = (t: ts.Type) => typeHasFlag(t, ts.TypeFlags.Null);

  function dropUndefinedForAssignability(t: ts.Type): ts.Type {
    if (hasUndefined(t) && !hasNull(t)) return checker.getNonNullableType(t);
    return t;
  }
  function widenLiterals(t: ts.Type): ts.Type {
    if (widenedTypeCache.has(t)) return widenedTypeCache.get(t)!;
    const v = (checker as any).getBaseTypeOfLiteralType
      ? (checker as any).getBaseTypeOfLiteralType(t)
      : checker.getApparentType(t);
    widenedTypeCache.set(t, v);
    return v;
  }

  function rebuildTemplateAndOffsets(tagged: ts.TaggedTemplateExpression, file: ts.SourceFile) {
    if (!ts.isTemplateExpression(tagged.template)) {
      const headText = (tagged.template as ts.NoSubstitutionTemplateLiteral).text;
      const start = tagged.template.getStart(file) + 1;
      const text = headText;
      const offsetToPos = (i: number) => start + i;
      return { text, offsetToPos };
    }
    const { head } = tagged.template;
    const spans = tagged.template.templateSpans;

    const chunks: Array<{ text: string; startInFile: number }> = [];
    const headStart = head.getStart(file) + 1;
    chunks.push({ text: head.text, startInFile: headStart });

    for (const span of spans) {
      const lit = span.literal;
      const litStart = lit.getStart(file) + 1;
      chunks.push({ text: lit.text, startInFile: litStart });
    }

    const text = chunks.map(c => c.text).join('');
    const cumulative: number[] = [];
    let acc = 0;
    for (const c of chunks) { cumulative.push(acc); acc += c.text.length; }

    const offsetToPos = (i: number) => {
      let lo = 0, hi = chunks.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const base = cumulative[mid];
        const next = mid + 1 < cumulative.length ? cumulative[mid + 1] : text.length;
        if (i < base) hi = mid - 1;
        else if (i >= next) lo = mid + 1;
        else return chunks[mid].startInFile + (i - base);
      }
      return chunks[0].startInFile + i;
    };
    return { text, offsetToPos };
  }

  function collectBindingsFromTemplate(tagged: ts.TaggedTemplateExpression)
  : Array<{ tag: string; prop: string; expr: ts.Expression }> {
    const results: Array<{ tag: string; prop: string; expr: ts.Expression }> = [];
    if (!ts.isTemplateExpression(tagged.template)) return results;

    // Build full accumulated text to properly track tag context
    let accumulatedText = tagged.template.head.text;
    
    const findCurrentTag = (text: string): string | null => {
      // Find the last opened tag that hasn't been closed
      // We need to track all tags and their open/close status
      let lastOpenTag: string | null = null;
      const tagOpenRe = /<([\da-z-]+)\b/gi;
      const tagCloseRe = /<\/([\da-z-]+)\s*>|\/>/g;
      
      // Find all tag openings
      const openings: Array<{ tag: string; index: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = tagOpenRe.exec(text))) {
        openings.push({ tag: m[1].toLowerCase(), index: m.index });
      }
      
      // Find the last tag opening that we're still inside of
      // We're inside a tag if we found '<tagname' but not the closing '>'
      for (let i = openings.length - 1; i >= 0; i--) {
        const opening = openings[i];
        const afterTag = text.slice(opening.index);
        // Check if this tag is still open (no '>' after the tag name yet, or we're in attributes)
        const closeIdx = afterTag.indexOf('>');
        if (closeIdx === -1) {
          // Tag is not closed yet, we're inside its attributes
          lastOpenTag = opening.tag;
          break;
        }
      }
      
      return lastOpenTag;
    };
    
    const findPropLeft = (text: string): string | null => {
      const m = /\.(\w+)\s*=\s*$/.exec(text);
      return m ? m[1] : null;
    };

    for (const span of tagged.template.templateSpans) {
      const expr = span.expression;
      const prop = findPropLeft(accumulatedText);
      const currentTag = findCurrentTag(accumulatedText);
      
      if (currentTag && prop) {
        results.push({ tag: currentTag, prop, expr });
      }
      
      // Add placeholder for expression and the literal text after it
      accumulatedText += '${...}' + span.literal.text;
    }
    return results;
  }

  /** Collect @event bindings from a tagged template expression */
  function collectEventBindingsFromTemplate(tagged: ts.TaggedTemplateExpression)
  : Array<{ tag: string; eventName: string; expr: ts.Expression }> {
    const results: Array<{ tag: string; eventName: string; expr: ts.Expression }> = [];
    if (!ts.isTemplateExpression(tagged.template)) return results;

    let accumulatedText = tagged.template.head.text;
    
    const findCurrentTag = (text: string): string | null => {
      let lastOpenTag: string | null = null;
      const tagOpenRe = /<([\da-z-]+)\b/gi;
      
      const openings: Array<{ tag: string; index: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = tagOpenRe.exec(text))) {
        openings.push({ tag: m[1].toLowerCase(), index: m.index });
      }
      
      for (let i = openings.length - 1; i >= 0; i--) {
        const opening = openings[i];
        const afterTag = text.slice(opening.index);
        const closeIdx = afterTag.indexOf('>');
        if (closeIdx === -1) {
          lastOpenTag = opening.tag;
          break;
        }
      }
      
      return lastOpenTag;
    };
    
    const findEventLeft = (text: string): string | null => {
      const m = /@([\w-]+)\s*=\s*$/.exec(text);
      return m ? m[1] : null;
    };

    for (const span of tagged.template.templateSpans) {
      const expr = span.expression;
      const eventName = findEventLeft(accumulatedText);
      const currentTag = findCurrentTag(accumulatedText);
      
      if (currentTag && eventName) {
        results.push({ tag: currentTag, eventName, expr });
      }
      
      accumulatedText += '${...}' + span.literal.text;
    }
    return results;
  }

  interface EventInfo {
    node: ts.NewExpression | null;
    detailType: string | null;
    fromJsDoc: boolean;
  }

  /** Parse @fires JSDoc tags from a class to find event declarations */
  function findEventFromJsDoc(classDecl: ts.Node, eventName: string): { detailType: string | null } | null {
    const checkJsDoc = (node: ts.Node): { detailType: string | null } | null => {
      const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
      if (jsDocs) {
        for (const jsDoc of jsDocs) {
          if (jsDoc.tags) {
            for (const tag of jsDoc.tags) {
              if (tag.tagName.text === 'fires' || tag.tagName.text === 'event') {
                let comment: string | undefined;
                if (typeof tag.comment === 'string') {
                  comment = tag.comment;
                } else if (Array.isArray(tag.comment)) {
                  comment = tag.comment.map((c: any) => c.text || '').join('');
                } else if (tag.comment) {
                  comment = String(tag.comment);
                }
                
                const parts = comment?.split(/\s+-\s+|\s+/) || [];
                const tagEventName = parts[0]?.trim();
                
                if (tagEventName === eventName) {
                  let detailType: string | null = null;
                  const typeMatch = comment?.match(/`([^`]+)`/);
                  if (typeMatch) {
                    detailType = typeMatch[1];
                  }
                  return { detailType };
                }
              }
            }
          }
        }
      }
      return null;
    };

    const classResult = checkJsDoc(classDecl);
    if (classResult) return classResult;

    if (ts.isClassDeclaration(classDecl)) {
      for (const member of classDecl.members) {
        const memberResult = checkJsDoc(member);
        if (memberResult) return memberResult;
      }
    }

    return null;
  }

  function findCustomEventInClass(classDecl: ts.Node, eventName: string): EventInfo | null {
    let result: ts.NewExpression | null = null;

    const visit = (node: ts.Node) => {
      if (result) return;

      if (ts.isNewExpression(node)) {
        const expr = node.expression;
        if (ts.isIdentifier(expr) && expr.text === 'CustomEvent') {
          const args = node.arguments;
          if (args && args.length > 0) {
            const firstArg = args[0];
            if (ts.isStringLiteral(firstArg) && firstArg.text === eventName) {
              result = node;
              return;
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(classDecl, visit);
    
    if (result) {
      return { node: result, detailType: null, fromJsDoc: false };
    }
    
    // Try JSDoc
    const jsDocResult = findEventFromJsDoc(classDecl, eventName);
    if (jsDocResult) {
      return { node: null, detailType: jsDocResult.detailType, fromJsDoc: true };
    }
    
    return null;
  }

  /** Parse @slot JSDoc tags from a class to get declared slots */
  function getSlotsFromJsDoc(classDecl: ts.Node): Set<string> {
    const slots = new Set<string>();
    
    const checkJsDoc = (node: ts.Node) => {
      const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
      if (jsDocs) {
        for (const jsDoc of jsDocs) {
          if (jsDoc.tags) {
            for (const tag of jsDoc.tags) {
              if (tag.tagName.text === 'slot') {
                let comment: string | undefined;
                if (typeof tag.comment === 'string') {
                  comment = tag.comment;
                } else if (Array.isArray(tag.comment)) {
                  comment = tag.comment.map((c: any) => c.text || '').join('');
                } else if (tag.comment) {
                  comment = String(tag.comment);
                }
                
                // Parse: "slotName - description" or "- Default slot" (empty name = default)
                // Also handle "(default) - description" as default slot
                const trimmed = comment?.trim() || '';
                if (trimmed.startsWith('-')) {
                  // Default slot: "@slot - description"
                  slots.add('');
                } else {
                  // Named slot: "@slot slotName - description"
                  const parts = trimmed.split(/\s+-\s+|\s+/);
                  const slotName = parts[0]?.trim() || '';
                  // Recognize "(default)" as the default slot
                  if (slotName === '(default)' || slotName === 'default') {
                    slots.add('');
                  } else {
                    slots.add(slotName);
                  }
                }
              }
            }
          }
        }
      }
    };

    // Check class-level JSDoc
    checkJsDoc(classDecl);

    // Also check members (in case slots are documented on methods)
    if (ts.isClassDeclaration(classDecl)) {
      for (const member of classDecl.members) {
        checkJsDoc(member);
      }
    }

    return slots;
  }

  interface SlotUsage {
    parentTag: string;
    slotName: string; // empty string = default slot
    indexInText: number;
    isDefaultSlot: boolean;
  }

  /** Collect slot usages from a template, including default slot (children without slot attr) */
  function collectSlotUsagesFromTemplate(
    tagged: ts.TaggedTemplateExpression,
    sf: ts.SourceFile
  ): Array<SlotUsage> {
    const out: Array<SlotUsage> = [];
    const { text } = rebuildTemplateAndOffsets(tagged, sf);

    // Scrub expressions but keep track of their positions
    const scrubbed = text.replace(/\${[\S\s]*?}/g, (m) => '§'.repeat(m.length));

    // Track parent tags using a stack approach
    interface TagInfo {
      tag: string;
      isCustom: boolean;
      startIndex: number;
      endIndex: number;
      isClosing: boolean;
      isSelfClosing: boolean;
      hasSlotAttr: boolean;
    }
    
    const tags: TagInfo[] = [];
    const tagRe = /<(\/?)([\da-z-]+)([^>]*?)(\/?)>/gi;
    let m: RegExpExecArray | null;
    
    // Track which custom elements have children (for default slot detection)
    const customElementsWithChildren = new Map<string, { tag: string; index: number; hasDefaultSlotChild: boolean }>();
    
    while ((m = tagRe.exec(scrubbed))) {
      const isClosing = m[1] === '/';
      const tagName = m[2].toLowerCase();
      const attrsChunk = m[3];
      const isSelfClosing = m[4] === '/' || ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'].includes(tagName);
      const isCustom = tagName.includes('-');
      
      // Check if this tag has a slot attribute
      const hasSlotAttr = !isClosing && attrsChunk ? /\bslot\s*=\s*["'][^"']*["']/i.test(attrsChunk) : false;
      
      tags.push({
        tag: tagName,
        isCustom,
        startIndex: m.index,
        endIndex: m.index + m[0].length,
        isClosing,
        isSelfClosing: isSelfClosing && !isClosing,
        hasSlotAttr
      });

      // Build current stack to find parent
      const stack: Array<{ tag: string; index: number }> = [];
      for (const prevTag of tags.slice(0, -1)) {
        if (prevTag.isClosing) {
          if (stack.length > 0 && stack[stack.length - 1].tag === prevTag.tag) {
            stack.pop();
          }
        } else if (!prevTag.isSelfClosing) {
          stack.push({ tag: prevTag.tag, index: prevTag.startIndex });
        }
      }

      // If this is an opening tag (not closing, not self-closing), check for slot attribute
      if (!isClosing && attrsChunk) {
        const slotMatch = /\bslot\s*=\s*["']([^"']*)["']/i.exec(attrsChunk);
        if (slotMatch) {
          const slotName = slotMatch[1];
          const slotAttrIndex = m.index + m[0].indexOf(attrsChunk) + slotMatch.index;
          
          // Find the nearest custom element parent
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].tag.includes('-')) {
              out.push({
                parentTag: stack[i].tag,
                slotName,
                indexInText: slotAttrIndex,
                isDefaultSlot: false
              });
              break;
            }
          }
        }
      }

      // Track if this element is a DIRECT child of a custom element without slot attr (default slot)
      // Only consider elements whose immediate parent is the custom element
      if (!isClosing && !hasSlotAttr && stack.length > 0) {
        const immediateParent = stack[stack.length - 1];
        // Only flag if the immediate parent is a custom element
        if (immediateParent.tag.includes('-')) {
          const key = `${immediateParent.tag}:${immediateParent.index}`;
          if (!customElementsWithChildren.has(key)) {
            customElementsWithChildren.set(key, { 
              tag: immediateParent.tag, 
              index: immediateParent.index,
              hasDefaultSlotChild: true 
            });
          }
        }
      }
    }

    // Check for text content between tags that would go to default slot
    // Also add default slot usages for custom elements that have unslotted children
    for (const [key, info] of customElementsWithChildren) {
      // Find if we already have a default slot usage for this parent
      const hasExplicitDefaultSlot = out.some(
        o => o.parentTag === info.tag && o.slotName === '' && !o.isDefaultSlot
      );
      if (!hasExplicitDefaultSlot) {
        out.push({
          parentTag: info.tag,
          slotName: '',
          indexInText: info.index,
          isDefaultSlot: true
        });
      }
    }

    return out;
  }

  interface StaticAttr { tag: string; attr: string; booleanish: boolean; indexInText: number; }
  function isGlobalAttr(attr: string) {
    if (GLOBAL_ATTR_ALLOWLIST.has(attr)) return true;
    if (/^aria-[\w-]+$/.test(attr)) return true;
    if (/^data-[\w-]+$/.test(attr)) return true;
    if (attr === 'role') return true;
    return false;
  }

  function collectStaticAttrsFromTemplate(
    tagged: ts.TaggedTemplateExpression,
    sf: ts.SourceFile
  ): Array<StaticAttr> {
    const out: Array<StaticAttr> = [];
    const { text } = rebuildTemplateAndOffsets(tagged, sf);

    // 1) scrub les expressions ${...}
    const scrubbed = text.replace(/\${[\S\s]*?}/g, '§EXPR§');

    // util: masquer les contenus entre guillemets en gardant la même longueur
    const maskQuoted = (s: string) =>
      s.replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + '§'.repeat(m.length - 2) + m[m.length - 1]);

    const tagRe = /<\s*([\da-z-]+)\b([^>]*?)>/gi;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(scrubbed))) {
      const tag = m[1].toLowerCase();
      const attrsChunk = m[2];
      if (isNativeTag(tag)) continue;

      // 2) on matche sur la version masquée pour ne jamais “voir” l’intérieur des valeurs
      const masked = maskQuoted(attrsChunk);
      const attrRe = /([.:?@]?)([\w:-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=>]+))?/g;

      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(masked))) {
        const prefix = a[1];
        const rawName = a[2];
        const attrStartInTag = a.index;

        if (prefix === '.' || prefix === '@' || prefix === '?') continue;
        if (!rawName) continue;

        const name = rawName.toLowerCase();
        if (isGlobalAttr(name)) continue;
        if (name === 'part' || name === 'slot') continue;
        if (name.startsWith('xmlns')) continue;

        // slice original (non masqué) pour les checks
        const attrSliceStr = attrsChunk.slice(attrStartInTag, attrStartInTag + a[0].length);
        if (attrSliceStr.includes('§EXPR§')) continue; // FIX: vrai includes
        const hasEquals = attrSliceStr.includes('=');

        const indexInText = m.index + m[0].indexOf(attrsChunk) + attrStartInTag;
        out.push({ tag, attr: name, booleanish: !hasEquals, indexInText });
      }
    }
    return out;
  }

  function isEmptyArrayLiteral(node: ts.Expression): boolean {
    if (ts.isArrayLiteralExpression(node)) return node.elements.length === 0;
    if (ts.isParenthesizedExpression(node)) return isEmptyArrayLiteral(node.expression);
    return false;
  }

  function checkClass(cls: ts.ClassDeclaration) {
    const clsName = cls.name?.getText() ?? '<anonymous>';
    const { map: scopedMap } = readScopedElementsMap(cls);

    const visit = (n: ts.Node) => {
      if (ts.isTaggedTemplateExpression(n)) {
        const { tag } = n;
        const isHtmlTag =
          (ts.isIdentifier(tag) && tag.text === 'html') ||
          (ts.isPropertyAccessExpression(tag) && tag.name.text === 'html');

        if (isHtmlTag) {
          // 1) .prop bindings
          for (const b of collectBindingsFromTemplate(n)) {
            if (isNativeTag(b.tag)) continue;

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
            if (!ok && elemOfProp && isEmptyArrayLiteral(b.expr)) ok = true;

            // Accept T | undefined when the target property is declared optional (with '?')
            const propIsOptional = getPropOptionalOnElementClass(instanceType, b.prop);
            if (!ok && propIsOptional && typeContainsUndefined(exprTypeW)) {
              ok = forAllNonUndefinedConstituentsAssignableTo(exprTypeW, propTypeW, checker);
            }

            if (!ok && IGNORE_UNDEFINED) {
              const exprAdj = dropUndefinedForAssignability(exprTypeW);
              const propAdj = dropUndefinedForAssignability(propTypeW);
              if (
                checker.isTypeAssignableTo(exprAdj, propTypeW) ||
                checker.isTypeAssignableTo(exprTypeW, propAdj) ||
                checker.isTypeAssignableTo(exprAdj, propAdj)
              ) ok = true;
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
              const propName = findPropertyNameForAttribute(instanceType, sa.attr);
              if (!propName) {
                diags.push({
                  file: sf, category: ts.DiagnosticCategory.Warning, code: 90021,
                  messageText: `${clsName} → <${sa.tag}> attribut inconnu: ${sa.attr}`,
                  start: pos, length: sa.attr.length
                });
              }
            }
          }

          // 3) @event bindings - validate handler types
          for (const ev of collectEventBindingsFromTemplate(n)) {
            if (isNativeTag(ev.tag)) continue;

            const elemExpr = scopedMap.get(ev.tag);
            if (!elemExpr) continue; // Already reported in prop bindings

            // Resolve the component class to find the CustomEvent dispatch
            let componentClassDecl: ts.Node | null = null;
            let symbol = checker.getSymbolAtLocation(elemExpr);
            if (symbol) {
              while (symbol.flags & ts.SymbolFlags.Alias) {
                symbol = checker.getAliasedSymbol(symbol);
              }
              const declarations = symbol.getDeclarations();
              if (declarations?.length) {
                for (const decl of declarations) {
                  if (ts.isClassDeclaration(decl)) {
                    componentClassDecl = decl;
                    break;
                  }
                }
                if (!componentClassDecl) componentClassDecl = declarations[0];
              }
            }

            if (!componentClassDecl) continue;

            // Find the CustomEvent dispatch in the component (or JSDoc)
            const eventInfo = findCustomEventInClass(componentClassDecl, ev.eventName);
            if (!eventInfo) continue; // Event not found, might be bubbled from child

            // Get the handler type
            const handlerType = checker.getTypeAtLocation(ev.expr);
            
            // The handler should accept a function that takes the event type as parameter
            // Check if handler is a function/method
            const handlerSignatures = handlerType.getCallSignatures();
            if (handlerSignatures.length === 0) {
              // Not a callable, skip
              continue;
            }

            // Get the first parameter type of the handler
            const handlerSig = handlerSignatures[0];
            const handlerParams = handlerSig.getParameters();
            
            if (handlerParams.length === 0) {
              // Handler takes no parameters, that's fine (ignores the event)
              continue;
            }

            const firstParamSymbol = handlerParams[0];
            const firstParamType = checker.getTypeOfSymbolAtLocation(firstParamSymbol, ev.expr);
            
            let eventType: ts.Type | null = null;
            let eventTypeStr: string;
            
            if (eventInfo.node) {
              // Get the CustomEvent type from the dispatch
              eventType = checker.getTypeAtLocation(eventInfo.node);
              eventTypeStr = typeToString(eventType);
            } else if (eventInfo.fromJsDoc && eventInfo.detailType) {
              // Type from JSDoc - parse the detail type and compare with handler's expected detail
              eventTypeStr = `CustomEvent<${eventInfo.detailType}>`;
              const handlerTypeStr = typeToString(firstParamType);
              
              // Check if handler expects CustomEvent with compatible detail
              if (!handlerTypeStr.includes('CustomEvent') && !handlerTypeStr.includes('Event')) {
                diags.push({
                  file: sf,
                  category: ts.DiagnosticCategory.Error,
                  code: 90030,
                  messageText: `${clsName} → <${ev.tag}> @${ev.eventName} handler type mismatch. Handler expects: ${handlerTypeStr}, event dispatches: ${eventTypeStr}`,
                  start: ev.expr.getStart(),
                  length: ev.expr.getWidth()
                });
                continue;
              }
              
              // Extract the detail type from handler's CustomEvent<T> parameter
              // Handle nested generics by counting angle brackets
              const extractCustomEventDetail = (s: string): string | null => {
                const startIdx = s.indexOf('CustomEvent<');
                if (startIdx === -1) return null;
                const detailStart = startIdx + 'CustomEvent<'.length;
                let depth = 1;
                let i = detailStart;
                while (i < s.length && depth > 0) {
                  if (s[i] === '<') depth++;
                  else if (s[i] === '>') depth--;
                  i++;
                }
                if (depth === 0) {
                  return s.slice(detailStart, i - 1).trim();
                }
                return null;
              };
              
              const handlerDetailStr = extractCustomEventDetail(handlerTypeStr);
              if (handlerDetailStr) {
                const expectedDetailStr = eventInfo.detailType.trim();
                
                // Parse object types into normalized form for comparison
                // This handles property order differences like { a: X; b: Y } vs { b: Y, a: X }
                const parseObjectType = (s: string): Map<string, string> | null => {
                  const normalized = s.replace(/\s+/g, ' ').trim();
                  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return null;
                  
                  const inner = normalized.slice(1, -1).trim();
                  if (!inner) return new Map();
                  
                  const props = new Map<string, string>();
                  // Split by ; or , handling nested braces
                  const parts: string[] = [];
                  let depth = 0;
                  let current = '';
                  for (const char of inner) {
                    if (char === '{') depth++;
                    else if (char === '}') depth--;
                    else if ((char === ';' || char === ',') && depth === 0) {
                      if (current.trim()) parts.push(current.trim());
                      current = '';
                      continue;
                    }
                    current += char;
                  }
                  if (current.trim()) parts.push(current.trim());
                  
                  for (const part of parts) {
                    const colonIdx = part.indexOf(':');
                    if (colonIdx === -1) continue;
                    let key = part.slice(0, colonIdx).trim();
                    // Normalize optional key: "value?" -> "value"
                    key = key.replace(/\?$/, '');
                    const value = part.slice(colonIdx + 1).trim().replace(/;$/, '');
                    props.set(key, value);
                  }
                  return props;
                };
                
                const handlerProps = parseObjectType(handlerDetailStr);
                const expectedProps = parseObjectType(expectedDetailStr);
                
                // Normalize array syntax: Array<T> -> T[] and vice versa
                // Also strip generic parameters for comparison when JSDoc omits them
                const normalizeArraySyntax = (s: string): string => {
                  // Convert Array<T> to T[] (handle nested generics)
                  let result = s;
                  let changed = true;
                  while (changed) {
                    changed = false;
                    const arrayMatch = result.match(/Array<([^<>]+|\w+<[^>]+>)>/);
                    if (arrayMatch) {
                      result = result.replace(arrayMatch[0], `${arrayMatch[1]}[]`);
                      changed = true;
                    }
                  }
                  return result;
                };
                
                // Strip generic parameters from a type (e.g., RenderItem<string> -> RenderItem)
                const stripGenerics = (s: string): string => {
                  let result = '';
                  let depth = 0;
                  for (let i = 0; i < s.length; i++) {
                    const char = s[i];
                    if (char === '<') depth++;
                    else if (char === '>') depth--;
                    else if (depth === 0) result += char;
                  }
                  return result;
                };
                
                // Check if types match, considering that JSDoc may omit generic params
                const typesMatch = (handlerType: string, jsDocType: string): boolean => {
                  // Normalize: remove whitespace, convert ; to , in objects, remove trailing separators
                  const normalize = (s: string) => {
                    let result = s.replace(/\s+/g, '');
                    // Replace ; with , for object separators
                    result = result.replace(/;/g, ',');
                    // Remove trailing commas before }
                    result = result.replace(/,}/g, '}');
                    return normalizeArraySyntax(result);
                  };
                  
                  // Normalize optional properties: "prop?:T", "prop?:T|undefined", "prop:T|undefined" are all equivalent
                  const normalizeOptional = (s: string) => {
                    let result = s;
                    // Remove "undefined|" or "|undefined" from unions
                    result = result.replace(/undefined\|/g, '');
                    result = result.replace(/\|undefined/g, '');
                    // Remove ? from optional properties
                    result = result.replace(/\?:/g, ':');
                    return result;
                  };
                  
                  const h = normalizeOptional(normalize(handlerType));
                  const j = normalizeOptional(normalize(jsDocType));
                  if (h === j) return true;
                  // If JSDoc type has no generics but handler does, compare without generics
                  if (!jsDocType.includes('<') && handlerType.includes('<')) {
                    return stripGenerics(h) === j;
                  }
                  return false;
                };
                
                let isMatch = false;
                if (handlerProps && expectedProps) {
                  // Compare as object types (order-independent)
                  if (handlerProps.size === expectedProps.size) {
                    isMatch = true;
                    for (const [key, value] of handlerProps) {
                      const expectedValue = expectedProps.get(key);
                      if (!expectedValue) {
                        isMatch = false;
                        break;
                      }
                      // Use typesMatch for generic-tolerant comparison
                      if (!typesMatch(value, expectedValue)) {
                        isMatch = false;
                        break;
                      }
                    }
                  }
                } else {
                  // Fallback: use typesMatch for generic-tolerant comparison
                  isMatch = typesMatch(handlerDetailStr, expectedDetailStr);
                }
                
                if (!isMatch) {
                  diags.push({
                    file: sf,
                    category: ts.DiagnosticCategory.Error,
                    code: 90031,
                    messageText: `${clsName} → <${ev.tag}> @${ev.eventName} event detail type mismatch. Handler expects: ${handlerDetailStr}, event dispatches: ${expectedDetailStr}`,
                    start: ev.expr.getStart(),
                    length: ev.expr.getWidth()
                  });
                }
              }
              continue;
            } else {
              continue;
            }
            
            // Check if eventType is assignable to firstParamType
            // The event passed to the handler should be assignable to what the handler expects
            if (eventType && !checker.isTypeAssignableTo(eventType, firstParamType)) {
              const expectedType = typeToString(firstParamType);
              const gotType = eventTypeStr;
              diags.push({
                file: sf,
                category: ts.DiagnosticCategory.Error,
                code: 90030,
                messageText: `${clsName} → <${ev.tag}> @${ev.eventName} handler type mismatch. Handler expects: ${expectedType}, event dispatches: ${gotType}`,
                start: ev.expr.getStart(),
                length: ev.expr.getWidth()
              });
            }
          }

          // 4) slot validation - check that slots used are declared in the component
          const slotUsages = collectSlotUsagesFromTemplate(n, sf);
          const { offsetToPos } = rebuildTemplateAndOffsets(n, sf);
          
          for (const slotUsage of slotUsages) {
            if (isNativeTag(slotUsage.parentTag)) continue;

            const elemExpr = scopedMap.get(slotUsage.parentTag);
            if (!elemExpr) continue; // Component not in scopedElements, skip

            // Resolve the component class
            let componentClassDecl: ts.Node | null = null;
            let symbol = checker.getSymbolAtLocation(elemExpr);
            if (symbol) {
              while (symbol.flags & ts.SymbolFlags.Alias) {
                symbol = checker.getAliasedSymbol(symbol);
              }
              const declarations = symbol.getDeclarations();
              if (declarations?.length) {
                for (const decl of declarations) {
                  if (ts.isClassDeclaration(decl)) {
                    componentClassDecl = decl;
                    break;
                  }
                }
                if (!componentClassDecl) componentClassDecl = declarations[0];
              }
            }

            if (!componentClassDecl) continue;

            // Get declared slots from JSDoc
            const declaredSlots = getSlotsFromJsDoc(componentClassDecl);
            
            // If no slots are declared in JSDoc, skip validation (component might not document slots)
            if (declaredSlots.size === 0) continue;

            // Check if the used slot is declared
            if (!declaredSlots.has(slotUsage.slotName)) {
              const pos = offsetToPos(slotUsage.indexInText);
              const availableSlots = Array.from(declaredSlots)
                .map(s => s === '' ? '(default)' : `"${s}"`)
                .join(', ');
              
              if (slotUsage.isDefaultSlot) {
                // Content without slot attribute going to default slot
                diags.push({
                  file: sf,
                  category: ts.DiagnosticCategory.Warning,
                  code: 90041,
                  messageText: `${clsName} → <${slotUsage.parentTag}> has content without slot attribute, but no default slot is declared. Available slots: ${availableSlots}`,
                  start: pos,
                  length: slotUsage.parentTag.length + 1 // +1 for <
                });
              } else {
                diags.push({
                  file: sf,
                  category: ts.DiagnosticCategory.Warning,
                  code: 90040,
                  messageText: `${clsName} → <${slotUsage.parentTag}> slot "${slotUsage.slotName}" is not declared. Available slots: ${availableSlots}`,
                  start: pos,
                  length: `slot="${slotUsage.slotName}"`.length
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

  for (const cls of findLitClasses(sf)) checkClass(cls);
  return diags;
}

