/**
  * vue2-swc-jest v0.2.1
  * (c) 2023 Sampo Kivistö <havunen>
  * @license MIT
  */
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var crypto = require('crypto');
var swcJest = require('@swc/jest');
var VueTemplateCompiler = require('vue-template-compiler');
var vue2compiler = require('vue/compiler-sfc');
var path = require('path');
var cssTree = require('css-tree');
var componentCompilerUtils = require('@vue/component-compiler-utils');
var chalk = require('chalk');
var fs = require('fs');
var swcCore = require('@swc/core');
var sourceMap = require('@cspotcode/source-map');
var sourceMap$1 = require('source-map');

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var vue2compiler__namespace = /*#__PURE__*/_interopNamespaceDefault(vue2compiler);
var cssTree__namespace = /*#__PURE__*/_interopNamespaceDefault(cssTree);

function throwError(msg) {
  throw new Error('\n[vue-jest] Error: ' + msg + '\n')
}

var vueOptionsNamespace = {
  vueOptionsNamespace: '__options__',
  defaultVueJestConfig: {
    transformAsync: {}
  }
};

function fetchTransformer(key, obj) {
  for (const exp in obj) {
    const matchKey = new RegExp(exp);
    if (matchKey.test(key)) {
      return obj[exp]
    }
  }
  return null
}

function resolvePath(pathToResolve) {
  return /^(\.\.\/|\.\/|\/)/.test(pathToResolve)
    ? path.resolve(process.cwd(), pathToResolve)
    : pathToResolve
}

function getSwcVueJestConfig(jestConfig) {
  return (
      (jestConfig &&
          jestConfig.config &&
          jestConfig.config.globals &&
          jestConfig.config.globals['vue2-swc-jest']) ||
      {}
  )
}

function isValidTransformer(transformer) {
  return (
    isFunction(transformer.createTransformer) ||
    isFunction(transformer.process) ||
    isFunction(transformer.postprocess) ||
    isFunction(transformer.preprocess)
  )
}

const isFunction = fn => typeof fn === 'function';

function getCustomTransformer(
  transform = {},
  lang
) {
  transform = { ...vueOptionsNamespace.defaultVueJestConfig.transform, ...transform };

  const transformerPath = fetchTransformer(lang, transform);

  if (!transformerPath) {
    return null
  }

  let transformer;
  if (
    typeof transformerPath === 'string' &&
    require(resolvePath(transformerPath))
  ) {
    transformer = require(resolvePath(transformerPath));
  } else if (typeof transformerPath === 'object') {
    transformer = transformerPath;
  }

  if (!isValidTransformer(transformer)) {
    throwError(
      `transformer must contain at least one createTransformer(), process(), preprocess(), or postprocess() method`
    );
  }

  return isFunction(transformer.createTransformer)
    ? transformer.createTransformer()
    : transformer
}

function stripInlineSourceMap(str) {
  return str.slice(0, str.indexOf('//# sourceMappingURL'))
}

function logResultErrors(result) {
  if (result.errors.length) {
    result.errors.forEach(function(msg) {
      console.error('\n' + chalk.red(msg) + '\n');
    });
    throwError('Vue template compilation failed');
  }
}

function loadSrc(src, filePath) {
  var dir = path.dirname(filePath);
  var srcPath = path.resolve(dir, src);
  try {
    return fs.readFileSync(srcPath, 'utf-8')
  } catch (e) {
    throwError(
        'Failed to load src: "' + src + '" from file: "' + filePath + '"'
    );
  }
}

/**
 * Resolve a Sass @import or @use rule.
 *
 * @param {String} to - The path to the current file
 * @param {String} importPath - The path to resolve
 * @param {String} fileType - The filetype of the current file
 */
