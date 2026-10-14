/* Mechanical diff: schema.ts column set vs migration SQL column set. */
const fs=require('fs'),path=require('path');
const REPO='/home/user/lastdonor';
const MIG=path.join(REPO,'src/db/migrations');

// ---------- 1. Parse schema.ts ----------
const src=fs.readFileSync(path.join(REPO,'src/db/schema.ts'),'utf8');
const lines=src.split('\n');
const schemaTables={}; // sqlName -> {cols:Map(name->{line,notNull,hasDefault,type}), line}
let cur=null,depth=0;
const tblRe=/^export const (\w+)\s*=\s*pgTable\(\s*$|^export const (\w+)\s*=\s*pgTable\(\s*'([^']+)'/;
for(let i=0;i<lines.length;i++){
  const L=lines[i];
  let m=L.match(/^export const (\w+)\s*=\s*pgTable\(\s*'([^']+)'/);
  if(!m){ const m2=L.match(/^export const (\w+)\s*=\s*pgTable\($/); if(m2){ const nm=(lines[i+1]||'').match(/'([^']+)'/); if(nm) m=[null,m2[1],nm[1]]; } }
  if(m){ cur=m[2]; schemaTables[cur]={cols:new Map(),line:i+1,js:m[1]}; continue; }
  if(!cur) continue;
  if(/^export const /.test(L)){ cur=null; continue; }
  const c=L.match(/^\s{2,}(\w+):\s*(\w+)\(\s*'([^']+)'/);
  if(c){
    // accumulate the full (possibly multi-line) column definition
    let full=L, k=i;
    while(!/,\s*$/.test(full.trim()) && k+1<lines.length && !/^\s{2,}\w+:\s*\w+\(/.test(lines[k+1]) && !/^\s*\}/.test(lines[k+1]) && !/^\s*\(table\)/.test(lines[k+1])){
      k++; full+=' '+lines[k];
    }
    i=k;
    schemaTables[cur].cols.set(c[3],{line:i+1,js:c[1],type:c[2],full:full.replace(/\s+/g,' ').trim(),
      notNull:/\.notNull\(\)/.test(full)||/\.primaryKey\(\)/.test(full),
      hasDefault:/\.default/.test(full)});
  }
}

// ---------- 2. Parse migration SQL ----------
const files=fs.readdirSync(MIG).filter(f=>f.endsWith('.sql')).sort();
const migTables={}; // sqlName -> Map(col -> {file, notNull, hasDefault, type})
const events=[];
const enumsCreated={}; const enumAdds={};
function norm(s){return s.replace(/"/g,'').trim();}
for(const f of files){
  const txt=fs.readFileSync(path.join(MIG,f),'utf8');
  // strip -- comments
  const clean=txt.split('\n').map(l=>l.replace(/--.*$/,'')).join('\n');
  // CREATE TABLE
  const ctRe=/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+("?[\w."]+"?)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  let m;
  while((m=ctRe.exec(clean))){
    const t=norm(m[1]).replace(/^public\./,'');
    migTables[t]=migTables[t]||new Map();
    const body=m[2];
    // split top-level commas
    let d=0,buf='',parts=[];
    for(const ch of body){ if(ch==='(')d++; if(ch===')')d--; if(ch===','&&d===0){parts.push(buf);buf='';} else buf+=ch; }
    parts.push(buf);
    for(const p of parts){
      const s=p.trim(); if(!s) continue;
      if(/^(PRIMARY KEY|CONSTRAINT|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(s)) continue;
      const cm=s.match(/^"?([a-zA-Z_][\w]*)"?\s+(.+)$/s);
      if(!cm) continue;
      migTables[t].set(cm[1],{file:f,def:cm[2].replace(/\s+/g,' ').trim(),
        notNull:/NOT NULL/i.test(cm[2]),hasDefault:/DEFAULT/i.test(cm[2])});
    }
    events.push([f,'CREATE TABLE',t]);
  }
  // ALTER TABLE ... ADD COLUMN  (handle multi-column single statement)
  const atRe=/ALTER TABLE\s+("?[\w."]+"?)\s*([\s\S]*?);/gi;
  while((m=atRe.exec(clean))){
    const t=norm(m[1]).replace(/^public\./,'');
    const rest=m[2];
    const addRe=/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?([a-zA-Z_][\w]*)"?\s+([^,;]+)/gi;
    let a;
    while((a=addRe.exec(rest))){
      migTables[t]=migTables[t]||new Map();
      migTables[t].set(a[1],{file:f,def:a[2].replace(/\s+/g,' ').trim(),
        notNull:/NOT NULL/i.test(a[2]),hasDefault:/DEFAULT/i.test(a[2])});
      events.push([f,'ADD COLUMN',t+'.'+a[1]]);
    }
    const dropRe=/DROP COLUMN(?:\s+IF EXISTS)?\s+"?([a-zA-Z_][\w]*)"?/gi;
    while((a=dropRe.exec(rest))){
      if(migTables[t]) migTables[t].delete(a[1]);
      events.push([f,'DROP COLUMN',t+'.'+a[1]]);
    }
    const renRe=/RENAME COLUMN\s+"?([a-zA-Z_][\w]*)"?\s+TO\s+"?([a-zA-Z_][\w]*)"?/gi;
    while((a=renRe.exec(rest))){
      if(migTables[t]&&migTables[t].has(a[1])){const v=migTables[t].get(a[1]);migTables[t].delete(a[1]);migTables[t].set(a[2],{...v,file:f+' (rename)'});}
      events.push([f,'RENAME COLUMN',t+'.'+a[1]+'->'+a[2]]);
    }
    const altRe=/ALTER COLUMN\s+"?([a-zA-Z_][\w]*)"?\s+(SET|DROP)\s+(NOT NULL|DEFAULT[^,;]*)/gi;
    while((a=altRe.exec(rest))){
      const c=migTables[t]&&migTables[t].get(a[1]);
      if(c){ if(/NOT NULL/i.test(a[3])) c.notNull=(a[2].toUpperCase()==='SET');
             else c.hasDefault=(a[2].toUpperCase()==='SET'); }
      events.push([f,'ALTER COLUMN',t+'.'+a[1]+' '+a[2]+' '+a[3]]);
    }
  }
  // DROP TABLE
  const dtRe=/DROP TABLE(?:\s+IF EXISTS)?\s+("?[\w."]+"?)/gi;
  while((m=dtRe.exec(clean))){const t=norm(m[1]).replace(/^public\./,'');delete migTables[t];events.push([f,'DROP TABLE',t]);}
  // enums
  const ceRe=/CREATE TYPE\s+("?[\w."]+"?)\s+AS ENUM\s*\(([\s\S]*?)\)\s*;/gi;
  while((m=ceRe.exec(clean))){
    const t=norm(m[1]).replace(/^public\./,'');
    enumsCreated[t]={file:f,vals:[...m[2].matchAll(/'([^']*)'/g)].map(x=>x[1])};
  }
  const aeRe=/ALTER TYPE\s+("?[\w."]+"?)\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/gi;
  while((m=aeRe.exec(clean))){
    const t=norm(m[1]).replace(/^public\./,'');
    (enumAdds[t]=enumAdds[t]||[]).push({file:f,val:m[2]});
  }
  const deRe=/DROP TYPE(?:\s+IF EXISTS)?\s+("?[\w."]+"?)/gi;
  while((m=deRe.exec(clean))){const t=norm(m[1]).replace(/^public\./,'');if(enumsCreated[t])enumsCreated[t].dropped=f;}
}

// ---------- 3. Report ----------
const out=[];
const sTabs=Object.keys(schemaTables).sort(), mTabs=Object.keys(migTables).sort();
out.push('### TABLES');
out.push('schema.ts tables: '+sTabs.length+'  migration tables: '+mTabs.length);
out.push('IN SCHEMA, NOT CREATED BY ANY MIGRATION: '+JSON.stringify(sTabs.filter(t=>!migTables[t])));
out.push('IN MIGRATIONS, NOT IN SCHEMA: '+JSON.stringify(mTabs.filter(t=>!schemaTables[t])));
out.push('');
out.push('### COLUMN DIFF (per table)');
let totMissing=0,totExtra=0,totMis=0;
for(const t of sTabs){
  const mc=migTables[t]; if(!mc) continue;
  const sc=schemaTables[t].cols;
  const missing=[...sc.keys()].filter(c=>!mc.has(c));
  const extra=[...mc.keys()].filter(c=>!sc.has(c));
  const mismatch=[];
  for(const [c,v] of sc){ const m2=mc.get(c); if(!m2) continue;
    const sNN=v.notNull, mNN=m2.notNull;
    const sD=v.hasDefault, mD=m2.hasDefault;
    if(sNN!==mNN) mismatch.push(`${c}: NOT NULL schema=${sNN} mig=${mNN} [${m2.file}]`);
    else if(sD!==mD) mismatch.push(`${c}: DEFAULT schema=${sD} mig=${mD} [${m2.file}]`);
  }
  if(missing.length||extra.length||mismatch.length){
    out.push(`-- ${t} (schema.ts:${schemaTables[t].line})`);
    for(const c of missing){out.push(`   MISSING_IN_MIGRATIONS: ${c}  (schema.ts:${sc.get(c).line})`);totMissing++;}
    for(const c of extra){out.push(`   ONLY_IN_MIGRATIONS: ${c}  [${mc.get(c).file}]`);totExtra++;}
    for(const x of mismatch){out.push(`   MISMATCH: ${x}`);totMis++;}
  }
}
out.push('');
out.push(`TOTALS: missing_in_migrations=${totMissing} only_in_migrations=${totExtra} mismatches=${totMis}`);
out.push('');
out.push('### ENUMS');
for(const e of Object.keys(enumsCreated).sort()){
  const v=enumsCreated[e];
  const adds=(enumAdds[e]||[]).map(a=>a.val);
  out.push(`${e}: created ${v.file}${v.dropped?' DROPPED '+v.dropped:''} base=[${v.vals.join(',')}] adds=[${adds.join(',')}]`);
}
for(const e of Object.keys(enumAdds).sort()) if(!enumsCreated[e]) out.push(`${e}: *** ADD VALUE with NO CREATE TYPE *** ${JSON.stringify(enumAdds[e])}`);
out.push('');
out.push('### JOURNAL');
const j=JSON.parse(fs.readFileSync(path.join(MIG,'meta/_journal.json'),'utf8'));
const jt=new Set(j.entries.map(e=>e.tag));
out.push('journal entries: '+j.entries.length+'  sql files: '+files.length);
out.push('SQL FILES NOT IN JOURNAL (drizzle-kit migrate will NEVER apply these):');
for(const f of files){const tag=f.replace(/\.sql$/,'');if(!jt.has(tag))out.push('   '+f);}
out.push('JOURNAL TAGS WITH NO SQL FILE:');
for(const t of jt) if(!files.includes(t+'.sql')) out.push('   '+t);
const snaps=fs.readdirSync(path.join(MIG,'meta')).filter(f=>f.endsWith('_snapshot.json'));
out.push('snapshots present: '+snaps.length+' -> '+snaps.sort().join(', '));

fs.writeFileSync('/tmp/claude-0/-home-user-lastdonor/ee7a750e-88d2-5e36-86ee-c1bd1a101a74/scratchpad/repro/diff-out.txt',out.join('\n'));
console.log(out.join('\n'));
