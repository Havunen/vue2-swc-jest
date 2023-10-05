import crypto from 'crypto';
import swcJest from '@swc/jest';
import {runSync, runAsync} from './lib/processor.js';

export default {
    process: runSync,
    processAsync: runAsync,
    getCacheKey: function getCacheKey(
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
    },
};
