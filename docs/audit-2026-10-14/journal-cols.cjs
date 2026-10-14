const fs=require('fs'),path=require('path');
const MIG='/home/user/lastdonor/src/db/migrations';
const j=JSON.parse(fs.readFileSync(path.join(MIG,'meta/_journal.json'),'utf8'));
const applied=j.entries.map(e=>e.tag+'.sql');
const all=fs.readdirSync(MIG).filter(f=>f.endsWith('.sql')).sort();
function cols(files){
  const T={};
  for(const f of files){
    const s=fs.readFileSync(path.join(MIG,f),'utf8').split('\n').map(l=>l.replace(/--.*$/,'')).join('\n');
    for(const m of s.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([\w.]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)){
      const t=m[1].replace(/^public\./,'').replace(/"/g,'');T[t]=T[t]||new Set();
      let d=0,buf='',parts=[];for(const ch of m[2]){if(ch==='(')d++;if(ch===')')d--;if(ch===','&&d===0){parts.push(buf);buf='';}else buf+=ch;}parts.push(buf);
      for(const p of parts){const s2=p.trim();if(!s2)continue;if(/^(PRIMARY KEY|CONSTRAINT|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(s2))continue;const c=s2.match(/^"?([a-zA-Z_]\w*)"?\s/);if(c)T[t].add(c[1]);}
    }
    for(const m of s.matchAll(/ALTER TABLE\s+"?([\w.]+)"?\s*([\s\S]*?);/gi)){
      const t=m[1].replace(/^public\./,'').replace(/"/g,'');
      for(const a of m[2].matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?([a-zA-Z_]\w*)"?/gi)){T[t]=T[t]||new Set();T[t].add(a[1]);}
      for(const a of m[2].matchAll(/DROP COLUMN(?:\s+IF EXISTS)?\s+"?([a-zA-Z_]\w*)"?/gi)){if(T[t])T[t].delete(a[1]);}
      for(const a of m[2].matchAll(/RENAME COLUMN\s+"?([a-zA-Z_]\w*)"?\s+TO\s+"?([a-zA-Z_]\w*)"?/gi)){if(T[t]&&T[t].delete(a[1]))T[t].add(a[2]);}
    }
    for(const m of s.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+"?([\w.]+)"?/gi))delete T[m[1].replace(/^public\./,'').replace(/"/g,'')];
  }
  return T;
}
const A=cols(applied), F=cols(all);
const src=fs.readFileSync('/home/user/lastdonor/src/db/schema.ts','utf8');
// schema tables+cols
const lines=src.split('\n');const S={};let cur=null;
for(let i=0;i<lines.length;i++){const L=lines[i];
  let m=L.match(/^export const \w+\s*=\s*pgTable\(\s*'([^']+)'/);
  if(!m){const m2=L.match(/^export const \w+\s*=\s*pgTable\($/);if(m2){const nm=(lines[i+1]||'').match(/'([^']+)'/);if(nm)m=[0,nm[1]];}}
  if(m){cur=m[1];S[cur]=new Map();continue;}
  if(!cur)continue; if(/^export const /.test(L)){cur=null;continue;}
  const c=L.match(/^\s{2,}(\w+):\s*\w+\(\s*'([^']+)'/); if(c)S[cur].set(c[2],i+1);
}
console.log('=== Columns in schema.ts that `npm run db:migrate` (journal-driven) would NOT create ===');
let n=0;
for(const t of Object.keys(S).sort()){
  const a=A[t];
  const miss=[...S[t].keys()].filter(c=>!a||!a.has(c));
  if(miss.length){console.log(`-- ${t}${a?'':'  [TABLE ITSELF MISSING]'}`);
    for(const c of miss){const inFull=F[t]&&F[t].has(c);console.log(`     ${c}  (schema.ts:${S[t].get(c)})  ${inFull?'-> only in UNJOURNALED migration':'-> NO migration anywhere'}`);n++;}}
}
console.log('\nTOTAL columns unreachable via npm run db:migrate:',n);
// enums (fixed regex)
function enums(files){const E={};for(const f of files){const s=fs.readFileSync(path.join(MIG,f),'utf8');
  for(const m of s.matchAll(/CREATE TYPE\s+(?:"public"\.)?"?([\w]+)"?\s+AS ENUM\s*\(([\s\S]*?)\)\s*;/gi))E[m[1]]=new Set([...m[2].matchAll(/'([^']*)'/g)].map(x=>x[1]));
  for(const m of s.matchAll(/ALTER TYPE\s+(?:"public"\.)?"?([\w]+)"?\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/gi)){E[m[1]]=E[m[1]]||new Set();E[m[1]].add(m[2]);}
  for(const m of s.matchAll(/DROP TYPE(?:\s+IF EXISTS)?\s+"?([\w]+)"?/gi))delete E[m[1]];}
  return E;}
const EA=enums(applied),EF=enums(all);
const SE={};for(const m of src.matchAll(/pgEnum\(\s*'([^']+)'\s*,\s*\[([\s\S]*?)\]\s*\)/g))SE[m[1]]=[...m[2].matchAll(/'([^']*)'/g)].map(x=>x[1]);
console.log('\n=== ENUM VALUE DRIFT (schema.ts vs ALL migrations) ===');
for(const e of Object.keys(SE).sort()){
  if(!EF[e]){console.log(`${e}: *** NO CREATE TYPE IN ANY MIGRATION *** schema has [${SE[e].join(',')}]`);continue;}
  const miss=SE[e].filter(v=>!EF[e].has(v)); const extra=[...EF[e]].filter(v=>!SE[e].includes(v));
  if(miss.length||extra.length)console.log(`${e}: in_schema_not_in_migrations=[${miss}] in_migrations_not_in_schema=[${extra}]`);
}
console.log('\n=== ENUM VALUES missing if only journal-applied migrations run ===');
for(const e of Object.keys(SE).sort()){ if(!EA[e]){console.log(`${e}: TYPE NOT CREATED`);continue;}
  const miss=SE[e].filter(v=>!EA[e].has(v)); if(miss.length)console.log(`${e}: [${miss.join(',')}]`);}
