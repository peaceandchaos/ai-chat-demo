const ts = require('typescript');
const { git } = require('../verification/snapshot.cjs');

const statusNames = { A: 'added', M: 'modified', T: 'modified', D: 'deleted' };
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/u;

function diff(root, args) {
  return git(root, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    ...args,
  ]);
}

function parseNameStatus(output) {
  const fields = output.split('\0');
  const files = [];
  for (let index = 0; index + 1 < fields.length;) {
    const code = fields[index];
    if (code.startsWith('R')) {
      files.push({
        status: 'renamed',
        from: fields[index + 1],
        path: fields[index + 2],
      });
      index += 3;
    } else if (statusNames[code]) {
      files.push({ status: statusNames[code], path: fields[index + 1] });
      index += 2;
    } else {
      throw new Error(`Unsupported git diff status ${code}.`);
    }
  }
  return files;
}

function parseNumstat(output) {
  const lines = new Map();
  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(fields[index]);
    if (!match) continue;
    let path = match[3];
    // A rename leaves the path empty and lists the old and new paths next.
    if (!path) {
      path = fields[index + 2];
      index += 2;
    }
    const count = match[1] === '-' ? 0 : Number(match[1]) + Number(match[2]);
    lines.set(path, count);
  }
  return lines;
}

function parseAddedLines(output) {
  const added = new Map();
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('+++ ')) {
      // git ends the path with a tab when it contains a space.
      current = line.startsWith('+++ b/')
        ? line.slice(6).replace(/\t$/u, '')
        : null;
      if (current && !added.has(current)) added.set(current, []);
    } else if (current && line.startsWith('+')) {
      added.get(current).push(line.slice(1));
    }
  }
  return added;
}

function scriptKind(fileName) {
  if (/\.[jt]sx$/u.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function addBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) addBindingNames(element.name, names);
  }
}

function isModuleExports(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'module' &&
    node.name.text === 'exports'
  );
}

function addCommonJsNames(expression, names) {
  if (
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return;
  }
  const { left, right } = expression;
  if (isModuleExports(left)) {
    if (!ts.isObjectLiteralExpression(right)) {
      names.add('module.exports');
      return;
    }
    for (const property of right.properties) {
      if (property.name && !ts.isComputedPropertyName(property.name))
        names.add(property.name.text);
    }
  } else if (
    ts.isPropertyAccessExpression(left) &&
    (isModuleExports(left.expression) ||
      (ts.isIdentifier(left.expression) && left.expression.text === 'exports'))
  ) {
    names.add(left.name.text);
  }
}

function addDeclarationNames(statement, names) {
  const modifiers = ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? [])
    : [];
  const exported = modifiers.some(
    modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
  if (!exported) return;
  if (
    modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  )
    names.add('default');
  else if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations)
      addBindingNames(declaration.name, names);
  else if (statement.name) names.add(statement.name.text);
}

function exportNames(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(fileName),
  );
  const names = new Set();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (!clause) names.add('*');
      else if (ts.isNamespaceExport(clause)) names.add(clause.name.text);
      else for (const element of clause.elements) names.add(element.name.text);
    } else if (ts.isExportAssignment(statement)) {
      names.add('default');
    } else if (ts.isExpressionStatement(statement)) {
      addCommonJsNames(statement.expression, names);
    } else {
      addDeclarationNames(statement, names);
    }
  }
  return names;
}

function removedExports(root, base, head, files) {
  const removed = new Map();
  for (const file of files) {
    const before = file.status === 'renamed' ? file.from : file.path;
    if (file.status === 'added' || !sourceFile.test(before)) continue;
    const old = exportNames(before, git(root, ['show', `${base}:${before}`]));
    const current =
      file.status === 'deleted' || !sourceFile.test(file.path)
        ? new Set()
        : exportNames(file.path, git(root, ['show', `${head}:${file.path}`]));
    const names = [...old].filter(name => !current.has(name)).sort();
    if (names.length) removed.set(file.path, names);
  }
  return removed;
}

function readRange(root, baseRef, headRef) {
  const head = git(root, ['rev-parse', '--verify', `${headRef}^{commit}`]);
  const base = git(root, ['merge-base', baseRef, head]);
  const files = parseNameStatus(
    diff(root, ['--name-status', '-z', base, head]),
  );
  return {
    kind: 'range',
    base,
    head,
    files,
    lines: parseNumstat(diff(root, ['--numstat', '-z', base, head])),
    added: parseAddedLines(
      diff(root, [
        '--unified=0',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        base,
        head,
      ]),
    ),
    removedExports: removedExports(root, base, head, files),
    subjects: git(root, ['log', '--format=%s', `${base}..${head}`])
      .split('\n')
      .filter(Boolean),
  };
}

function readPlan(entries) {
  const files = entries.map(entry => {
    const match = /^([ADR]):(.+)$/u.exec(entry);
    if (!match) return { status: 'modified', path: entry };
    if (match[1] === 'A') return { status: 'added', path: match[2] };
    if (match[1] === 'D') return { status: 'deleted', path: match[2] };
    const [from, path] = match[2].split(':');
    if (!from || !path) throw new Error(`Write a planned rename as R:old:new.`);
    return { status: 'renamed', from, path };
  });
  return { kind: 'plan', files };
}

module.exports = { readRange, readPlan, exportNames };
