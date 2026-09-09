// Standalone smoke of the real table; only Next Link is replaced by an anchor.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const out = process.argv[2];
if (!out) throw new Error('Usage: node tests/fixtures/build-collection-sort.cjs /tmp/cms-sort-preview');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'link.tsx'), "import React from 'react'; export default function Link({href,children,...props}:any){return <a href={href} {...props}>{children}</a>}");
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'collection-sort.tsx')], bundle: true,
  outfile: path.join(out, 'bundle.js'), jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
  alias: { '@': root, 'next/link': path.join(out, 'link.tsx') },
  define: { 'process.env.NODE_ENV': '"development"' },
});
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Collection sort acceptance</title><div id="root"></div><script src="/bundle.js"></script></html>');
require('postcss')([require('@tailwindcss/postcss')({ base: root })])
  .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css'), to: path.join(out, 'style.css') })
  .then(result => fs.writeFileSync(path.join(out, 'style.css'), result.css));