function resolveSass(to, importPath, fileType) {
  // Mimic Sass-loader's `~` syntax for bare imports.
  const matchModuleImport = /^~/;

  if (path.isAbsolute(importPath)) {
    return importPath
  } else if (matchModuleImport.test(importPath)) {
    const dirname = path.dirname(importPath).replace(matchModuleImport, '');
    const basename = path.basename(importPath);

    const filenames = [];

    if (!/\.(sc|sa|c)ss/.test(basename)) {
      const extensions = ['scss', 'sass', 'css'].filter(e => e !== fileType);
      extensions.unshift(fileType);
      extensions.forEach(ext => {
        filenames.push(`${basename}.${ext}`, `_${basename}.${ext}`);
      });
    } else {
      filenames.push(basename, `_${basename}`);
    }

    for (const filename of filenames) {
      try {
        return require.resolve(path.join(dirname, filename), { paths: [to] })
      } catch (_) {}
    }
  }

  return path.join(path.dirname(to), importPath)
}

/**
 * Applies the moduleNameMapper substitution from the jest config
 *
 * @param {String} source - the original string
 * @param {String} filePath - the path of the current file (where the source originates)
 * @param {Object} jestConfig - the jestConfig holding the moduleNameMapper settings
 * @param {Object} fileType - extn of the file to be resolved
 * @returns {String} path - the final path to import (including replacements via moduleNameMapper)
 */
function applyModuleNameMapper(
    source,
    filePath,
    jestConfig = {},
    fileType = ''
) {
  if (!jestConfig.moduleNameMapper) return source

  const module = Array.isArray(jestConfig.moduleNameMapper)
    ? jestConfig.moduleNameMapper
    : Object.entries(jestConfig.moduleNameMapper);

  const importPath = module.reduce((acc, [regex, replacement]) => {
    const matches = acc.match(regex);

    if (matches === null) {
      return acc
    }

    return replacement.replace(
      /\$([0-9]+)/g,
      (_, index) => matches[parseInt(index, 10)]
    )
  }, source);

  return resolveSass(filePath, importPath, fileType)
}

function getGlobalResources(resources, lang) {
  let globalResources = '';
  if (resources && resources[lang]) {
    globalResources = resources[lang]
      .map(resource => {
        const absolutePath = path.resolve(process.cwd(), resource);
        return `${getImportLine(lang, absolutePath)}\n`
      })
      .join('');
  }
  return globalResources
}

function getImportLine(lang, filePath) {
  const importLines = {
    default: `@import "${filePath}";`,
    sass: `@import "${filePath}"`
  };
  return importLines[lang] || importLines.default
}

function extractClassMap(cssCode) {
  const ast = cssTree__namespace.parse(cssCode);

  return cssTree__namespace
    .findAll(ast, node => node.type === 'ClassSelector')
    .reduce((acc, cssNode) => {
      acc[cssNode.name] = cssNode.name;

      return acc
    }, {})
}

function getPreprocessOptions(lang, filePath, jestConfig) {
  if (lang === 'scss' || lang === 'sass') {
    return {
      filename: filePath,
      importer: (url, prev, done) => ({
        file: applyModuleNameMapper(
          url,
          prev === 'stdin' ? filePath : prev,
          jestConfig,
          lang
        )
      })
    }
  }
  if (lang === 'styl' || lang === 'stylus' || lang === 'less') {
    return {
      paths: [path.dirname(filePath), process.cwd()]
    }
  }
}

function processStyleSync(stylePart, filePath, config = {}) {
  const vueJestConfig = getSwcVueJestConfig(config);

  if (stylePart.src && !stylePart.content.trim()) {
    const cssFilePath = applyModuleNameMapper(
      stylePart.src,
      filePath,
      config.config,
      stylePart.lang
    );
    stylePart.content = loadSrc(cssFilePath, filePath);
    filePath = cssFilePath;
  }

  if (vueJestConfig.experimentalCSSCompile === false || !stylePart.content) {
    return '{}'
  }

  let content =
    getGlobalResources(vueJestConfig.resources, stylePart.lang) +
    stylePart.content;

  const transformer =
    getCustomTransformer(vueJestConfig['transform'], stylePart.lang) || {};

  // pre process
  if (transformer.preprocess) {
    content = transformer.preprocess(content, filePath, config, stylePart.attrs);
  }

  // transform
  if (transformer.process) {
    content = transformer.process(content, filePath, config, stylePart.attrs);
  } else {
    const preprocessOptions = getPreprocessOptions(
      stylePart.lang,
      filePath,
      config.config
    );
    const result = componentCompilerUtils.compileStyle({
      source: content,
      filePath,
      preprocessLang: stylePart.lang,
      preprocessOptions: {
        ...preprocessOptions,
        ...vueJestConfig.styleOptions
      },
      scoped: false
    });
    logResultErrors(result);
    content = result.code;
  }

  // post process
  if (transformer.postprocess) {
    return transformer.postprocess(content, filePath, config, stylePart.attrs)
  }

  return JSON.stringify(extractClassMap(content))
}

