import { execFileSync } from 'node:child_process';
for(const test of ['test-simulation.mjs','test-architecture.mjs','test-gis.mjs','test-opera-house.mjs','test-time.mjs','test-pedestrians.mjs','test-chat.mjs'])execFileSync(process.execPath,[new URL('../'+test,import.meta.url).pathname],{stdio:'inherit'});
