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

        // Track current tag context
        let currentTag: string | null = null;
        
        // Find all tags and their attributes/properties
        const tagRegex = /<([a-z][\w-]*)\s*([^>]*?)>/gi;
        let tagMatch: RegExpExecArray | null;

        while ((tagMatch = tagRegex.exec(templateText))) {
          const tagName = tagMatch[1].toLowerCase();
          const attrsChunk = tagMatch[2];
          const tagStartInTemplate = tagMatch.index;
          const attrsStartInTemplate = tagStartInTemplate + tagMatch[0].indexOf(attrsChunk);

          // Match .prop= or attr= patterns
          const propAttrRegex = /(\.|\?|@)?([a-zA-Z][\w-]*)\s*=/g;
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

      // First, check if cursor is on a property/attribute
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

      const symbol = checker.getSymbolAtLocation(componentExpr);
      if (!symbol) return prior;

      const declarations = symbol.getDeclarations();
      if (!declarations?.length) return prior;

      const decl = declarations[0];
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

    return proxy;
  }

  return { create };
}

export = init;
