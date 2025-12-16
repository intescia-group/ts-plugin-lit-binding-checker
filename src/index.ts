import ts from 'typescript';
import { runChecksOnSourceFile } from './checker';
import type { PluginOptions, TS } from './types';

interface TagAtPosition {
  tagName: string;
  start: number;
  end: number;
}

interface PropertyAtPosition {
  tagName: string;
  propName: string;
  isPropertyBinding: boolean; // .prop vs attribute
  start: number;
  end: number;
}

interface EventAtPosition {
  tagName: string;
  eventName: string;
  start: number;
  end: number;
}

/** Find an event listener (@event-name) at the given position within a template literal */
function findEventAtPosition(ts: TS, sf: ts.SourceFile, position: number): EventAtPosition | null {
  let result: EventAtPosition | null = null;

  const visit = (node: ts.Node) => {
    if (result) return;

    if (ts.isTaggedTemplateExpression(node)) {
      const { tag, template } = node;
      const isHtmlTag =
        (ts.isIdentifier(tag) && tag.text === 'html') ||
        (ts.isPropertyAccessExpression(tag) && tag.name.text === 'html');

      if (isHtmlTag && position >= template.getStart() && position <= template.getEnd()) {
        const templateText = template.getText();
        const templateStart = template.getStart();

        // Mask ${...} expressions to avoid matching > inside them
        const maskedText = templateText.replace(/\$\{[^}]*\}/g, (m) => '§'.repeat(m.length));

        const tagRegex = /<([a-z][\w-]*)\s*([^>]*?)>/gi;
        let tagMatch: RegExpExecArray | null;

        while ((tagMatch = tagRegex.exec(maskedText))) {
          const tagName = tagMatch[1].toLowerCase();
          const attrsStartInTemplate = tagMatch.index + tagMatch[0].indexOf(tagMatch[2]);
          const attrsEndInTemplate = attrsStartInTemplate + tagMatch[2].length;

          // Get the actual (unmasked) attributes chunk from original text
          const attrsChunk = templateText.slice(attrsStartInTemplate, attrsEndInTemplate);

          // Match @event-name= patterns
          const eventRegex = /@([a-zA-Z][\w-]*)\s*=/g;
          let eventMatch: RegExpExecArray | null;

          while ((eventMatch = eventRegex.exec(attrsChunk))) {
            const eventName = eventMatch[1];
            const eventStartInAttrs = eventMatch.index + 1; // +1 for @
            const eventStartInFile = templateStart + attrsStartInTemplate + eventStartInAttrs;
            const eventEndInFile = eventStartInFile + eventName.length;

            if (position >= eventStartInFile && position <= eventEndInFile) {
              result = {
                tagName,
                eventName,
                start: eventStartInFile,
                end: eventEndInFile,
              };
              return;
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return result;
}

/** Find a property or attribute at the given position within a template literal */
function findPropertyAtPosition(ts: TS, sf: ts.SourceFile, position: number): PropertyAtPosition | null {
  let result: PropertyAtPosition | null = null;

  const visit = (node: ts.Node) => {
    if (result) return;

    if (ts.isTaggedTemplateExpression(node)) {
      const { tag, template } = node;
      const isHtmlTag =
        (ts.isIdentifier(tag) && tag.text === 'html') ||
        (ts.isPropertyAccessExpression(tag) && tag.name.text === 'html');

      if (isHtmlTag && position >= template.getStart() && position <= template.getEnd()) {
        const templateText = template.getText();
        const templateStart = template.getStart();

        // Mask ${...} expressions to avoid matching > inside them (e.g., Array<T>)
        const maskedText = templateText.replace(/\$\{[^}]*\}/g, (m) => '§'.repeat(m.length));
        
        // Find all tags and their attributes/properties
        const tagRegex = /<([a-z][\w-]*)\s*([^>]*?)>/gi;
        let tagMatch: RegExpExecArray | null;

        while ((tagMatch = tagRegex.exec(maskedText))) {
          const tagName = tagMatch[1].toLowerCase();
          const attrsStartInTemplate = tagMatch.index + tagMatch[0].indexOf(tagMatch[2]);
          const attrsEndInTemplate = attrsStartInTemplate + tagMatch[2].length;
          
          // Get the actual (unmasked) attributes chunk from original text
          const attrsChunk = templateText.slice(attrsStartInTemplate, attrsEndInTemplate);

          // Match .prop= or ?attr= or attr= patterns (but NOT @event=)
          const propAttrRegex = /(\.|\?)?([a-zA-Z][\w-]*)\s*=/g;
          let propMatch: RegExpExecArray | null;

          while ((propMatch = propAttrRegex.exec(attrsChunk))) {
            const prefix = propMatch[1] || '';
            const name = propMatch[2];
            const propStartInAttrs = propMatch.index + prefix.length;
            const propStartInFile = templateStart + attrsStartInTemplate + propStartInAttrs;
            const propEndInFile = propStartInFile + name.length;

            if (position >= propStartInFile && position <= propEndInFile) {
              result = {
                tagName,
                propName: name,
                isPropertyBinding: prefix === '.',
                start: propStartInFile,
                end: propEndInFile,
              };
              return;
            }
          }

          // Also match boolean attributes without = (e.g., showListing)
          const boolAttrRegex = /\s([a-zA-Z][\w-]*)(?=\s|>|\/|$)(?!\s*=)/g;
          let boolMatch: RegExpExecArray | null;
          
          while ((boolMatch = boolAttrRegex.exec(attrsChunk))) {
            const name = boolMatch[1];
            const attrStartInAttrs = boolMatch.index + 1; // +1 for leading space
            const attrStartInFile = templateStart + attrsStartInTemplate + attrStartInAttrs;
            const attrEndInFile = attrStartInFile + name.length;

            if (position >= attrStartInFile && position <= attrEndInFile) {
              result = {
                tagName,
                propName: name,
                isPropertyBinding: false,
                start: attrStartInFile,
                end: attrEndInFile,
              };
              return;
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return result;
}

/** Find a custom element tag name at the given position within a template literal */
function findTagAtPosition(ts: TS, sf: ts.SourceFile, position: number): TagAtPosition | null {
  let result: TagAtPosition | null = null;

  const visit = (node: ts.Node) => {
    if (result) return;

    if (ts.isTaggedTemplateExpression(node)) {
      const { tag, template } = node;
      const isHtmlTag =
        (ts.isIdentifier(tag) && tag.text === 'html') ||
        (ts.isPropertyAccessExpression(tag) && tag.name.text === 'html');

      if (isHtmlTag && position >= template.getStart() && position <= template.getEnd()) {
        // Get the text content and find tags
        const templateText = template.getText();
        const templateStart = template.getStart();

        // Match opening and closing tags: <tag-name or </tag-name
        const tagRegex = /<\/?([a-z][\w-]*)/gi;
        let match: RegExpExecArray | null;

        while ((match = tagRegex.exec(templateText))) {
          const tagName = match[1];
          // Only consider custom elements (with dash)
          if (!tagName.includes('-')) continue;

          const tagStart = templateStart + match.index + match[0].indexOf(tagName);
          const tagEnd = tagStart + tagName.length;

          if (position >= tagStart && position <= tagEnd) {
            result = { tagName: tagName.toLowerCase(), start: tagStart, end: tagEnd };
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return result;
}

/** Find the Lit class containing the given position */
function findContainingLitClass(
  ts: TS,
  sf: ts.SourceFile,
  position: number,
  checker: ts.TypeChecker
): ts.ClassDeclaration | null {
  let result: ts.ClassDeclaration | null = null;

  const isLitElement = (node: ts.ClassDeclaration) => {
    const ext = node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
    const expr = ext?.types?.[0]?.expression;
    if (!expr) return false;
    const t = checker.getTypeAtLocation(expr);
    const name = t.symbol?.getName() ?? '';
    if (name === 'LitElement') return true;
    return /\bLitElement\b/.test(checker.typeToString(t));
  };

  const visit = (node: ts.Node) => {
    if (result) return;
    if (ts.isClassDeclaration(node) && node.name && isLitElement(node)) {
      if (position >= node.getStart() && position <= node.getEnd()) {
        result = node;
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return result;
}

type ScopedMap = Map<string, ts.Expression>;

/** Read scopedElements from a Lit class */
function readScopedElementsMap(ts: TS, cls: ts.ClassDeclaration): ScopedMap {
  const map: ScopedMap = new Map();

  // 1) Static scopedElements property
  const staticProp = cls.members.find(
    m => ts.isPropertyDeclaration(m) &&
    m.modifiers?.some(md => md.kind === ts.SyntaxKind.StaticKeyword) &&
    ts.isIdentifier(m.name) && m.name.text === 'scopedElements'
  ) as ts.PropertyDeclaration | undefined;

  if (staticProp?.initializer && ts.isObjectLiteralExpression(staticProp.initializer)) {
    for (const p of staticProp.initializer.properties) {
      if (ts.isPropertyAssignment(p)) {
        const key = ts.isIdentifier(p.name) ? p.name.text
          : ts.isStringLiteral(p.name) ? p.name.text : undefined;
        if (key) map.set(key, p.initializer);
      }
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
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p)) {
          const key = ts.isIdentifier(p.name) ? p.name.text
            : ts.isStringLiteral(p.name) ? p.name.text : undefined;
          if (key) map.set(key, p.initializer);
        }
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

/** Get instance type from a class expression */
function getInstanceTypeFromExpr(checker: ts.TypeChecker, expr: ts.Expression): ts.Type | null {
  const symbol = checker.getSymbolAtLocation(expr);
  if (symbol) {
    try {
      const declaredType = checker.getDeclaredTypeOfSymbol(symbol);
      if (declaredType) return declaredType;
    } catch {}
  }
  
  const t = checker.getTypeAtLocation(expr);
  const proto = t.getProperty('prototype');
  if (proto) {
    const protoType = checker.getTypeOfSymbolAtLocation(proto, expr);
    return checker.getApparentType(protoType);
  }
  return null;
}

/** Find property symbol on type (case-insensitive for attributes) */
function findPropertySymbol(type: ts.Type, propName: string): ts.Symbol | null {
  // First try exact match
  const exactMatch = type.getProperty(propName);
  if (exactMatch) return exactMatch;

  // Then try case-insensitive match
  const lowerName = propName.toLowerCase();
  for (const prop of type.getProperties()) {
    if (prop.getName().toLowerCase() === lowerName) {
      return prop;
    }
  }
  return null;
}

/** Resolve symbol to its original declaration, following aliases */
function resolveSymbolToDeclaration(ts: TS, checker: ts.TypeChecker, expr: ts.Expression): ts.Declaration | null {
  let symbol = checker.getSymbolAtLocation(expr);
  if (!symbol) return null;

  // Follow alias if needed (e.g., element.default -> actual class)
  while (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const declarations = symbol.getDeclarations();
  if (!declarations?.length) return null;

  // Prefer class declarations
  for (const decl of declarations) {
    if (ts.isClassDeclaration(decl)) return decl;
  }

  return declarations[0];
}

interface CustomEventResult {
  node: ts.NewExpression | null;
  containingMethod: ts.MethodDeclaration | null;
  detailType: string | null; // From JSDoc or inferred
  fromJsDoc: boolean;
  jsDocNode: ts.Node | null; // The node containing the @fires JSDoc
}

interface JsDocEventInfo {
  detailType: string | null;
  node: ts.Node;
}

/** Parse @fires JSDoc tags from a class to find event declarations */
function findEventFromJsDoc(ts: TS, classDecl: ts.Declaration, eventName: string): JsDocEventInfo | null {
  // Check JSDoc on a node
  const checkJsDoc = (node: ts.Node): JsDocEventInfo | null => {
    const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
    if (jsDocs) {
      for (const jsDoc of jsDocs) {
        if (jsDoc.tags) {
          for (const tag of jsDoc.tags) {
            // Match @fires or @event tags
            if (tag.tagName.text === 'fires' || tag.tagName.text === 'event') {
              let comment: string | undefined;
              if (typeof tag.comment === 'string') {
                comment = tag.comment;
              } else if (Array.isArray(tag.comment)) {
                comment = tag.comment.map((c: any) => c.text || '').join('');
              } else if (tag.comment) {
                comment = String(tag.comment);
              }
              
              // Parse: "event-name" or "event-name - description" or "event-name - Emitted with `{ type: T }` ..."
              const parts = comment?.split(/\s+-\s+|\s+/) || [];
              const tagEventName = parts[0]?.trim();
              
              if (tagEventName === eventName) {
                // Try to extract type from comment like "Emitted with `{ value: string }`"
                let detailType: string | null = null;
                const typeMatch = comment?.match(/`([^`]+)`/);
                if (typeMatch) {
                  detailType = typeMatch[1];
                }
                return { detailType, node };
              }
            }
          }
        }
      }
    }
    return null;
  };

  // Check class-level JSDoc
  const classResult = checkJsDoc(classDecl);
  if (classResult) return classResult;

  // Check JSDoc on all methods/properties
  if (ts.isClassDeclaration(classDecl)) {
    for (const member of classDecl.members) {
      const memberResult = checkJsDoc(member);
      if (memberResult) return memberResult;
    }
  }

  return null;
}

/** Find CustomEvent dispatch for a given event name in a class */
function findCustomEventInClass(ts: TS, classDecl: ts.Declaration, eventName: string, checker: ts.TypeChecker): CustomEventResult | null {
  let result: CustomEventResult | null = null;

  const visit = (node: ts.Node, currentMethod: ts.MethodDeclaration | null) => {
    if (result) return;

    // Track method context
    if (ts.isMethodDeclaration(node)) {
      ts.forEachChild(node, child => visit(child, node));
      return;
    }

    // Match: new CustomEvent('event-name', ...) or dispatchEvent(new CustomEvent('event-name', ...))
    if (ts.isNewExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === 'CustomEvent') {
        const args = node.arguments;
        if (args && args.length > 0) {
          const firstArg = args[0];
          if (ts.isStringLiteral(firstArg) && firstArg.text === eventName) {
            result = { node, containingMethod: currentMethod, detailType: null, fromJsDoc: false, jsDocNode: null };
            return;
          }
        }
      }
    }

    ts.forEachChild(node, child => visit(child, currentMethod));
  };

  ts.forEachChild(classDecl, child => visit(child, null));
  
  // If not found via code, try JSDoc
  if (!result) {
    const jsDocResult = findEventFromJsDoc(ts, classDecl, eventName);
    if (jsDocResult) {
      result = { node: null, containingMethod: null, detailType: jsDocResult.detailType, fromJsDoc: true, jsDocNode: jsDocResult.node };
    }
  }
  
  return result;
}

function init(modules: { typescript: TS }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const config: PluginOptions = {
      ignoreUndefined: (info.config as any)?.ignoreUndefined ?? false,
      ignoreAttribute: (info.config as any)?.ignoreAttribute ?? false,
      debugCache: (info.config as any)?.debugCache ?? false,
      ignoreFiles: (info.config as any)?.ignoreFiles ?? [],
    };

    const ignorePatterns = (config.ignoreFiles ?? []).map(p => new RegExp(p));
    const shouldIgnoreFile = (fileName: string): boolean => {
      const normalized = fileName.replace(/\\/g, '/');
      return ignorePatterns.some(re => re.test(normalized));
    };

    const proxy: ts.LanguageService = Object.create(null);
    const oldLS = info.languageService;
    for (const k of Object.keys(oldLS) as Array<keyof ts.LanguageService>) {
      const x = oldLS[k];
      (proxy as any)[k] = typeof x === 'function' ? x.bind(oldLS) : x;
    }

    proxy.getSemanticDiagnostics = (fileName: string) => {
      const prior = oldLS.getSemanticDiagnostics(fileName);
      if (shouldIgnoreFile(fileName)) return prior;
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
        return prior;
      }
    };

    proxy.getDefinitionAndBoundSpan = (fileName: string, position: number): ts.DefinitionInfoAndBoundSpan | undefined => {
      const prior = oldLS.getDefinitionAndBoundSpan(fileName, position);
      const program = oldLS.getProgram?.();
      if (!program) return prior;

      const normalizedFileName = fileName.replace(/\\/g, '/');
      const sf = program.getSourceFile(fileName) ?? program.getSourceFile(normalizedFileName);
      if (!sf) return prior;

      const checker = program.getTypeChecker();
      const containingClass = findContainingLitClass(ts, sf, position, checker);
      if (!containingClass) return prior;

      const scopedMap = readScopedElementsMap(ts, containingClass);

      // First, check if cursor is on an event listener (@event-name)
      const eventInfo = findEventAtPosition(ts, sf, position);
      if (eventInfo) {
        const componentExpr = scopedMap.get(eventInfo.tagName);
        if (componentExpr) {
          // Resolve to actual class declaration
          const classDecl = resolveSymbolToDeclaration(ts, checker, componentExpr);
          if (classDecl) {
            // Find CustomEvent in the component class
            const eventResult = findCustomEventInClass(ts, classDecl, eventInfo.eventName, checker);
            if (eventResult && eventResult.node) {
              const eventSf = eventResult.node.getSourceFile();
              const definition: ts.DefinitionInfo = {
                fileName: eventSf.fileName,
                textSpan: ts.createTextSpan(eventResult.node.getStart(), eventResult.node.getWidth()),
                kind: ts.ScriptElementKind.unknown,
                name: eventInfo.eventName,
                containerName: '',
                containerKind: ts.ScriptElementKind.classElement,
              };

              const textSpan = ts.createTextSpan(eventInfo.start, eventInfo.end - eventInfo.start);
              const priorDefs = prior?.definitions ?? [];
              return {
                definitions: [...priorDefs, definition],
                textSpan,
              };
            }
            // Event found via JSDoc - go to the member containing the @fires tag
            if (eventResult && eventResult.fromJsDoc && eventResult.jsDocNode) {
              const jsDocNodeSf = eventResult.jsDocNode.getSourceFile();
              const definition: ts.DefinitionInfo = {
                fileName: jsDocNodeSf.fileName,
                textSpan: ts.createTextSpan(eventResult.jsDocNode.getStart(), eventResult.jsDocNode.getWidth()),
                kind: ts.ScriptElementKind.memberFunctionElement,
                name: eventInfo.eventName,
                containerName: '',
                containerKind: ts.ScriptElementKind.classElement,
              };

              const textSpan = ts.createTextSpan(eventInfo.start, eventInfo.end - eventInfo.start);
              const priorDefs = prior?.definitions ?? [];
              return {
                definitions: [...priorDefs, definition],
                textSpan,
              };
            }
          }
        }
        // Event not found in component (might be bubbled), return prior
        return prior;
      }

      // Then, check if cursor is on a property/attribute
      const propInfo = findPropertyAtPosition(ts, sf, position);
      if (propInfo) {
        const componentExpr = scopedMap.get(propInfo.tagName);
        if (!componentExpr) return prior;

        const symbol = checker.getSymbolAtLocation(componentExpr);
        if (!symbol) return prior;

        // Get the instance type of the component
        const componentType = getInstanceTypeFromExpr(checker, componentExpr);
        if (!componentType) return prior;

        // Find the property on the component (case-insensitive for attributes)
        const propSymbol = findPropertySymbol(componentType, propInfo.propName);
        if (!propSymbol) return prior;

        const propDeclarations = propSymbol.getDeclarations();
        if (!propDeclarations?.length) return prior;

        const propDecl = propDeclarations[0];
        const propDeclSf = propDecl.getSourceFile();

        const definition: ts.DefinitionInfo = {
          fileName: propDeclSf.fileName,
          textSpan: ts.createTextSpan(propDecl.getStart(), propDecl.getWidth()),
          kind: ts.ScriptElementKind.memberVariableElement,
          name: propSymbol.getName(),
          containerName: symbol.getName(),
          containerKind: ts.ScriptElementKind.classElement,
        };

        const textSpan = ts.createTextSpan(propInfo.start, propInfo.end - propInfo.start);
        const priorDefs = prior?.definitions ?? [];
        return {
          definitions: [...priorDefs, definition],
          textSpan,
        };
      }

      // Then, check if cursor is on a tag name
      const tagInfo = findTagAtPosition(ts, sf, position);
      if (!tagInfo) return prior;

      const componentExpr = scopedMap.get(tagInfo.tagName);
      if (!componentExpr) return prior;

      // Resolve to actual class declaration (follows aliases/imports)
      const decl = resolveSymbolToDeclaration(ts, checker, componentExpr);
      if (!decl) return prior;

      const declSf = decl.getSourceFile();

      const definition: ts.DefinitionInfo = {
        fileName: declSf.fileName,
        textSpan: ts.createTextSpan(decl.getStart(), decl.getWidth()),
        kind: ts.ScriptElementKind.classElement,
        name: tagInfo.tagName,
        containerName: '',
        containerKind: ts.ScriptElementKind.unknown,
      };

      const textSpan = ts.createTextSpan(tagInfo.start, tagInfo.end - tagInfo.start);
      const priorDefs = prior?.definitions ?? [];
      return {
        definitions: [...priorDefs, definition],
        textSpan,
      };
    };

    proxy.getQuickInfoAtPosition = (fileName: string, position: number): ts.QuickInfo | undefined => {
      const prior = oldLS.getQuickInfoAtPosition(fileName, position);
      const program = oldLS.getProgram?.();
      if (!program) return prior;

      const normalizedFileName = fileName.replace(/\\/g, '/');
      const sf = program.getSourceFile(fileName) ?? program.getSourceFile(normalizedFileName);
      if (!sf) return prior;

      const checker = program.getTypeChecker();
      const containingClass = findContainingLitClass(ts, sf, position, checker);
      if (!containingClass) return prior;

      const scopedMap = readScopedElementsMap(ts, containingClass);

      // First, check if cursor is on an event listener (@event-name)
      const eventInfo = findEventAtPosition(ts, sf, position);
      if (eventInfo) {
        const componentExpr = scopedMap.get(eventInfo.tagName);
        if (componentExpr) {
          const classDecl = resolveSymbolToDeclaration(ts, checker, componentExpr);
          if (classDecl) {
            const eventResult = findCustomEventInClass(ts, classDecl, eventInfo.eventName, checker);
            
            // Get the detail type using the TypeChecker for proper resolution
            let detailType = 'unknown';
            if (eventResult) {
              if (eventResult.node && ts.isNewExpression(eventResult.node)) {
                const typeArgs = eventResult.node.typeArguments;
                if (typeArgs && typeArgs.length > 0) {
                  // Explicit type argument: new CustomEvent<DetailType>(...)
                  const typeNode = typeArgs[0];
                  const resolvedType = checker.getTypeFromTypeNode(typeNode);
                  detailType = checker.typeToString(resolvedType);
                } else {
                  // No explicit type, try to infer from the options.detail
                  // new CustomEvent('name', { detail: { ... } })
                  const args = eventResult.node.arguments;
                  if (args && args.length > 1) {
                    const optionsArg = args[1];
                    if (ts.isObjectLiteralExpression(optionsArg)) {
                      const detailProp = optionsArg.properties.find(
                        p => ts.isPropertyAssignment(p) && 
                             ts.isIdentifier(p.name) && 
                             p.name.text === 'detail'
                      ) as ts.PropertyAssignment | undefined;
                      
                      if (detailProp) {
                        const detailExprType = checker.getTypeAtLocation(detailProp.initializer);
                        detailType = checker.typeToString(detailExprType);
                      }
                    }
                  }
                }
              } else if (eventResult.fromJsDoc && eventResult.detailType) {
                // Type from JSDoc @fires tag
                detailType = eventResult.detailType;
              }
            }

            // Get JSDoc from the containing method if available
            let jsdoc = '';
            if (eventResult?.containingMethod) {
              const methodSymbol = checker.getSymbolAtLocation(eventResult.containingMethod.name!);
              if (methodSymbol) {
                jsdoc = ts.displayPartsToString(methodSymbol.getDocumentationComment(checker));
              }
            }

            const displayParts: ts.SymbolDisplayPart[] = [
              { kind: 'punctuation', text: '(' },
              { kind: 'text', text: 'event' },
              { kind: 'punctuation', text: ')' },
              { kind: 'space', text: ' ' },
              { kind: 'propertyName', text: eventInfo.eventName },
              { kind: 'punctuation', text: ':' },
              { kind: 'space', text: ' ' },
              { kind: 'keyword', text: `CustomEvent<${detailType}>` },
            ];

            const documentation: ts.SymbolDisplayPart[] = jsdoc
              ? [{ kind: 'text', text: jsdoc }]
              : [];

            return {
              kind: ts.ScriptElementKind.unknown,
              kindModifiers: '',
              textSpan: ts.createTextSpan(eventInfo.start, eventInfo.end - eventInfo.start),
              displayParts,
              documentation,
            };
          }
        }
        
        // Event detected but component not in scopedElements - still show basic info
        const displayParts: ts.SymbolDisplayPart[] = [
          { kind: 'punctuation', text: '(' },
          { kind: 'text', text: 'event' },
          { kind: 'punctuation', text: ')' },
          { kind: 'space', text: ' ' },
          { kind: 'propertyName', text: eventInfo.eventName },
        ];

        return {
          kind: ts.ScriptElementKind.unknown,
          kindModifiers: '',
          textSpan: ts.createTextSpan(eventInfo.start, eventInfo.end - eventInfo.start),
          displayParts,
          documentation: [],
        };
      }

      // Then, check if cursor is on a property/attribute
      const propInfo = findPropertyAtPosition(ts, sf, position);
      if (propInfo) {
        const componentExpr = scopedMap.get(propInfo.tagName);
        if (!componentExpr) return prior;

        const componentType = getInstanceTypeFromExpr(checker, componentExpr);
        if (!componentType) return prior;

        const propSymbol = findPropertySymbol(componentType, propInfo.propName);
        if (!propSymbol) return prior;

        const propType = checker.getTypeOfSymbolAtLocation(propSymbol, componentExpr);
        const typeString = checker.typeToString(propType);
        const propDecl = propSymbol.getDeclarations()?.[0];
        
        // Get JSDoc comment if available
        const jsdoc = ts.displayPartsToString(propSymbol.getDocumentationComment(checker));
        
        const displayParts: ts.SymbolDisplayPart[] = [
          { kind: 'punctuation', text: '(' },
          { kind: 'text', text: propInfo.isPropertyBinding ? 'property' : 'attribute' },
          { kind: 'punctuation', text: ')' },
          { kind: 'space', text: ' ' },
          { kind: 'propertyName', text: propSymbol.getName() },
          { kind: 'punctuation', text: ':' },
          { kind: 'space', text: ' ' },
          { kind: 'keyword', text: typeString },
        ];

        const documentation: ts.SymbolDisplayPart[] = jsdoc
          ? [{ kind: 'text', text: jsdoc }]
          : [];

        return {
          kind: ts.ScriptElementKind.memberVariableElement,
          kindModifiers: '',
          textSpan: ts.createTextSpan(propInfo.start, propInfo.end - propInfo.start),
          displayParts,
          documentation,
        };
      }

      // Check if cursor is on a tag name
      const tagInfo = findTagAtPosition(ts, sf, position);
      if (tagInfo) {
        const componentExpr = scopedMap.get(tagInfo.tagName);
        if (componentExpr) {
          const classDecl = resolveSymbolToDeclaration(ts, checker, componentExpr);
          if (classDecl && ts.isClassDeclaration(classDecl)) {
            const className = classDecl.name?.getText() ?? tagInfo.tagName;
            const jsdoc = classDecl.name 
              ? ts.displayPartsToString(checker.getSymbolAtLocation(classDecl.name)?.getDocumentationComment(checker) ?? [])
              : '';

            const displayParts: ts.SymbolDisplayPart[] = [
              { kind: 'punctuation', text: '(' },
              { kind: 'text', text: 'custom element' },
              { kind: 'punctuation', text: ')' },
              { kind: 'space', text: ' ' },
              { kind: 'className', text: className },
            ];

            const documentation: ts.SymbolDisplayPart[] = jsdoc
              ? [{ kind: 'text', text: jsdoc }]
              : [];

            return {
              kind: ts.ScriptElementKind.classElement,
              kindModifiers: '',
              textSpan: ts.createTextSpan(tagInfo.start, tagInfo.end - tagInfo.start),
              displayParts,
              documentation,
            };
          }
        }
      }

      return prior;
    };

    return proxy;
  }

  return { create };
}

export = init;