async function processStyleAsync(stylePart, filePath, config = {}) {
  const vueJestConfig = getSwcVueJestConfig(config);

  if (stylePart.src && !stylePart.content.trim()) {
    const cssFilePath = applyModuleNameMapper(
        stylePart.src,
        filePath,
        config.config,
        stylePart.lang
    );
    stylePart.content = loadSrc(cssFilePath, filePath);
    filePath = cssFilePath;
  }

  if (vueJestConfig.experimentalCSSCompile === false || !stylePart.content) {
    return '{}'
  }

  let content =
      getGlobalResources(vueJestConfig.resources, stylePart.lang) +
      stylePart.content;

  const transformer =
      getCustomTransformer(vueJestConfig['transform'], stylePart.lang) || {};

  // pre process
  if (transformer.preprocess) {
    content = transformer.preprocess(content, filePath, config, stylePart.attrs);
  }

  // transform
  if (transformer.processAsync) {
    content = await transformer.processAsync(content, filePath, config, stylePart.attrs);
  } else {
    const preprocessOptions = getPreprocessOptions(
        stylePart.lang,
        filePath,
        config.config
    );
    const result = await componentCompilerUtils.compileStyleAsync({
      source: content,
      filePath,
      preprocessLang: stylePart.lang,
      preprocessOptions: {
        ...preprocessOptions,
        ...vueJestConfig.styleOptions
      },
      scoped: false
    });
    logResultErrors(result);
    content = result.code;
  }

  // post process
  if (transformer.postprocess) {
    return transformer.postprocess(content, filePath, config, stylePart.attrs)
  }

  return JSON.stringify(extractClassMap(content))
}

function createTsTransformer(scriptLang) {
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
      });

      return res
    }
  }
}

function applyTransformer(
  transformer,
  blocks,
  vueOptionsNamespace,
  filename,
  config
) {
  return transformer.process({ blocks, vueOptionsNamespace, filename, config })
}

function groupByType(acc, block) {
  acc[block.type] = acc[block.type] || [];
  acc[block.type].push(block);
  return acc
}

function processCustomBlocks (allBlocks, filename, config) {
  const blocksByType = allBlocks.reduce(groupByType, {});
  const code = [];
  for (const [type, blocks] of Object.entries(blocksByType)) {
    const transformer = getCustomTransformer(
      getSwcVueJestConfig(config).transform,
      type
    );
    if (transformer) {
      const codeStr = applyTransformer(
        transformer,
        blocks,
        vueOptionsNamespace,
        filename,
        config
      );
      code.push(codeStr);
    }
  }

  return code.length ? code.join('\n') : ''
}

const namespace$1 = vueOptionsNamespace.vueOptionsNamespace;

function addToSourceMap$1(node, result) {
    if (result && result.code) {
        if (result.map) {
            node.add(
                sourceMap.SourceNode.fromStringWithSourceMap(
                    result.code,
                    new sourceMap.SourceMapConsumer(result.map)
                )
            );
        } else {
            node.add(result.code);
        }
    }
}

