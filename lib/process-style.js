import path from 'path';
import * as cssTree from 'css-tree';
import {compileStyle} from '@vue/component-compiler-utils';
import {getCustomTransformer, getSwcVueJestConfig as getVueJestConfig, loadSrc, logResultErrors} from './utils.js';
import applyModuleNameMapper from './module-name-mapper-helper.js';

function getGlobalResources(resources, lang) {
  let globalResources = ''
  if (resources && resources[lang]) {
    globalResources = resources[lang]
      .map(resource => {
        const absolutePath = path.resolve(process.cwd(), resource)
        return `${getImportLine(lang, absolutePath)}\n`
      })
      .join('')
  }
  return globalResources
}

function getImportLine(lang, filePath) {
  const importLines = {
    default: `@import "${filePath}";`,
    sass: `@import "${filePath}"`
  }
  return importLines[lang] || importLines.default
}

function extractClassMap(cssCode) {
  const ast = cssTree.parse(cssCode)

  return cssTree
    .findAll(ast, node => node.type === 'ClassSelector')
    .reduce((acc, cssNode) => {
      acc[cssNode.name] = cssNode.name

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

export default function processStyle(stylePart, filePath, config = {}) {
  const vueJestConfig = getVueJestConfig(config)

  if (stylePart.src && !stylePart.content.trim()) {
    const cssFilePath = applyModuleNameMapper(
      stylePart.src,
      filePath,
      config.config,
      stylePart.lang
    )
    stylePart.content = loadSrc(cssFilePath, filePath)
    filePath = cssFilePath
  }

  if (vueJestConfig.experimentalCSSCompile === false || !stylePart.content) {
    return '{}'
  }

  let content =
    getGlobalResources(vueJestConfig.resources, stylePart.lang) +
    stylePart.content

  const transformer =
    getCustomTransformer(vueJestConfig['transform'], stylePart.lang) || {}

  // pre process
  if (transformer.preprocess) {
    content = transformer.preprocess(content, filePath, config, stylePart.attrs)
  }

  // transform
  if (transformer.process) {
    content = transformer.process(content, filePath, config, stylePart.attrs)
  } else {
    const preprocessOptions = getPreprocessOptions(
      stylePart.lang,
      filePath,
      config.config
    )
    const result = compileStyle({
      source: content,
      filePath,
      preprocessLang: stylePart.lang,
      preprocessOptions: {
        ...preprocessOptions,
        ...vueJestConfig.styleOptions
      },
      scoped: false
    })
    logResultErrors(result)
    content = result.code
  }

  // post process
  if (transformer.postprocess) {
    return transformer.postprocess(content, filePath, config, stylePart.attrs)
  }

  return JSON.stringify(extractClassMap(content))
}
