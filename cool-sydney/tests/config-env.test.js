'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadProjectEnv}=require('../config-env');
test('published checkout uses workspace credentials with checkout and shell precedence',t=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'cool-env-'));
  t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
  const root=path.join(workspace,'.publish','project');fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(workspace,'.env'),'GEMINI_API_KEY=workspace-test-key\nMODEL_PROVIDER=gemini\n');
  const env={};const result=loadProjectEnv(root,env);
  assert.equal(env.GEMINI_API_KEY,'workspace-test-key');assert.equal(env.MODEL_PROVIDER,'gemini');
  assert.doesNotMatch(JSON.stringify(result),/workspace-test-key/);
  fs.writeFileSync(path.join(root,'.env'),'GEMINI_API_KEY=checkout-test-key\n');
  const checkout={};loadProjectEnv(root,checkout);assert.equal(checkout.GEMINI_API_KEY,'checkout-test-key');
  const shell={GEMINI_API_KEY:'shell-test-key'};loadProjectEnv(root,shell);assert.equal(shell.GEMINI_API_KEY,'shell-test-key');
  const other=path.join(workspace,'other');fs.mkdirSync(other);const unrelated={};loadProjectEnv(other,unrelated);assert.deepEqual(unrelated,{});
});
