import fs from "fs";
import path from "path";
import ts from "typescript";

function isSourceFileEligible(filePath: string): boolean {
	const ext = path.extname(filePath);
	return [".ts", ".tsx", ".js", ".jsx"].includes(ext) && !filePath.endsWith(".d.ts");
}

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, files);
		} else if (entry.isFile() && isSourceFileEligible(full)) {
			files.push(full);
		}
	}
	return files;
}

function getScriptKind(filePath: string): ts.ScriptKind {
	if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
	if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
	if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
	return ts.ScriptKind.JS;
}

function collectExistingTopLevelImports(sourceFile: ts.SourceFile): Set<string> {
	const names = new Set<string>();
	sourceFile.forEachChild((node) => {
		if (ts.isImportDeclaration(node) && node.importClause) {
			const { importClause } = node;
			if (importClause.name) names.add(importClause.name.text);
			if (importClause.namedBindings) {
				if (ts.isNamedImports(importClause.namedBindings)) {
					for (const el of importClause.namedBindings.elements) {
						names.add(el.name.text);
					}
				} else if (ts.isNamespaceImport(importClause.namedBindings)) {
					names.add(importClause.namedBindings.name.text);
				}
			}
		}
	});
	return names;
}

function transformFile(filePath: string): boolean {
	const text = fs.readFileSync(filePath, "utf8");
	if (!text.includes("from \"lodash-es\"") && !text.includes("from 'lodash-es'")) {
		return false;
	}

	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, getScriptKind(filePath));

	let hasLodashNamespaceImport = false;
	let lodashNamespaceImportNode: ts.ImportDeclaration | undefined;
	let usedMembers = new Set<string>();

	const existingTopLevelImports = collectExistingTopLevelImports(sourceFile);

	// First pass: detect lodash-es namespace import and collect used members
	sourceFile.forEachChild((node) => {
		if (ts.isImportDeclaration(node)) {
			const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
			if (moduleName === "lodash-es" && node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
				const ns = node.importClause.namedBindings.name.text;
				if (ns === "_") {
					hasLodashNamespaceImport = true;
					lodashNamespaceImportNode = node;
				}
			}
		}
	});

	if (!hasLodashNamespaceImport || !lodashNamespaceImportNode) {
		return false;
	}

	function collectFromNode(node: ts.Node) {
		function visit(n: ts.Node) {
			if (ts.isPropertyAccessExpression(n)) {
				if (ts.isIdentifier(n.expression) && n.expression.text === "_") {
					usedMembers.add(n.name.text);
				}
			}
			if ((ts as any).isPropertyAccessChain?.(n)) {
				const chain = n as unknown as ts.PropertyAccessChain;
				if (ts.isIdentifier(chain.expression) && chain.expression.text === "_") {
					usedMembers.add(chain.name.text);
				}
			}
			ts.forEachChild(n, visit);
		}
		visit(node);
	}

	collectFromNode(sourceFile);

	// If nothing used, remove the import
	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

	const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
		const { factory } = context;

		const visitor: ts.Visitor = (node) => {
			// Replace namespace import with named import
			if (ts.isImportDeclaration(node)) {
				const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
				if (moduleName === "lodash-es" && node.importClause?.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings) && node.importClause.namedBindings.name.text === "_") {
					if (usedMembers.size === 0) {
						// Remove the import by returning undefined (filtered later)
						return undefined as unknown as ts.Node;
					}
					const namedElements: ts.ImportSpecifier[] = [];
					for (const name of Array.from(usedMembers).sort()) {
						let importName = name;
						if (existingTopLevelImports.has(importName)) {
							// Avoid conflicts with existing imports by aliasing
							const alias = `lodash${importName.charAt(0).toUpperCase()}${importName.slice(1)}`;
							namedElements.push(factory.createImportSpecifier(false, factory.createIdentifier(importName), factory.createIdentifier(alias)));
						} else {
							namedElements.push(factory.createImportSpecifier(false, undefined, factory.createIdentifier(importName)));
						}
					}
					return factory.updateImportDeclaration(
						node,
						node.modifiers,
						factory.updateImportClause(node.importClause, false, undefined, factory.createNamedImports(namedElements)),
						node.moduleSpecifier,
						node.assertClause
					);
				}
			}

			// Replace _.member with member (or alias if conflicted)
			if (ts.isPropertyAccessExpression(node)) {
				if (ts.isIdentifier(node.expression) && node.expression.text === "_") {
					const member = node.name.text;
					const importNameConflicted = existingTopLevelImports.has(member);
					if (importNameConflicted) {
						const alias = `lodash${member.charAt(0).toUpperCase()}${member.slice(1)}`;
						return factory.createIdentifier(alias);
					}
					return factory.createIdentifier(member);
				}
			}
			if ((ts as any).isPropertyAccessChain?.(node)) {
				const chain = node as unknown as ts.PropertyAccessChain;
				if (ts.isIdentifier(chain.expression) && chain.expression.text === "_") {
					const member = chain.name.text;
					const importNameConflicted = existingTopLevelImports.has(member);
					const id = importNameConflicted
						? factory.createIdentifier(`lodash${member.charAt(0).toUpperCase()}${member.slice(1)}`)
						: factory.createIdentifier(member);
					return id as unknown as ts.Node;
				}
			}

			return ts.visitEachChild(node, visitor, context);
		};

		return (node) => ts.visitNode(node, visitor);
	};

	const result = ts.transform(sourceFile, [transformer]);
	let transformed = result.transformed[0];

	// Filter out removed imports (undefined)
	const statements = transformed.statements.filter(Boolean) as ts.Statement[];
	transformed = ts.factory.updateSourceFile(transformed, statements);

	const newText = printer.printFile(transformed);
	if (newText !== text) {
		fs.writeFileSync(filePath, newText, "utf8");
		return true;
	}
	return false;
}

function main() {
	const root = path.resolve(__dirname, "..");

	const fileListPath = path.resolve(root, "ci", "lodash-files.txt");
	let fileList: string[] | undefined;
	if (fs.existsSync(fileListPath)) {
		fileList = fs
			.readFileSync(fileListPath, "utf8")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0 && fs.existsSync(s));
	}

	const packagesDir = path.resolve(root, "packages");
	const desktopDir = path.resolve(root, "desktop");
	const webDir = path.resolve(root, "web");
	const benchmarkDir = path.resolve(root, "benchmark");

	const roots = [packagesDir, desktopDir, webDir, benchmarkDir].filter((p) => fs.existsSync(p));
	let changed = 0;
	const candidates = fileList ?? roots.flatMap((r) => walk(r));
	for (const file of candidates) {
		try {
			if (!isSourceFileEligible(file)) continue;
			const did = transformFile(file);
			if (did) changed += 1;
		} catch (err) {
			console.error(`Failed to transform ${file}:`, err);
		}
	}
	console.log(`Transformed files: ${changed}`);
}

main();