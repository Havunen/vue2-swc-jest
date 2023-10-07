# vue2-swc-jest

SWC - Jest transformer for Vue Single File Components.

This plugin is designed to be used with `@swc/jest`

This plugin exists to replace babel from jest - vue compilation process using SWC.

Jest configuration:

```
  transform: {
    '\\.ts$': '@swc/jest',
    '\\.vue$': 'vue2-swc-jest',
  },
  globals: {
    'vue2-swc-jest': {
      templateCompiler: {
        prettify: false,
      },
    },
  },
```
