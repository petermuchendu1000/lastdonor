const hex=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
const L=h=>{const[r,g,b]=hex(h);return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);};
const R=(a,b)=>{const l1=L(a),l2=L(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
const over=(f,b,a)=>{const F=hex(f),B=hex(b);return '#'+F.map((c,i)=>Math.round(c*a+B[i]*(1-a)).toString(16).padStart(2,'0')).join('');};
const v=r=>r>=4.5?'PASS':(r>=3?'AA large/UI only':'FAIL');
const P='#0F766E', PD='#14B8A6';
const rows=[
 ['ImpactCounter text-white/90 label (14px) on bg-primary light', over('#FFFFFF',P,0.90), P],
 ['ImpactCounter text-white/80 (16px) on bg-primary light', over('#FFFFFF',P,0.80), P],
 ['ImpactCounter text-white/70 sublabel (12px) on bg-primary light', over('#FFFFFF',P,0.70), P],
 ['ImpactCounter text-white/70 (12px) on bg-primary DARK #14B8A6', over('#FFFFFF',PD,0.70), PD],
 ['ImpactCounter text-white/80 (16px) on bg-primary DARK', over('#FFFFFF',PD,0.80), PD],
 ['ImpactCounter text-white/90 (14px) on bg-primary DARK', over('#FFFFFF',PD,0.90), PD],
 ['ImpactCounter white h2 on bg-primary DARK #14B8A6', '#FFFFFF', PD],
 ['DonationForm hint text-primary-foreground/70 10px on primary light', over('#FFFFFF',P,0.70), P],
];
for (const [l,f,b] of rows) console.log(`${l.padEnd(62)} ${f}/${b} ${R(f,b).toFixed(2).padStart(6)} ${v(R(f,b))}`);