function generateCodeSync(
    scriptResult,
    scriptSetupResult,
    templateResult,
    stylesResult,
    customBlocksResult,
    isFunctional,
    filename,
    config
) {
    const isESM = config.supportsStaticESM;
    const node = new sourceMap.SourceNode();


    if (scriptResult || scriptSetupResult) {
        scriptResult && addToSourceMap$1(node, scriptResult);
        scriptSetupResult && addToSourceMap$1(node, scriptSetupResult);
    } else {
        if (isESM) {
            let placeholderComp = (
                `const _comp = {} \n` +
                `export { _comp as default }`
            );
            scriptResult = placeholderComp;
            node.add(placeholderComp);
        } else {
            node.add(
                `Object.defineProperty(exports, "__esModule", {\n` +
                `  value: true\n` +
                `});\n` +
                'module.exports.default = {};\n'
            );
        }
    }

    if (isESM) {
        const componentName = (scriptResult || scriptSetupResult).code.match(/(?<=export \{ )(.*)(?= as default \})/)[0];

        if (!componentName) {
            console.error("Could not parse component name from template!");
        }

        node.add(`const ${namespace$1} = ${componentName}.options; `);
    } else {
        node.add(
            `var ${namespace$1} = typeof exports.default === 'function' ` +
            `? exports.default.options ` +
            `: exports.default\n`
        );
    }

    if (templateResult) {
        addToSourceMap$1(node, templateResult);

        node.replaceRight(
            'var _c = _vm._self._c || _h',
            '/* istanbul ignore next */\nvar _c = _vm._self._c || _h'
        );

        node.add(
            `\n__options__.render = render\n` +
            `${namespace$1}.staticRenderFns = staticRenderFns\n`
        );

        if (isFunctional) {
            node.add(`${namespace$1}.functional = true\n`);
            node.add(`${namespace$1}._compiled = true\n`);
        }
    }

    if (stylesResult) {
        const styleStr = stylesResult
            .map(
                ({code, moduleName}) =>
                    `if(!this['${moduleName}']) {\n` +
                    `  this['${moduleName}'] = {};\n` +
                    `}\n` +
                    `this['${moduleName}'] = Object.assign(\n` +
                    `this['${moduleName}'], ${code});\n`
            )
            .join('');

        if (isFunctional) {
            node.add(
                `;(function() {\n` +
                `  var originalRender = ${namespace$1}.render\n` +
                `  var styleFn = function () { ${styleStr} }\n` +
                `  ${namespace$1}.render = function renderWithStyleInjection (h, context) {\n` +
                `    styleFn.call(context)\n` +
                `    return originalRender(h, context)\n` +
                `  }\n` +
                `})()\n`
            );
        } else {
            node.add(
                `;(function() {\n` +
                `  var beforeCreate = ${namespace$1}.beforeCreate\n` +
                `  var styleFn = function () { ${styleStr} }\n` +
                `  ${namespace$1}.beforeCreate = beforeCreate ? [].concat(beforeCreate, styleFn) : [styleFn]\n` +
                `})()\n`
            );
        }
    }

    if (customBlocksResult) {
        node.add(`;\n ${customBlocksResult}`);
    }

    return node.toStringWithSourceMap({file: filename})
}

const namespace = vueOptionsNamespace.vueOptionsNamespace;

async function addToSourceMap(node, result) {
    if (result && result.code) {
        if (result.map) {
            node.add(
                sourceMap$1.SourceNode.fromStringWithSourceMap(
                    result.code,
                    await new sourceMap$1.SourceMapConsumer(result.map)
                )
            );
        } else {
            node.add(result.code);
        }
    }
}

