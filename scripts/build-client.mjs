import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { build } from 'esbuild'
import { transform } from 'lightningcss'

const PLUGIN_ID = '@anestis/dsh-desktop'

const cssModules = {
  name: 'dsh-desktop-css-modules',
  setup(builder) {
    builder.onResolve({ filter: /\.module\.css$/ }, args => ({
      path: resolve(args.resolveDir, args.path),
      namespace: 'dsh-desktop-css',
    }))
    builder.onLoad({ filter: /.*/, namespace: 'dsh-desktop-css' }, async (args) => {
      const source = await readFile(args.path)
      const result = transform({
        filename: args.path,
        code: source,
        cssModules: { pattern: 'dshDesktop_[local]' },
        minify: true,
      })
      const classes = {}
      for (const [local, entry] of Object.entries(result.exports ?? {})) classes[local] = entry.name
      const tagId = `${PLUGIN_ID}/${basename(args.path)}`
      return {
        loader: 'js',
        contents: [
          `const css = ${JSON.stringify(result.code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          "if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
          "  const tag = document.createElement('style');",
          `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classes)};`,
        ].join('\n'),
      }
    })
  },
}

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  sourcemap: true,
  external: ['react', 'react/jsx-runtime'],
  plugins: [cssModules],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
