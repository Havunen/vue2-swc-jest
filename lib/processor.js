import VueTemplateCompiler from 'vue-template-compiler';
import swcJest from '@swc/jest';
import * as vue2compiler from 'vue/compiler-sfc';
import {processStyleAsync, processStyleSync} from './process-style.js';
import { createTsTransformer } from './transformers/typescript.js';
import processCustomBlocks from './process-custom-blocks.js';
import {getCustomTransformer, getSwcVueJestConfig, loadSrc, logResultErrors, stripInlineSourceMap} from './utils.js';
import {generateCodeSync} from './generate-code.js';
import {generateCodeAsync} from './generate-code-async.js';
import {mapLinesSync} from './map-lines.js';
import {mapLinesAsync} from './map-lines-async.js';

function resolveTransformer(lang = 'js', vueJestConfig) {
  const transformer = getCustomTransformer(vueJestConfig['transform'], lang)
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

  let externalSrc = null
  if (scriptPart.src) {
    scriptPart.content = loadSrc(scriptPart.src, filePath)
    externalSrc = scriptPart.content
  }

  const vueJestConfig = getSwcVueJestConfig(config)
  const transformer = resolveTransformer(scriptPart.lang, vueJestConfig)

  const result = transformer.process(scriptPart.content, filePath, config)
  result.code = stripInlineSourceMap(result.code)
  result.map = mapLinesSync(scriptPart.map, result.map)
  result.externalSrc = externalSrc
  return result
}

async function processScriptAsync(scriptPart, filePath, config) {
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

  const result = await transformer.processAsync(scriptPart.content, filePath, config)
  result.code = stripInlineSourceMap(result.code)
  result.map = await mapLinesAsync(scriptPart.map, result.map)
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
  const contentMap = mapLinesSync(descriptor.scriptSetup.map, content.map)

  const transformer = resolveTransformer(
    descriptor.scriptSetup.lang,
    vueJestConfig
  )

  const result = transformer.process(content.content, filePath, config)
  result.code = stripInlineSourceMap(result.code)
  result.map = mapLinesSync(contentMap, result.map)

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

  const userTemplateCompilerOptions = vueJestConfig.templateCompiler || {}
  const result = vue2compiler.compileTemplate({
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
  })

  logResultErrors(result)

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
    }))

  return filteredStyles.length ? filteredStyles : null
}

async function processStylesAsync(styles, filename, config) {
  if (!styles) {
    return null
  }

  const promises = []

  for (const style of styles) {
    if (style.module) {
      promises.push(processStyleAsync(style, filename, config))
    }
  }

  const values = await Promise.all(promises)

  const filteredStyles = []
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i]

    if (style.module) {
      filteredStyles.push({
        code: values[i],
        moduleName: style.module === true ? '$style' : style.module
      })
    }
  }

  return filteredStyles.length ? filteredStyles : null
}

export function runSync(src, filename, config) {
  const descriptor = vue2compiler.parse({
    source: src,
    compiler: undefined,
    filename
  })

  const templateResult = processTemplate(descriptor, filename, config)
  const stylesResult = processStyles(descriptor.styles, filename, config)
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

export async function runAsync(src, filename, config) {
  const descriptor = vue2compiler.parse({
    source: src,
    compiler: undefined,
    filename
  })

  const templateResult = processTemplate(descriptor, filename, config)
  const stylesResult = await processStylesAsync(descriptor.styles, filename, config)
  const customBlocksResult = processCustomBlocks(
      descriptor.customBlocks,
      filename,
      config
  )

  let scriptResult
  const scriptSetupResult = processScriptSetup(descriptor, filename, config)

  if (!scriptSetupResult) {
    scriptResult = await processScriptAsync(descriptor.script, filename, config)
  }

  const isFunctional =
      (descriptor.template &&
          descriptor.template.attrs &&
          descriptor.template.attrs.functional) ||
      (descriptor.script &&
          descriptor.script.content &&
          /functional:\s*true/.test(descriptor.script.content))

  const output = await generateCodeAsync(
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