async function generateCodeAsync(
    scriptResult,
    scriptSetupResult,
    templateResult,
    stylesResult,
    customBlocksResult,
    isFunctional,
    filename,
    config
) {
    const isESM = config.supportsStaticESM;
    const node = new sourceMap$1.SourceNode();


    if (scriptResult || scriptSetupResult) {
        scriptResult && await addToSourceMap(node, scriptResult);
        scriptSetupResult && await addToSourceMap(node, scriptSetupResult);
    } else {
        if (isESM) {
            let placeholderComp = (
                `const _comp = {} \n` +
                `export { _comp as default }`
            );
            scriptResult = placeholderComp;
            node.add(placeholderComp);
        } else {
            node.add(
                `Object.defineProperty(exports, "__esModule", {\n` +
                `  value: true\n` +
                `});\n` +
                'module.exports.default = {};\n'
            );
        }
    }

    if (isESM) {
        const componentName = (scriptResult || scriptSetupResult).code.match(/(?<=export \{ )(.*)(?= as default \})/)[0];

        if (!componentName) {
            console.error("Could not parse component name from template!");
        }

        node.add(`const ${namespace} = ${componentName}.options; `);
    } else {
        node.add(
            `var ${namespace} = typeof exports.default === 'function' ` +
            `? exports.default.options ` +
            `: exports.default\n`
        );
    }

    if (templateResult) {
        await addToSourceMap(node, templateResult);

        node.replaceRight(
            'var _c = _vm._self._c || _h',
            '/* istanbul ignore next */\nvar _c = _vm._self._c || _h'
        );

        node.add(
            `\n__options__.render = render\n` +
            `${namespace}.staticRenderFns = staticRenderFns\n`
        );

        if (isFunctional) {
            node.add(`${namespace}.functional = true\n`);
            node.add(`${namespace}._compiled = true\n`);
        }
    }

    if (stylesResult) {
        const styleStr = stylesResult
            .map(
                ({code, moduleName}) =>
                    `if(!this['${moduleName}']) {\n` +
                    `  this['${moduleName}'] = {};\n` +
                    `}\n` +
                    `this['${moduleName}'] = Object.assign(\n` +
                    `this['${moduleName}'], ${code});\n`
            )
            .join('');

        if (isFunctional) {
            node.add(
                `;(function() {\n` +
                `  var originalRender = ${namespace}.render\n` +
                `  var styleFn = function () { ${styleStr} }\n` +
                `  ${namespace}.render = function renderWithStyleInjection (h, context) {\n` +
                `    styleFn.call(context)\n` +
                `    return originalRender(h, context)\n` +
                `  }\n` +
                `})()\n`
            );
        } else {
            node.add(
                `;(function() {\n` +
                `  var beforeCreate = ${namespace}.beforeCreate\n` +
                `  var styleFn = function () { ${styleStr} }\n` +
                `  ${namespace}.beforeCreate = beforeCreate ? [].concat(beforeCreate, styleFn) : [styleFn]\n` +
                `})()\n`
            );
        }
    }

    if (customBlocksResult) {
        node.add(`;\n ${customBlocksResult}`);
    }

    return node.toStringWithSourceMap({file: filename})
}

function mapLinesSync(oldMap, newMap) {
  if (!oldMap) return newMap
  if (!newMap) return oldMap

  const oldMapConsumer = new sourceMap.SourceMapConsumer(oldMap);
  const newMapConsumer = new sourceMap.SourceMapConsumer(newMap);
  const mergedMapGenerator = new sourceMap.SourceMapGenerator();

  newMapConsumer.eachMapping(m => {
    if (m.originalLine == null) {
      return
    }

    const origPosInOldMap = oldMapConsumer.originalPositionFor({
      line: m.originalLine,
      column: m.originalColumn
    });

    if (origPosInOldMap.source == null) {
      return
    }

    mergedMapGenerator.addMapping({
      generated: {
        line: m.generatedLine,
        column: m.generatedColumn
      },
      original: {
        line: origPosInOldMap.line, // map line
        // use current column, since the oldMap produced by @vue/compiler-sfc
        // does not
        column: m.originalColumn
      },
      source: origPosInOldMap.source,
      name: origPosInOldMap.name
    });
  });

  // source-map's type definition is incomplete
  const generator = mergedMapGenerator;
  oldMapConsumer.sources.forEach(sourceFile => {
    // generator.sources.add(sourceFile)
    const sourceContent = oldMapConsumer.sourceContentFor(sourceFile);
    if (sourceContent != null) {
      mergedMapGenerator.setSourceContent(sourceFile, sourceContent);
    }
  });

  generator._sourceRoot = oldMap.sourceRoot;
  generator._file = oldMap.file;
  return generator.toJSON()
}

