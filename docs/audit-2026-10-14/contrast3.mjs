const hex = h => { h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = h => { const [r,g,b]=hex(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const ratio = (a,b) => { const l1=L(a), l2=L(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
const v = r => r>=4.5?'PASS':(r>=3?'AA large/UI only':'FAIL');
// Tailwind 4 sRGB fallbacks, from compiled CSS lines 323-325
const FOOT='#0F1A19';
for (const [n,c] of [['gray-300','#d1d5dc'],['gray-400','#99a1af'],['gray-500','#6a7282']]) {
  const r = ratio(c, FOOT);
  console.log(`text-${n} ${c} on footer ${FOOT}: ${r.toFixed(2)} ${v(r)}`);
}
