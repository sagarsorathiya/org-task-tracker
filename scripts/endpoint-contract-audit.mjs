import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const API_DIR = path.join(SRC_DIR, 'app', 'api');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'endpoint-contract-audit.json');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function lineFromOffset(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function normalizeEndpoint(url) {
  const noQuery = url.split('?')[0];
  return noQuery
    .replace(/\$\{[^}]+\}/g, '[dynamic]')
    .replace(/(?<!\/)\[dynamic\](?=$|[?&])/g, '')
    .replace(/\/+/g, '/');
}

function extractJsonStringifyKeys(snippet) {
  const m = snippet.match(/JSON\.stringify\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return [];
  const body = m[1];
  const keys = [];
  const keyRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let km;
  while ((km = keyRegex.exec(body)) !== null) {
    keys.push(km[1]);
  }
  return Array.from(new Set(keys));
}

function parseSchemaKeys(fileText) {
  const schemas = new Map();
  const schemaRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;/g;
  let m;
  while ((m = schemaRegex.exec(fileText)) !== null) {
    const name = m[1];
    const obj = m[2];
    const keys = [];
    const keyRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
    let km;
    while ((km = keyRegex.exec(obj)) !== null) {
      keys.push(km[1]);
    }
    schemas.set(name, Array.from(new Set(keys)));
  }
  return schemas;
}

function parseRouteContracts(routePath) {
  const text = fs.readFileSync(routePath, 'utf8');
  const schemas = parseSchemaKeys(text);
  const methodRegex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  const methods = [];
  const methodMatches = [];
  let mm;
  while ((mm = methodRegex.exec(text)) !== null) {
    methodMatches.push({ method: mm[1], start: mm.index });
  }

  for (let i = 0; i < methodMatches.length; i++) {
    const cur = methodMatches[i];
    const end = i + 1 < methodMatches.length ? methodMatches[i + 1].start : text.length;
    const block = text.slice(cur.start, end);

    const schemaUse = block.match(/([A-Za-z0-9_]+)\.safeParse\s*\(/);
    const requestShape = schemaUse && schemas.has(schemaUse[1]) ? schemas.get(schemaUse[1]) : [];

    const responseTypes = [];
    const respRegex = /NextResponse\.json\s*<\s*ApiResponse<([^>]+)>\s*>/g;
    let rm;
    while ((rm = respRegex.exec(block)) !== null) {
      responseTypes.push(rm[1].trim());
    }

    methods.push({
      method: cur.method,
      expectedRequestBodyKeys: requestShape || [],
      responseApiResponseDataTypes: Array.from(new Set(responseTypes)),
    });
  }

  const endpoint = '/' + rel(routePath)
    .replace(/^src\/app\/api\//, 'api/')
    .replace(/\/route\.ts$/, '')
    .replace(/\[\.\.\.[^\]]+\]/g, '*')
    .replace(/\[([^\]]+)\]/g, ':$1');

  return { endpoint, routeFile: rel(routePath), methods };
}

function endpointTemplateToRegex(template) {
  const escaped = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '[^/]+')
    .replace(/\*/g, '.+');
  return new RegExp(`^${escaped}$`);
}

function getPropertyFromObjectLiteral(obj, key) {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    if (ts.isIdentifier(name) && name.text === key) return prop.initializer;
    if (ts.isStringLiteral(name) && name.text === key) return prop.initializer;
  }
  return null;
}

function templateExpressionToUrl(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += '[dynamic]';
      out += span.literal.text;
    }
    return out;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function parseRequestBodyKeysFromNode(node) {
  if (!node) return [];
  if (!ts.isCallExpression(node)) return [];

  const exprText = node.expression.getText();
  if (!/JSON\.stringify$/.test(exprText)) return [];
  const arg0 = node.arguments[0];
  if (!arg0 || !ts.isObjectLiteralExpression(arg0)) return [];

  const keys = [];
  for (const prop of arg0.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (ts.isIdentifier(prop.name)) keys.push(prop.name.text);
    if (ts.isStringLiteral(prop.name)) keys.push(prop.name.text);
  }
  return Array.from(new Set(keys));
}

