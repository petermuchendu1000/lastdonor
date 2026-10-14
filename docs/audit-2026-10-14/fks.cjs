const fs=require('fs'),path=require('path');
const MIG='/home/user/lastdonor/src/db/migrations';
const files=fs.readdirSync(MIG).filter(f=>f.endsWith('.sql')).sort();
const dropped=new Set();
const fks=[];
for(const f of files){
  const raw=fs.readFileSync(path.join(MIG,f),'utf8');
  const s=raw.split('\n').map(l=>l.replace(/--.*$/,'')).join('\n');
  for(const m of s.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+"?([\w.]+)"?/gi))dropped.add(m[1].replace(/"/g,'').replace(/^public\./,''));
  // ALTER TABLE x ADD CONSTRAINT n FOREIGN KEY (c) REFERENCES t(c) [ON DELETE a] [ON UPDATE a]
  for(const m of s.matchAll(/ALTER TABLE\s+"?([\w."]+)"?\s+ADD CONSTRAINT\s+"?([\w]+)"?\s+FOREIGN KEY\s*\(\s*"?([\w]+)"?\s*\)\s*REFERENCES\s+"?(?:public"?\.?"?)?([\w]+)"?\s*\(\s*"?([\w]+)"?\s*\)([^;]*)/gi)){
    const opt=m[6]||'';
    fks.push({file:f,table:m[1].replace(/"/g,'').replace(/^public\./,''),name:m[2],col:m[3],ref:m[4],refcol:m[5],
      onDelete:(opt.match(/ON DELETE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase(),
      onUpdate:(opt.match(/ON UPDATE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase()});
  }
  // inline REFERENCES inside CREATE TABLE / ADD COLUMN
  for(const m of s.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([\w.]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)){
    const t=m[1].replace(/"/g,'').replace(/^public\./,'');
    for(const r of m[2].matchAll(/"?([\w]+)"?[^,\n]*?\bREFERENCES\s+"?([\w]+)"?\s*\(\s*"?([\w]+)"?\s*\)([^,\n]*)/gi)){
      const opt=r[4]||'';
      fks.push({file:f,table:t,name:'(inline)',col:r[1],ref:r[2],refcol:r[3],
        onDelete:(opt.match(/ON DELETE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase(),
        onUpdate:(opt.match(/ON UPDATE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase()});
    }
  }
  for(const m of s.matchAll(/ALTER TABLE\s+"?([\w.]+)"?\s*([\s\S]*?);/gi)){
    const t=m[1].replace(/"/g,'').replace(/^public\./,'');
    for(const r of m[2].matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?([\w]+)"?[^,;]*?\bREFERENCES\s+"?([\w]+)"?\s*\(\s*"?([\w]+)"?\s*\)([^,;]*)/gi)){
      const opt=r[4]||'';
      fks.push({file:f,table:t,name:'(inline-addcol)',col:r[1],ref:r[2],refcol:r[3],
        onDelete:(opt.match(/ON DELETE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase(),
        onUpdate:(opt.match(/ON UPDATE\s+(cascade|set null|set default|restrict|no action)/i)||[,'no action'])[1].toLowerCase()});
    }
  }
}
const live=fks.filter(f=>!dropped.has(f.table)&&!dropped.has(f.ref));
// dedupe by table.col->ref
const seen=new Map();
for(const f of live){const k=f.table+'.'+f.col+'->'+f.ref;if(!seen.has(k))seen.set(k,f);}
const L=[...seen.values()];
console.log('FOREIGN KEYS (live tables only):',L.length,' (raw parsed '+fks.length+', dropped tables: '+[...dropped].join(',')+')');
console.log('');
const byRef={};
for(const f of L){(byRef[f.ref]=byRef[f.ref]||[]).push(f);}
for(const ref of Object.keys(byRef).sort()){
  console.log(`### REFERENCES ${ref}  (${byRef[ref].length} FKs)`);
  for(const f of byRef[ref].sort((a,b)=>a.table.localeCompare(b.table)))
    console.log(`   ${f.table}.${f.col}  ON DELETE ${f.onDelete.toUpperCase()}  ON UPDATE ${f.onUpdate.toUpperCase()}   [${f.file}]`);
  console.log('');
}
console.log('=== BLOCKING (would raise 23503 on parent delete) ===');
for(const ref of Object.keys(byRef).sort()){
  const b=byRef[ref].filter(f=>f.onDelete==='no action'||f.onDelete==='restrict');
  if(b.length) console.log(`delete from ${ref} blocked by: `+b.map(f=>f.table+'.'+f.col).join(', '));
}