async function mapLinesAsync(oldMap, newMap) {
  if (!oldMap) return newMap
  if (!newMap) return oldMap

  const oldMapConsumer = await new sourceMap$1.SourceMapConsumer(oldMap);
  const newMapConsumer = await new sourceMap$1.SourceMapConsumer(newMap);
  const mergedMapGenerator = new sourceMap$1.SourceMapGenerator();

  newMapConsumer.eachMapping(m => {
    if (m.originalLine == null) {
      return
    }

    const origPosInOldMap = oldMapConsumer.originalPositionFor({
      line: m.originalLine,
      column: m.originalColumn
    });

    if (origPosInOldMap.source == null) {
      return
    }

    mergedMapGenerator.addMapping({
      generated: {
        line: m.generatedLine,
        column: m.generatedColumn
      },
      original: {
        line: origPosInOldMap.line, // map line
        // use current column, since the oldMap produced by @vue/compiler-sfc
        // does not
        column: m.originalColumn
      },
      source: origPosInOldMap.source,
      name: origPosInOldMap.name
    });
  });

  // source-map's type definition is incomplete
  const generator = mergedMapGenerator;
  for (const sourceFile of oldMapConsumer.sources) {
    // generator.sources.add(sourceFile)
    const sourceContent = oldMapConsumer.sourceContentFor(sourceFile);
    if (sourceContent != null) {
      mergedMapGenerator.setSourceContent(sourceFile, sourceContent);
    }
  }

  generator._sourceRoot = oldMap.sourceRoot;
  generator._file = oldMap.file;
  return generator.toJSON()
}

function resolveTransformer(lang = 'js', vueJestConfig) {
  const transformer = getCustomTransformer(vueJestConfig['transform'], lang);
  if (/^typescript$|tsx?$/.test(lang)) {
    return transformer || createTsTransformer(lang)
  } else {
    return transformer || swcJest.createTransformer()
  }
}

function processScript(scriptPart, filePath, config) {
  if (!scriptPart) {
    return null
  }

  let externalSrc = null;
  if (scriptPart.src) {
    scriptPart.content = loadSrc(scriptPart.src, filePath);
    externalSrc = scriptPart.content;
  }

  const vueJestConfig = getSwcVueJestConfig(config);
  const transformer = resolveTransformer(scriptPart.lang, vueJestConfig);

  const result = transformer.process(scriptPart.content, filePath, config);
  result.code = stripInlineSourceMap(result.code);
  result.map = mapLinesSync(scriptPart.map, result.map);
  result.externalSrc = externalSrc;
  return result
}

async function processScriptAsync(scriptPart, filePath, config) {
  if (!scriptPart) {
    return null
  }

  let externalSrc = null;
  if (scriptPart.src) {
    scriptPart.content = loadSrc(scriptPart.src, filePath);
    externalSrc = scriptPart.content;
  }

  const vueJestConfig = getSwcVueJestConfig(config);
  const transformer = resolveTransformer(scriptPart.lang, vueJestConfig);

  const result = await transformer.processAsync(scriptPart.content, filePath, config);
  result.code = stripInlineSourceMap(result.code);
  result.map = await mapLinesAsync(scriptPart.map, result.map);
  result.externalSrc = externalSrc;
  return result
}

function processScriptSetup(descriptor, filePath, config) {
  if (!descriptor.scriptSetup) {
    return null
  }
  const vueJestConfig = getSwcVueJestConfig(config);
  const content = vue2compiler__namespace.compileScript(descriptor, {
    id: filePath,
    reactivityTransform: true,
    ...vueJestConfig.compilerOptions
  });
  const contentMap = mapLinesSync(descriptor.scriptSetup.map, content.map);

  const transformer = resolveTransformer(
    descriptor.scriptSetup.lang,
    vueJestConfig
  );

  const result = transformer.process(content.content, filePath, config);
  result.code = stripInlineSourceMap(result.code);
  result.map = mapLinesSync(contentMap, result.map);

  return result
}

function processTemplate(descriptor, filename, config) {
  const { template, scriptSetup } = descriptor;

  if (!template) {
    return null
  }

  const vueJestConfig = getSwcVueJestConfig(config);

  if (template.src) {
    template.content = loadSrc(template.src, filename);
  }

  let bindings;
  if (scriptSetup) {
    const scriptSetupResult = vue2compiler__namespace.compileScript(descriptor, {
      id: filename,
      reactivityTransform: true,
      ...vueJestConfig.compilerOptions
    });
    bindings = scriptSetupResult.bindings;
  }

  const userTemplateCompilerOptions = vueJestConfig.templateCompiler || {};
  const result = vue2compiler__namespace.compileTemplate({
    source: template.content,
    compiler: VueTemplateCompiler,
    filename: filename,
    isFunctional: template.attrs.functional,
    preprocessLang: template.lang,
    preprocessOptions: vueJestConfig[template.lang],
    ...userTemplateCompilerOptions,
    compilerOptions: {
      ...({ optimize: false }),
      ...userTemplateCompilerOptions.compilerOptions
    },
    ...({ bindings })
  });

  logResultErrors(result);

  return result
}

