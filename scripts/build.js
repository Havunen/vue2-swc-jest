import chalk from 'chalk';
import {mkdirpNative} from 'mkdirp';
import config from './config.js';
const {configs, paths, utils} = config

async function build () {
  await mkdirpNative(paths.dist);
  console.log(chalk.cyan('Generating esm build...'));
  await utils.writeBundle(configs.cjs, 'index.cjs');
  await utils.writeBundle(configs.esm, 'index.mjs');
}

build();
