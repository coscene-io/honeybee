#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LIST = path.resolve(ROOT, "ci", "lodash-files.txt");

function readFileList() {
	if (!fs.existsSync(LIST)) return [];
	return fs
		.readFileSync(LIST, "utf8")
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && fs.existsSync(path.resolve(ROOT, s)))
		.map((s) => path.resolve(ROOT, s));
}

function hasNamespaceImport(content) {
	return /(^|\n)\s*import\s+\*\s+as\s+_\s+from\s+["']lodash-es["']\s*;?/m.test(content);
}

function collectUsedMembers(content) {
	const re = /_\s*\.\s*([A-Za-z0-9_]+)/g;
	const used = new Set();
	let m;
	while ((m = re.exec(content))) {
		used.add(m[1]);
	}
	return Array.from(used);
}

function replaceImportLine(content, members) {
	const importRe = /(^|\n)(\s*)import\s+\*\s+as\s+_\s+from\s+["']lodash-es["']\s*;?/m;
	if (members.length === 0) {
		return content.replace(importRe, (match, pre, indent) => pre);
	}
	const spec = members.sort().join(", ");
	return content.replace(importRe, (match, pre, indent) => `${pre}${indent}import { ${spec} } from "lodash-es";`);
}

function replaceUsages(content) {
	return content.replace(/_\s*\.\s*([A-Za-z0-9_]+)/g, (m, name) => name);
}

function transformFile(file) {
	let content = fs.readFileSync(file, "utf8");
	if (!hasNamespaceImport(content)) return false;
	const used = collectUsedMembers(content);
	let next = replaceImportLine(content, used);
	next = replaceUsages(next);
	if (next !== content) {
		fs.writeFileSync(file, next, "utf8");
		return true;
	}
	return false;
}

function main() {
	const files = readFileList();
	let changed = 0;
	for (const file of files) {
		try {
			const did = transformFile(file);
			if (did) changed++;
		} catch (err) {
			console.error("Failed:", file, err);
		}
	}
	console.log("Transformed files:", changed);
}

if (require.main === module) {
	main();
}