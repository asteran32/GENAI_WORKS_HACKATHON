'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validateSQL}=require('./agent-sql');
const COLUMNS=['site_id','instant_utc','local_date','hour','predicted_passages','lower90','upper90','evidence_type','model_id','training_cutoff','forecast_horizon_days'];
function createAgentForecast({root,catalog,query,emit,signal}) {
  let cached;
  return {async get(date,trace={}) {
    if(date!==catalog.analysis_date)throw new Error('카탈로그 분석일과 예측 요청 날짜가 다릅니다.');
    if(cached){emit('forecast_cache_hit',{sql_event:cached.sql_event,source:'zetaris-result-cache',...trace});return cached;}
    const table=catalog.tables.find(t=>t.name==='pedestrian_forecasts');
    if(!table)throw new Error('Zetaris 예측 테이블이 없습니다. python3 scripts/register_zetaris.py --date 2025-12-19 --sync를 실행하세요.');
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!/^ped-[a-f0-9]{16}$/.test(table.dataset_version))throw new Error('예측 날짜 또는 모델 버전이 올바르지 않습니다.');
    const sql=validateSQL(`SELECT ${COLUMNS.join(', ')} FROM ${table.qualified_name} WHERE local_date = '${date}' ORDER BY site_id, hour LIMIT 100`,catalog).sql;
    const request=emit('sql_request',{sql,tables:[table.qualified_name],purpose:'pedestrian_forecast',...trace});
    const result=await query(sql,catalog,signal);
    if(!Array.isArray(result?.columns)||JSON.stringify(result.columns)!==JSON.stringify(COLUMNS)||!Array.isArray(result.data)||result.data.length!==96)throw new Error('Zetaris 예측 결과는 4개 지점 × 24시간의 96행이어야 합니다.');
    const seen=new Set();
    const rows=result.data.map(values=>{
      if(!Array.isArray(values)||values.length!==COLUMNS.length)throw new Error('Zetaris 예측 행 형식이 올바르지 않습니다.');
      const row=Object.fromEntries(COLUMNS.map((name,i)=>[name,values[i]]));
      for(const field of ['hour','predicted_passages','lower90','upper90','forecast_horizon_days']){
        if(row[field]===null||String(row[field]).trim()===''||!Number.isFinite(Number(row[field])))throw new Error('예측 수치가 누락되었거나 유효하지 않습니다.');
        row[field]=Number(row[field]);
      }
      const key=`${row.site_id}:${row.hour}`;
      if(!['A001','A002','A003','A004'].includes(row.site_id)||!Number.isInteger(row.hour)||row.hour<0||row.hour>23||seen.has(key)||row.evidence_type!=='forecast'||row.local_date!==date||row.model_id!==table.dataset_version||row.predicted_passages<0||row.lower90<0||row.upper90<row.lower90)throw new Error('예측 출처·기간·지점 또는 구간 검증에 실패했습니다.');
      seen.add(key);return row;
    });
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'processed/pedestrian-forecasts',table.dataset_version,'manifest.json'),'utf8'));
    if(manifest.model_id!==table.dataset_version||manifest.date!==date||manifest.evidence_type!=='forecast')throw new Error('예측 검증 메타데이터 버전이 일치하지 않습니다.');
    cached={ready:true,date,read_source:'zetaris',sql,sql_event:request.seq,manifest,metadata_source:'local-model-manifest',rows};
    emit('forecast_read',{source:'zetaris',table:table.qualified_name,rows:rows.length,columns:result.columns,data:result.data,sql_event:request.seq,model_id:table.dataset_version,...trace});
    return cached;
  }};
}
module.exports={createAgentForecast,COLUMNS};
