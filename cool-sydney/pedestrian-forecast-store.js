'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const exec=promisify(execFile);
function createForecastStore(root,env=process.env) {
  const cache=new Map();
  function pointer(date) {
    if(typeof date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('유효한 예측 날짜를 지정하세요.');
    const f=path.join(root,'processed/pedestrian-forecasts',date+'.json');
    if(!fs.existsSync(f))return null;
    const p=JSON.parse(fs.readFileSync(f,'utf8'));if(!/^ped-[a-f0-9]{16}$/.test(p.model_id))throw new Error('잘못된 예측 버전');return p;
  }
  return {async get(date) {
    const p=pointer(date);if(!p)return {ready:false,date,rows:[],message:'이 날짜의 보행량 예측을 아직 학습·저장하지 않았습니다.'};
    if(cache.has(p.model_id))return cache.get(p.model_id);
    let python=env.COOL_SYDNEY_PYTHON;
    if(!python){let folder=path.resolve(__dirname,'..');while(folder!==path.dirname(folder)){const f=path.join(folder,'.venv/bin/python');if(fs.existsSync(f)){python=f;break;}folder=path.dirname(folder);}}
    if(!python)throw new Error('COOL_SYDNEY_PYTHON에 PyArrow 환경을 지정하세요.');
    const result=await exec(python,[path.join(__dirname,'../scripts/read_pedestrian_forecast.py'),root,date],{timeout:30000,maxBuffer:1024*1024});
    const data=JSON.parse(result.stdout);cache.set(p.model_id,data);return data;
  }};
}
module.exports={createForecastStore};
