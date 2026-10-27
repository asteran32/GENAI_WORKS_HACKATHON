'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const python = process.env.COOL_SYDNEY_PYTHON || path.join(__dirname, '..', '.venv', 'bin', 'python');
const result = spawnSync(python, [path.join(__dirname, 'microclimate-import.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) { console.error(result.error.message); process.exitCode = 1; }
else process.exitCode = result.status || 0;
