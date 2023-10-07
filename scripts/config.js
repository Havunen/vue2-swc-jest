import path from 'path';
import fs from 'fs';
import {rollup} from 'rollup';
import chalk from 'chalk';
import {gzipSizeSync} from 'gzip-size';
import {filesize} from 'filesize';
import pkgJson from '../package.json' assert { type: "json" };
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(import.meta.url);

const version = process.env.VERSION || pkgJson.version;

const commons = {
  banner:
    `/**
  * vue2-swc-jest v${version}
  * (c) ${new Date().getFullYear()} Sampo Kivistö <havunen>
  * @license MIT
  */`,
  outputFolder: path.join(__dirname, '..', '..', 'dist')
};

const paths = {
  dist: commons.outputFolder
};

const utils = {
  stats ({ path, code }) {
    const { size } = fs.statSync(path);
    const gzipped = gzipSizeSync(code);

    return `| Size: ${filesize(size)} | Gzip: ${filesize(gzipped)}`;
  },
  async writeBundle ({ input, output }, fileName, minify = false) {
    const bundle = await rollup(input);
    const { output: [{ code }] } = await bundle.generate(output);

    let outputPath = path.join(paths.dist, fileName);
    fs.writeFileSync(outputPath, code);
    let stats = this.stats({ code, path: outputPath });
    console.log(`${chalk.green('Output File:')} ${fileName} ${stats}`);

    return true;
  }
};

const builds = {
  cjs: {
    input: './lib/index.js',
    format: 'cjs',
  },
  esm: {
    input: './lib/index.js',
    format: 'es'
  },
};

function genConfig (options) {
  const config = {
    input: {
      input: options.input
    },
    output: {
      banner: commons.banner,
      format: options.format,
      name: options.name
    }
  };

  return config;
};

const configs = Object.keys(builds).reduce((prev, key) => {
  prev[key] = genConfig(builds[key]);

  return prev;
}, {});

export default {
  configs,
  utils,
  paths
};
