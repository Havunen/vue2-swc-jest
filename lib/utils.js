import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import {throwError} from './throw-error.js';
import constants from './constants.js';

export function fetchTransformer(key, obj) {
  for (const exp in obj) {
    const matchKey = new RegExp(exp)
    if (matchKey.test(key)) {
      return obj[exp]
    }
  }
  return null
}

export function resolvePath(pathToResolve) {
  return /^(\.\.\/|\.\/|\/)/.test(pathToResolve)
    ? path.resolve(process.cwd(), pathToResolve)
    : pathToResolve
}

export function info(msg) {
  console.info(chalk.blue('\n[vue-jest]: ' + msg + '\n'))
}

export function warn(msg) {
  console.warn(chalk.red('\n[vue-jest]: ' + msg + '\n'))
}

export function transformContent(
  content,
  filePath,
  config,
  transformer,
  attrs
) {
  if (!transformer) {
    return content
  }
  try {
    return transformer(content, filePath, config, attrs)
  } catch (err) {
    warn(`There was an error while compiling ${filePath} ${err}`)
  }
  return content
}

export function getSwcVueJestConfig(jestConfig) {
  return (
      (jestConfig &&
          jestConfig.config &&
          jestConfig.config.globals &&
          jestConfig.config.globals['vue2-swc-jest']) ||
      {}
  )
}

export function isValidTransformer(transformer) {
  return (
    isFunction(transformer.createTransformer) ||
    isFunction(transformer.process) ||
    isFunction(transformer.postprocess) ||
    isFunction(transformer.preprocess)
  )
}

const isFunction = fn => typeof fn === 'function'

export function getCustomTransformer(
  transform = {},
  lang
) {
  transform = { ...constants.defaultVueJestConfig.transform, ...transform }

  const transformerPath = fetchTransformer(lang, transform)

  if (!transformerPath) {
    return null
  }

  let transformer
  if (
    typeof transformerPath === 'string' &&
    require(resolvePath(transformerPath))
  ) {
    transformer = require(resolvePath(transformerPath))
  } else if (typeof transformerPath === 'object') {
    transformer = transformerPath
  }

  if (!isValidTransformer(transformer)) {
    throwError(
      `transformer must contain at least one createTransformer(), process(), preprocess(), or postprocess() method`
    )
  }

  return isFunction(transformer.createTransformer)
    ? transformer.createTransformer()
    : transformer
}

export function stripInlineSourceMap(str) {
  return str.slice(0, str.indexOf('//# sourceMappingURL'))
}

export function logResultErrors(result) {
  if (result.errors.length) {
    result.errors.forEach(function(msg) {
      console.error('\n' + chalk.red(msg) + '\n')
    })
    throwError('Vue template compilation failed')
  }
}

export function loadSrc(src, filePath) {
  var dir = path.dirname(filePath)
  var srcPath = path.resolve(dir, src)
  try {
    return fs.readFileSync(srcPath, 'utf-8')
  } catch (e) {
    throwError(
        'Failed to load src: "' + src + '" from file: "' + filePath + '"'
    )
  }
}
