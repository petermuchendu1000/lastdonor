/* What does `drizzle-kit migrate` (journal-driven) actually create vs schema.ts? */
const fs=require('fs'),path=require('path');
const MIG='/home/user/lastdonor/src/db/migrations';
const j=JSON.parse(fs.readFileSync(path.join(MIG,'meta/_journal.json'),'utf8'));
const applied=j.entries.map(e=>e.tag+'.sql');
const all=fs.readdirSync(MIG).filter(f=>f.endsWith('.sql')).sort();
function tablesIn(files){
  const t=new Set();
  for(const f of files){
    const s=fs.readFileSync(path.join(MIG,f),'utf8').split('\n').map(l=>l.replace(/--.*$/,'')).join('\n');
    for(const m of s.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([\w.]+)"?/gi)) t.add(m[1].replace(/^public\./,'').replace(/"/g,''));
    for(const m of s.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+"?([\w.]+)"?/gi)) t.delete(m[1].replace(/^public\./,'').replace(/"/g,''));
  }
  return t;
}
const appliedT=tablesIn(applied), allT=tablesIn(all);
// schema.ts tables
const src=fs.readFileSync('/home/user/lastdonor/src/db/schema.ts','utf8');
const schemaT=[...src.matchAll(/pgTable\(\s*'([^']+)'/g)].map(m=>m[1]).sort();
console.log('journal-applied migrations:',applied.length,'of',all.length,'files');
console.log('tables created by journal-applied migrations:',appliedT.size);
console.log('tables created by ALL migration files:',allT.size);
console.log('tables in schema.ts:',schemaT.length);
console.log('\n*** schema.ts tables that `npm run db:migrate` would NOT create ***');
const gap=schemaT.filter(t=>!appliedT.has(t));
gap.forEach(t=>console.log('   '+t+(allT.has(t)?'   (exists only in an UNJOURNALED migration)':'   (NO migration at all)')));
console.log('\ncount:',gap.length);
// enums
function enumsIn(files){const e=new Set();for(const f of files){const s=fs.readFileSync(path.join(MIG,f),'utf8');for(const m of s.matchAll(/CREATE TYPE\s+"?(?:public\.)?"?([\w]+)"?\s+AS ENUM/gi))e.add(m[1]);for(const m of s.matchAll(/DROP TYPE(?:\s+IF EXISTS)?\s+"?([\w]+)"?/gi))e.delete(m[1]);}return e;}
const schemaE=[...src.matchAll(/pgEnum\(\s*'([^']+)'/g)].map(m=>m[1]).sort();
const appliedE=enumsIn(applied), allE=enumsIn(all);
console.log('\n*** schema.ts pgEnums with NO CREATE TYPE in ANY migration ***');
schemaE.filter(e=>!allE.has(e)).forEach(e=>console.log('   '+e));
console.log('\n*** schema.ts pgEnums not created by journal-applied migrations ***');
schemaE.filter(e=>!appliedE.has(e)).forEach(e=>console.log('   '+e));
