'use strict';
const { parentPort, workerData } = require('node:worker_threads');
try { parentPort.postMessage({ result:require('./cbd-route').route(workerData.gis,workerData.cbd,workerData.input) }); }
catch (error) { parentPort.postMessage({ error:error.message }); }
