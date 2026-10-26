'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { createDataset } = require('./src/dataset');
const { solve } = require('./src/engine');
try { parentPort.postMessage({ result: solve(createDataset(), workerData.input) }); }
catch (e) { parentPort.postMessage({ error: e.message }); }