function processStyles(styles, filename, config) {
  if (!styles) {
    return null
  }

  const filteredStyles = styles
    .filter(style => style.module)
    .map(style => ({
      code: processStyleSync(style, filename, config),
      moduleName: style.module === true ? '$style' : style.module
    }));

  return filteredStyles.length ? filteredStyles : null
}

async function processStylesAsync(styles, filename, config) {
  if (!styles) {
    return null
  }

  const promises = [];

  for (const style of styles) {
    if (style.module) {
      promises.push(processStyleAsync(style, filename, config));
    }
  }

  const values = await Promise.all(promises);

  const filteredStyles = [];
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];

    if (style.module) {
      filteredStyles.push({
        code: values[i],
        moduleName: style.module === true ? '$style' : style.module
      });
    }
  }

  return filteredStyles.length ? filteredStyles : null
}

function runSync(src, filename, config) {
  const descriptor = vue2compiler__namespace.parse({
    source: src,
    compiler: undefined,
    filename
  });

  const templateResult = processTemplate(descriptor, filename, config);
  const stylesResult = processStyles(descriptor.styles, filename, config);
  const customBlocksResult = processCustomBlocks(
      descriptor.customBlocks,
      filename,
      config
  );

  let scriptResult;
  const scriptSetupResult = processScriptSetup(descriptor, filename, config);

  if (!scriptSetupResult) {
    scriptResult = processScript(descriptor.script, filename, config);
  }

  const isFunctional =
      (descriptor.template &&
          descriptor.template.attrs &&
          descriptor.template.attrs.functional) ||
      (descriptor.script &&
          descriptor.script.content &&
          /functional:\s*true/.test(descriptor.script.content));

  const output = generateCodeSync(
      scriptResult,
      scriptSetupResult,
      templateResult,
      stylesResult,
      customBlocksResult,
      isFunctional,
      filename,
      config
  );

  return {
    code: output.code,
    map: output.map.toString()
  }
}

async function runAsync(src, filename, config) {
  const descriptor = vue2compiler__namespace.parse({
    source: src,
    compiler: undefined,
    filename
  });

  const templateResult = processTemplate(descriptor, filename, config);
  const stylesResult = await processStylesAsync(descriptor.styles, filename, config);
  const customBlocksResult = processCustomBlocks(
      descriptor.customBlocks,
      filename,
      config
  );

  let scriptResult;
  const scriptSetupResult = processScriptSetup(descriptor, filename, config);

  if (!scriptSetupResult) {
    scriptResult = await processScriptAsync(descriptor.script, filename, config);
  }

  const isFunctional =
      (descriptor.template &&
          descriptor.template.attrs &&
          descriptor.template.attrs.functional) ||
      (descriptor.script &&
          descriptor.script.content &&
          /functional:\s*true/.test(descriptor.script.content));

  const output = await generateCodeAsync(
      scriptResult,
      scriptSetupResult,
      templateResult,
      stylesResult,
      customBlocksResult,
      isFunctional,
      filename,
      config
  );

  return {
    code: output.code,
    map: output.map.toString()
  }
}

function getCacheKey(
    fileData,
    filename,
    {config, configString, instrument, rootDir}
) {
    return crypto
        .createHash('md5')
        .update(
            swcJest.createTransformer().getCacheKey(fileData, filename, {
                config,
                configString,
                instrument,
                rootDir
            }),
            'hex'
        )
        .digest('hex')
}

var index = {
    process: runSync,
    processAsync: runAsync,
    getCacheKey: getCacheKey
};

exports.default = index;
exports.getCacheKey = getCacheKey;
exports.process = runSync;
exports.processAsync = runAsync;
