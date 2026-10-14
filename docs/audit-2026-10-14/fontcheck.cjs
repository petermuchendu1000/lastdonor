const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 120000 });
  const r = await p.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el).fontFamily : 'ELEMENT_NOT_FOUND';
    const h1 = document.querySelector('h1');
    const disp = document.querySelector('.font-display');
    const mono = document.querySelector('.font-mono');
    const rootVars = ['--font-display','--font-sans','--font-mono','--font-body','--font-dm-sans','--font-dm-serif-display','--font-dm-mono']
      .reduce((a,v)=>{a[v]=getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'(UNSET)';return a;},{});
    // any element rendered invisible in the live DOM?
    const hidden = [...document.querySelectorAll('a,button')]
      .filter(e => parseFloat(getComputedStyle(e).opacity) < 0.05)
      .map(e => (e.textContent||'').trim().slice(0,40));
    return {
      bodyFont: cs(document.body),
      h1Font: cs(h1), h1Text: (h1&&h1.textContent||'').trim().slice(0,50),
      displayFont: cs(disp), monoFont: cs(mono),
      rootVars, hiddenCTAs: hidden,
      proseRuleCount: [...document.styleSheets].reduce((n,s)=>{try{return n+[...s.cssRules].filter(r=>r.selectorText&&/\.prose(?![a-z-])/.test(r.selectorText)).length}catch{return n}},0),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
