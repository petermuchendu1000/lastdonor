const hex = h => { h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = h => { const [r,g,b]=hex(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const ratio = (a,b) => { const l1=L(a), l2=L(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
const over = (fg,bg,a) => { const f=hex(fg), b=hex(bg); return '#'+f.map((c,i)=>Math.round(c*a+b[i]*(1-a)).toString(16).padStart(2,'0')).join(''); };
const v = r => r>=4.5?'PASS(AA text)':(r>=3?'AA large/UI only':'FAIL');
const FOOT='#0F1A19';
const cases = [
  ['footer text-gray-300 #D1D5DB on #0F1A19','#D1D5DB',FOOT],
  ['footer text-gray-400 #9CA3AF on #0F1A19 (nav links, 14px)','#9CA3AF',FOOT],
  ['footer text-gray-500 #6B7280 on #0F1A19 (12px legal/copyright)','#6B7280',FOOT],
  ['footer text-[#14B8A6] on #0F1A19','#14B8A6',FOOT],
  ['footer text-[#FBBF24] on #0F1A19','#FBBF24',FOOT],
  ['footer #14B8A6 on bg-[#14B8A6]/15 over #0F1A19','#14B8A6',over('#14B8A6',FOOT,0.15)],
  ['white on bg-red-600 #DC2626','#FFFFFF','#DC2626'],
  ['white/60 dots on black/50 over img',over('#FFFFFF','#808080',0.6),over('#000000','#808080',0.5)],
];
for (const [label,f,b] of cases) console.log(`${label.padEnd(60)} ${f} / ${b}  ${ratio(f,b).toFixed(2).padStart(6)}  ${v(ratio(f,b))}`);
