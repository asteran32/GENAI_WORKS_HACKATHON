'use strict';
// Intentionally small SQL subset: one SELECT, no CTEs/subqueries/file readers/UDFs.
// The model sees these restrictions and can retry with a simpler query.
function validateSQL(sql, catalog) {
  if (typeof sql !== 'string' || sql.length > 8000) throw new Error('SQL은 8,000자 이하 문자열이어야 합니다.');
  sql = sql.trim().replace(/;$/, '');
  const tokens = [], re = /\s+|'(?:[^'\\]|'')*'|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[(),.*+\/%=<>!\-]/gy;
  let position = 0;
  while (position < sql.length) {
    re.lastIndex = position; const match = re.exec(sql);
    if (!match || /^(--|\/\*)/.test(sql.slice(position))) throw new Error('주석·여러 SQL 문·인용 식별자·특수 문법은 지원하지 않습니다.');
    if (match[0].trim()) tokens.push(match[0]); position = re.lastIndex;
  }
  const words = tokens.map(t=>t.startsWith("'")?'':t.toUpperCase());
  if (words[0]!=='SELECT' || words.filter(t=>t==='SELECT').length!==1) throw new Error('단일 SELECT만 허용됩니다. WITH·서브쿼리는 지원하지 않습니다.');
  const forbidden = new Set('INSERT UPDATE DELETE DROP ALTER CREATE REPLACE MERGE CALL EXEC EXECUTE GRANT REVOKE COPY LOAD INTO OUTFILE DUMPFILE UNION INTERSECT EXCEPT SET USE SHOW DESCRIBE EXPLAIN CACHE UNCACHE REFRESH LATERAL CROSS WINDOW OVER'.split(' '));
  if (words.some(w=>forbidden.has(w))) throw new Error('읽기 전용 제한에 맞지 않는 SQL입니다.');
  const functions = new Set('COUNT MIN MAX SUM AVG ROUND ABS COALESCE NULLIF CAST LOWER UPPER LENGTH SUBSTRING SUBSTR IN'.split(' '));
  for (let i=0;i<tokens.length-1;i++) {
    if (/^[A-Za-z_]/.test(tokens[i]) && tokens[i+1]==='(' && !functions.has(words[i]) && !['AND','OR','NOT','ON','WHERE','HAVING'].includes(words[i])) throw new Error(`허용되지 않은 함수: ${tokens[i]}`);
  }
  const referenced = [];
  let depth = 0;
  for (let i=0;i<tokens.length;i++) {
    if(tokens[i]==='(') depth++;
    if(tokens[i]===')' && --depth<0) throw new Error('괄호가 맞지 않습니다.');
    if (!['FROM','JOIN'].includes(words[i])) continue;
    const full = tokens[i+1]+tokens[i+2]+tokens[i+3];
    if(tokens[i+2]!=='.' || !catalog.tables.some(t=>t.qualified_name===full)) throw new Error('등록된 카탈로그의 database.table만 조회할 수 있습니다.');
    referenced.push(full);
    let next = i+4;
    if(words[next]==='AS') next+=2;
    else if (/^[A-Za-z_]/.test(tokens[next]||'') && !['WHERE','JOIN','LEFT','RIGHT','INNER','FULL','ON','GROUP','ORDER','LIMIT','HAVING'].includes(words[next])) next++;
    if(tokens[next]===',' || tokens[next]==='.' || tokens[next]==='(') throw new Error('쉼표 조인이나 파일·함수 소스는 지원하지 않습니다.');
  }
  if(depth!==0 || referenced.length<1 || referenced.length>3) throw new Error('카탈로그 테이블 1~3개의 SELECT를 사용하세요.');
  const limit = words.indexOf('LIMIT');
  if(limit>=0) {
    if(limit!==tokens.length-2 || !/^\d+$/.test(tokens[limit+1]) || +tokens[limit+1]<1 || +tokens[limit+1]>100) throw new Error('LIMIT은 1~100 범위의 정수여야 합니다.');
  } else sql += ' LIMIT 100';
  return {sql, tables:[...new Set(referenced)]};
}
module.exports = { validateSQL };
