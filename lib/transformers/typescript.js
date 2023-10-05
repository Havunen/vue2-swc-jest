import swcCore from '@swc/core';

export function createTsTransformer(scriptLang) {
  return {
    processAsync(scriptContent, filePath, config) {
      return swcCore.transform(scriptContent, {
        // Some options cannot be specified in .swcrc
        filename: filePath + (scriptLang === 'tsx' ? '.tsx' : ''),
        sourceMaps: true,
        // Input files are treated as module by default.
        isModule: true,
        module: {
          type: config.supportsStaticESM ? 'es6' : 'commonjs'
        },
        // All options below can be configured via .swcrc
        jsc: {
          parser: {
            "syntax": "typescript",
            "tsx": false,
            "decorators": true,
            "dynamicImport": true
          },
          transform: {},
          loose: true
        },
      })
    },
    process(scriptContent, filePath, config) {
      const res = swcCore.transformSync(scriptContent, {
        // Some options cannot be specified in .swcrc
        filename: filePath + (scriptLang === 'tsx' ? '.tsx' : ''),
        sourceMaps: true,
        // Input files are treated as module by default.
        isModule: true,
        module: {
          type: config.supportsStaticESM ? 'es6' : 'commonjs'
        },
        // All options below can be configured via .swcrc
        jsc: {
          parser: {
            "syntax": "typescript",
            "tsx": false,
            "decorators": true,
            "dynamicImport": true
          },
          transform: {},
          loose: true
        },
      })

      return res
    }
  }
}