function parseFrontendCalls(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const calls = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const isRelevantCallee = callee === 'fetch' || callee === 'useSWR' || callee === 'useSWRImmutable';

      if (isRelevantCallee && node.arguments.length > 0) {
        const rawUrl = templateExpressionToUrl(node.arguments[0]);
        if (rawUrl && rawUrl.startsWith('/api/')) {
          let method = 'GET';
          let requestBodyKeysFromCallsite = [];

          const optionsArg = node.arguments[1];
          if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
            const methodNode = getPropertyFromObjectLiteral(optionsArg, 'method');
            if (methodNode && ts.isStringLiteralLike(methodNode)) {
              method = methodNode.text.toUpperCase();
            }

            const bodyNode = getPropertyFromObjectLiteral(optionsArg, 'body');
            requestBodyKeysFromCallsite = parseRequestBodyKeysFromNode(bodyNode);
          }

          const pos = sourceFile.getLineAndCharacterOfPosition(node.arguments[0].getStart(sourceFile));
          calls.push({
            sourceFile: rel(filePath),
            line: pos.line + 1,
            rawUrl,
            normalizedEndpoint: normalizeEndpoint(rawUrl),
            method,
            requestBodyKeysFromCallsite,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const dedup = new Map();
  for (const c of calls) {
    const key = `${c.sourceFile}:${c.line}:${c.rawUrl}:${c.method}`;
    dedup.set(key, c);
  }

  return Array.from(dedup.values());
}

function main() {
  const allFiles = walk(SRC_DIR);
  const routeFiles = allFiles.filter((f) => /src[\\/]app[\\/]api[\\/].*[\\/]route\.ts$/.test(f));
  const frontendFiles = allFiles.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/src[\\/]app[\\/]api[\\/]/.test(f));

  const routeContracts = routeFiles.map(parseRouteContracts);
  const frontendCalls = frontendFiles.flatMap(parseFrontendCalls);

  const mappedCalls = frontendCalls.map((call) => {
    const normalized = call.normalizedEndpoint;
    const match = routeContracts.find((r) => endpointTemplateToRegex(r.endpoint).test(normalized));
    const methodContract = match?.methods.find((m) => m.method === call.method);

    let dynamicCandidates = [];
    if (!match && normalized.includes('[dynamic]')) {
      const prefix = normalized.split('[dynamic]')[0];
      dynamicCandidates = routeContracts.filter((r) => r.endpoint.startsWith(prefix));
    }

    return {
      ...call,
      matchedRouteFile: match?.routeFile || null,
      matchedEndpointTemplate: match?.endpoint || null,
      methodImplemented: !!methodContract,
      dynamicRouteCandidates: dynamicCandidates.map((c) => ({ endpoint: c.endpoint, routeFile: c.routeFile })),
      routeExpectedRequestBodyKeys: methodContract?.expectedRequestBodyKeys || [],
      routeResponseApiResponseDataTypes: methodContract?.responseApiResponseDataTypes || [],
      requestShapeKeyDelta: {
        onlyInCallsite: call.requestBodyKeysFromCallsite.filter((k) => !(methodContract?.expectedRequestBodyKeys || []).includes(k)),
        onlyInRouteSchema: (methodContract?.expectedRequestBodyKeys || []).filter((k) => !call.requestBodyKeysFromCallsite.includes(k)),
      },
      contractStatus: !match
        ? (dynamicCandidates.length > 0 ? 'dynamic_route_candidate' : 'missing_route')
        : (!methodContract ? 'method_mismatch' : 'matched'),
    };
  });

  const summary = {
    totalFrontendCalls: mappedCalls.length,
    totalRoutes: routeContracts.length,
    matched: mappedCalls.filter((c) => c.contractStatus === 'matched').length,
    dynamicRouteCandidate: mappedCalls.filter((c) => c.contractStatus === 'dynamic_route_candidate').length,
    missingRoute: mappedCalls.filter((c) => c.contractStatus === 'missing_route').length,
    methodMismatch: mappedCalls.filter((c) => c.contractStatus === 'method_mismatch').length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    workspace: path.basename(ROOT),
    summary,
    routeContracts,
    frontendCallAudit: mappedCalls,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({ reportPath: rel(REPORT_PATH), summary }, null, 2));
}

main();
