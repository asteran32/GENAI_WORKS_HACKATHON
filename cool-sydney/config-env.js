'use strict';
const fs=require('node:fs'),path=require('node:path');
const {parseEnv}=require('node:util');

function loadProjectEnv(root,env=process.env){
  const files=[];
  // The published checkout lives inside the user's workspace. Keep their
  // existing workspace .env usable without duplicating credentials.
  if(path.basename(path.dirname(root))==='.publish')files.push(path.resolve(root,'../..','.env'));
  files.push(path.join(root,'.env'));
  const values={},loaded=[];
  for(const file of files){if(fs.existsSync(file)){Object.assign(values,parseEnv(fs.readFileSync(file,'utf8')));loaded.push(file);}}
  // Explicit shell configuration wins; checkout values override workspace values.
  for(const [key,value]of Object.entries(values))if(env[key]===undefined)env[key]=value;
  return {loaded_files:loaded};
}
module.exports={loadProjectEnv};
