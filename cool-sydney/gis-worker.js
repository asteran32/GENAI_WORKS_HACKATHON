'use strict';
const { parentPort, workerData } = require('node:worker_threads');
try { parentPort.postMessage({ result: require('./gis-shadow').simulate(workerData.snapshot, workerData.input) }); }
catch (e) { parentPort.postMessage({ error: e.message }); }
