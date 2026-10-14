const hex = h => { h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = h => { const [r,g,b]=hex(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const ratio = (a,b) => { const l1=L(a), l2=L(b); const hi=Math.max(l1,l2), lo=Math.min(l1,l2); return (hi+0.05)/(lo+0.05); };
// blend fg over bg with alpha
const over = (fg,bg,a) => { const f=hex(fg), b=hex(bg); return '#'+f.map((c,i)=>Math.round(c*a+b[i]*(1-a)).toString(16).padStart(2,'0')).join(''); };

const light = { background:'#FFFFFF', 'surface-teal':'#ECF4F2','surface-amber':'#FDF3E4','surface-sage':'#EEF4EE',
  foreground:'#1A1A1A', card:'#FFFFFF','card-foreground':'#1A1A1A', popover:'#FFFFFF','popover-foreground':'#1A1A1A',
  primary:'#0F766E','primary-foreground':'#FFFFFF', secondary:'#F5F5F5','secondary-foreground':'#1A1A1A',
  muted:'#F5F5F5','muted-foreground':'#64707D', accent:'#D97706','accent-foreground':'#FFFFFF',
  destructive:'#8B2332', border:'#E5E7EB', input:'#E5E7EB', ring:'#0F766E',
  'chart-1':'#0F766E','chart-2':'#D97706','chart-3':'#2D6A4F','chart-4':'#8B2332','chart-5':'#6B7280' };
const dark = { background:'#0F1A19','surface-teal':'#152E2A','surface-amber':'#2A2218','surface-sage':'#17241E',
  foreground:'#F1F5F9', card:'#1A2E2B','card-foreground':'#F1F5F9', popover:'#1A2E2B','popover-foreground':'#F1F5F9',
  primary:'#14B8A6','primary-foreground':'#0F1A19', secondary:'#132322','secondary-foreground':'#F1F5F9',
  muted:'#1A2E2B','muted-foreground':'#94A3B8', accent:'#FBBF24','accent-foreground':'#1A1A1A',
  destructive:'#EF4444', border:'#2D4A47', input:'#2D4A47', ring:'#14B8A6',
  'chart-1':'#14B8A6','chart-2':'#FBBF24','chart-3':'#34D399','chart-4':'#F87171','chart-5':'#94A3B8' };

const pairs = [
  ['foreground','background'],['muted-foreground','background'],['muted-foreground','card'],
  ['muted-foreground','muted'],['muted-foreground','secondary'],
  ['primary','background'],['primary','card'],['primary','muted'],
  ['primary-foreground','primary'],['accent-foreground','accent'],
  ['accent','background'],['accent','card'],
  ['destructive','background'],['destructive','card'],['destructive','muted'],
  ['foreground','surface-teal'],['muted-foreground','surface-teal'],
  ['foreground','surface-amber'],['muted-foreground','surface-amber'],
  ['foreground','surface-sage'],['muted-foreground','surface-sage'],
  ['border','background'],['border','card'],['ring','background'],
  ['chart-2','background'],['chart-5','background'],['chart-3','background'],
];
const verdict = r => r>=4.5?'AA-text PASS':(r>=3?'AA-large/UI only':'FAIL');
for (const [name, T] of [['LIGHT',light],['DARK',dark]]) {
  console.log(`\n==== ${name} ====`);
  for (const [f,b] of pairs) {
    const r = ratio(T[f],T[b]);
    console.log(`${(f+' on '+b).padEnd(38)} ${T[f]} / ${T[b]}  ${r.toFixed(2).padStart(6)}  ${verdict(r)}`);
  }
}
// brand literals used in copy
console.log('\n==== brand literals ====');
const brand = {'brand-teal':'#0F766E','brand-amber':'#D97706','brand-red':'#8B2332','brand-green':'#2D6A4F','brand-live':'#10B981'};
for (const [k,v] of Object.entries(brand)) {
  console.log(`${k} ${v} on white  ${ratio(v,'#FFFFFF').toFixed(2)}  ${verdict(ratio(v,'#FFFFFF'))}   | white on ${k}  ${ratio('#FFFFFF',v).toFixed(2)}  ${verdict(ratio('#FFFFFF',v))}`);
}
console.log('\n==== alpha-composited cases found in code ====');
console.log('primary/10 bg on white, foreground text:', ratio('#1A1A1A', over('#0F766E','#FFFFFF',0.10)).toFixed(2));
console.log('text-primary-foreground/70 on primary (light):', ratio(over('#FFFFFF','#0F766E',0.70),'#0F766E').toFixed(2));
console.log('text-primary-foreground/70 on primary (dark):', ratio(over('#0F1A19','#14B8A6',0.70),'#14B8A6').toFixed(2));
console.log('muted/30 bg light (#F5F5F5 @30% on white):', over('#F5F5F5','#FFFFFF',0.30));
console.log('muted-foreground on muted/30 light:', ratio('#64707D', over('#F5F5F5','#FFFFFF',0.30)).toFixed(2));
console.log('white on brand-live #10B981:', ratio('#FFFFFF','#10B981').toFixed(2));
console.log('white on #25D366 (WhatsApp btn):', ratio('#FFFFFF','#25D366').toFixed(2));
console.log('white on #1877F2 (Facebook btn):', ratio('#FFFFFF','#1877F2').toFixed(2));
console.log('white on brand-amber #D97706 (primary CTA):', ratio('#FFFFFF','#D97706').toFixed(2));
