// Feeds payloads through the REPO's real sanitizeHtml config.
import { sanitizeHtml } from '/home/user/lastdonor/src/lib/utils/sanitize.ts';

const cases: [string, string][] = [
  ['script tag',        '<script>alert(1)</script>'],
  ['img onerror',       '<img src=x onerror=alert(1)>'],
  ['href javascript:',  '<a href="javascript:alert(1)">x</a>'],
  ['href JaVaScRiPt:',  '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['href &NewLine js',  '<a href="java&#115;cript:alert(1)">x</a>'],
  ['style attr',        '<p style="background:url(javascript:alert(1))">x</p>'],
  ['svg onload',        '<svg onload=alert(1)></svg>'],
  ['iframe',            '<iframe src="https://evil.com"></iframe>'],
  ['img data: uri',     '<img src="data:image/svg+xml;base64,PHN2Zy8+">'],
  ['a data: uri',       '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['protocol-relative', '<a href="//evil.com">x</a>'],
  ['img protocol-rel',  '<img src="//evil.com/x.png">'],
  ['target no rel',     '<a href="https://evil.com" target="_blank">x</a>'],
  ['form/input',        '<form action="https://evil.com"><input name="p"></form>'],
  ['DOM clobber id',    '<span id="attributes"></span><img id="currentScript">'],
  ['mustache/meta',     '<meta http-equiv="refresh" content="0;url=https://evil.com">'],
  ['srcset',            '<img src="https://ok/x.png" srcset="x 1x">'],
  ['onclick on span',   '<span onclick="alert(1)">x</span>'],
];

let risky = 0;
for (const [name, payload] of cases) {
  const out = sanitizeHtml(payload);
  const bad = /javascript:|on[a-z]+\s*=|<script|<svg|<iframe|<form|style=|data:text\/html/i.test(out);
  if (bad) risky++;
  console.log(`${bad ? 'RISK ' : 'ok   '} ${name.padEnd(18)} -> ${JSON.stringify(out)}`);
}
console.log(`\nrisky outputs: ${risky}/${cases.length}`);
