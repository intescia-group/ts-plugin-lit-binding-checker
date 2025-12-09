import ts from 'typescript';
import { runChecksOnSourceFile } from './checker';
import type { PluginOptions, TS } from './types';

interface TagAtPosition {
  tagName: string;
  start: number;
  end: number;
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
    return map;
  }

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
  return map;
}

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
        return prior;
      }
    };

    proxy.getDefinitionAtPosition = (fileName: string, position: number): readonly ts.DefinitionInfo[] | undefined => {
      const prior = oldLS.getDefinitionAtPosition(fileName, position);
      const program = oldLS.getProgram?.();
      if (!program) return prior;

      const normalizedFileName = fileName.replace(/\\/g, '/');
      const sf = program.getSourceFile(fileName) ?? program.getSourceFile(normalizedFileName);
      if (!sf) return prior;

      // Find the tag name at the cursor position within a template literal
      const tagInfo = findTagAtPosition(ts, sf, position);
      if (!tagInfo) return prior;

      // Find the class containing this template
      const containingClass = findContainingLitClass(ts, sf, position, program.getTypeChecker());
      if (!containingClass) return prior;

      // Get scopedElements map and find the component class
      const scopedMap = readScopedElementsMap(ts, containingClass);
      const componentExpr = scopedMap.get(tagInfo.tagName);
      if (!componentExpr) return prior;

      // Get the definition of the component class
      const checker = program.getTypeChecker();
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

      return prior ? [...prior, definition] : [definition];
    };

    return proxy;
  }

  return { create };
}

export = init;
