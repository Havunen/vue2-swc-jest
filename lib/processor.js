import VueTemplateCompiler from 'vue-template-compiler';
import swcJest from '@swc/jest';
import * as vue2compiler from 'vue/compiler-sfc';
import _processStyle from './process-style.js';
import typescriptTransformer from './transformers/typescript.js';
import processCustomBlocks from './process-custom-blocks.js';
import {getCustomTransformer, getSwcVueJestConfig, loadSrc, logResultErrors, stripInlineSourceMap} from './utils.js';
import {generateCodeSync} from './generate-code.js';
import {mapLinesAsync} from './map-lines.js';

function resolveTransformer(lang = 'js', vueJestConfig) {
  const transformer = getCustomTransformer(vueJestConfig['transform'], lang)
  if (/^typescript$|tsx?$/.test(lang)) {
    return transformer || typescriptTransformer(lang)
  } else {
    return transformer || swcJest.createTransformer()
  }
}

function processScript(scriptPart, filePath, config) {
  if (!scriptPart) {
    return null
  }

  let externalSrc = null
  if (scriptPart.src) {
    scriptPart.content = loadSrc(scriptPart.src, filePath)
    externalSrc = scriptPart.content
  }

  const vueJestConfig = getSwcVueJestConfig(config)
  const transformer = resolveTransformer(scriptPart.lang, vueJestConfig)

  const result = transformer.process(scriptPart.content, filePath, config)
  result.code = stripInlineSourceMap(result.code)
  result.map = mapLinesAsync(scriptPart.map, result.map)
  result.externalSrc = externalSrc
  return result
}

function processScriptSetup(descriptor, filePath, config) {
  if (!descriptor.scriptSetup) {
    return null
  }
  const vueJestConfig = getSwcVueJestConfig(config)
  const content = vue2compiler.compileScript(descriptor, {
    id: filePath,
    reactivityTransform: true,
    ...vueJestConfig.compilerOptions
  })
  const contentMap = mapLinesAsync(descriptor.scriptSetup.map, content.map)

  const transformer = resolveTransformer(
    descriptor.scriptSetup.lang,
    vueJestConfig
  )

  const result = transformer.process(content.content, filePath, config)
  result.code = stripInlineSourceMap(result.code)
  result.map = mapLinesAsync(contentMap, result.map)

  return result
}

function processTemplate(descriptor, filename, config) {
  const { template, scriptSetup } = descriptor

  if (!template) {
    return null
  }

  const vueJestConfig = getSwcVueJestConfig(config)

  if (template.src) {
    template.content = loadSrc(template.src, filename)
  }

  let bindings
  if (scriptSetup) {
    const scriptSetupResult = vue2compiler.compileScript(descriptor, {
      id: filename,
      reactivityTransform: true,
      ...vueJestConfig.compilerOptions
    })
    bindings = scriptSetupResult.bindings
  }

  // const userTemplateCompilerOptions = vueJestConfig.templateCompiler || {}
  const result = vue2compiler.compileTemplate({
    source: template.content,
    compiler: VueTemplateCompiler,
    filename: filename,
    isFunctional: template.attrs.functional,
    preprocessLang: template.lang,
    preprocessOptions: vueJestConfig[template.lang],
    // ...userTemplateCompilerOptions,
    compilerOptions: {
      ...({ optimize: false }),
      // ...userTemplateCompilerOptions.compilerOptions
    },
    ...({ bindings })
  })

  logResultErrors(result)

  return result
}

function processStyle(styles, filename, config) {
  if (!styles) {
    return null
  }

  const filteredStyles = styles
    .filter(style => style.module)
    .map(style => ({
      code: _processStyle(style, filename, config),
      moduleName: style.module === true ? '$style' : style.module
    }))

  return filteredStyles.length ? filteredStyles : null
}

export function runSync(src, filename, config) {
  const descriptor = vue2compiler.parse({
    source: src,
    compiler: undefined,
    filename
  })

  const templateResult = processTemplate(descriptor, filename, config)
  const stylesResult = processStyle(descriptor.styles, filename, config)
  const customBlocksResult = processCustomBlocks(
      descriptor.customBlocks,
      filename,
      config
  )

  let scriptResult
  const scriptSetupResult = processScriptSetup(descriptor, filename, config)

  if (!scriptSetupResult) {
    scriptResult = processScript(descriptor.script, filename, config)
  }

  const isFunctional =
      (descriptor.template &&
          descriptor.template.attrs &&
          descriptor.template.attrs.functional) ||
      (descriptor.script &&
          descriptor.script.content &&
          /functional:\s*true/.test(descriptor.script.content))

  const output = generateCodeSync(
      scriptResult,
      scriptSetupResult,
      templateResult,
      stylesResult,
      customBlocksResult,
      isFunctional,
      filename,
      config
  )

  return {
    code: output.code,
    map: output.map.toString()
  }
}
