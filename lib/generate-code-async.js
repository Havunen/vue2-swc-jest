import vueOptionsNamespace from './constants.js';
import {SourceMapConsumer, SourceNode} from 'source-map';

const namespace = vueOptionsNamespace.vueOptionsNamespace;

async function addToSourceMap(node, result) {
    if (result && result.code) {
        if (result.map) {
            node.add(
                SourceNode.fromStringWithSourceMap(
                    result.code,
                    await new SourceMapConsumer(result.map)
                )
            )
        } else {
            node.add(result.code)
        }
    }
}

export async function generateCodeAsync(
    scriptResult,
    scriptSetupResult,
    templateResult,
    stylesResult,
    customBlocksResult,
    isFunctional,
    filename,
    config
) {
    const isESM = config.supportsStaticESM
    const node = new SourceNode()


    if (scriptResult || scriptSetupResult) {
        scriptResult && await addToSourceMap(node, scriptResult)
        scriptSetupResult && await addToSourceMap(node, scriptSetupResult)
    } else {
        if (isESM) {
            let placeholderComp = (
                `const _comp = {} \n` +
                `export { _comp as default }`
            )
            scriptResult = placeholderComp
            node.add(placeholderComp)
        } else {
            node.add(
                `Object.defineProperty(exports, "__esModule", {\n` +
                `  value: true\n` +
                `});\n` +
                'module.exports.default = {};\n'
            )
        }
    }

    if (isESM) {
        const componentName = (scriptResult || scriptSetupResult).code.match(/(?<=export \{ )(.*)(?= as default \})/)[0]

        if (!componentName) {
            console.error("Could not parse component name from template!")
        }

        node.add(`const ${namespace} = ${componentName}.options; `)
    } else {
        node.add(
            `var ${namespace} = typeof exports.default === 'function' ` +
            `? exports.default.options ` +
            `: exports.default\n`
        )
    }

    if (templateResult) {
        await addToSourceMap(node, templateResult)

        node.replaceRight(
            'var _c = _vm._self._c || _h',
            '/* istanbul ignore next */\nvar _c = _vm._self._c || _h'
        )

        node.add(
            `\n__options__.render = render\n` +
            `${namespace}.staticRenderFns = staticRenderFns\n`
        )

        if (isFunctional) {
            node.add(`${namespace}.functional = true\n`)
            node.add(`${namespace}._compiled = true\n`)
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
            .join('')

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
            )
        } else {
            node.add(
                `;(function() {\n` +
                `  var beforeCreate = ${namespace}.beforeCreate\n` +
                `  var styleFn = function () { ${styleStr} }\n` +
                `  ${namespace}.beforeCreate = beforeCreate ? [].concat(beforeCreate, styleFn) : [styleFn]\n` +
                `})()\n`
            )
        }
    }

    if (customBlocksResult) {
        node.add(`;\n ${customBlocksResult}`)
    }

    return node.toStringWithSourceMap({file: filename})
}
