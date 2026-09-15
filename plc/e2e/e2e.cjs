/*
 ラダー→ST シミュレータの E2E テスト（実ブラウザで実際にクリックして検証）
 実行方法:
   cd plc/e2e && npm init -y && npm i playwright && node e2e.cjs ../ladder-to-st-simulator.html
 Playwright 同梱の Chromium を使う場合は下の EXE を空文字にして executablePath を外してください。
*/
/* End-to-end test of the ladder→ST simulator in a real Chromium, driven by real clicks. */
const { chromium } = require('playwright');
const path = require('path');
const target = process.argv[2];
const url = 'file://' + path.resolve(target);
let fails = 0, passes = 0;
const check = (name, cond, detail = '') => { if (cond) passes++; else fails++; console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail && !cond ? '   <- ' + detail : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const EXPECT_D4_ST = [
  'M101 := (X0 OR M101) AND NOT M102 AND NOT M103;',
  'M102 := ((M101 AND X2) OR M102) AND NOT M103;',
  'M103 := ((M102 AND X4) OR M103) AND NOT X3;',
  'Y0 := M101;', 'Y2 := M102;', 'Y1 := M103;',
];

async function helpers(page) {
  const text = async s => (await page.textContent(s)).trim();
  const attr = (s, a) => page.getAttribute(s, a);
  const hasClass = (s, c) => page.$eval(s, (el, c) => el.classList.contains(c), c);
  const stLines = s => page.$$eval(s + ' .ln code', els => els.map(e => e.innerText.trim()));
  const stVals = s => page.$$eval(s + ' .ln .val', els => els.map(e => e.textContent.trim()));
  const hlLines = s => page.$$eval(s + ' .ln.hl code', els => els.map(e => e.innerText.trim()));
  const hlCount = s => page.$$eval(s + ' rect.hl', els => els.length);
  const scanNum = async s => parseInt(await text(s), 10);
  const pixelsNear = (canvasSel, cssVar) => page.evaluate(([sel, v]) => {
    const c = document.querySelector(sel); const g = c.getContext('2d');
    const hex = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 10 && Math.abs(d[i + 1] - gg) < 10 && Math.abs(d[i + 2] - b) < 10 && d[i + 3] > 200) n++;
    return n;
  }, [canvasSel, cssVar]);
  const vars = s => page.$$eval(s + ' li', els => Object.fromEntries(els.map(li => [li.children[0].textContent.trim(), li.children[1].textContent.trim()])));
  return { text, attr, hasClass, stLines, stVals, hlLines, hlCount, scanNum, pixelsNear, vars };
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForSelector('#d5-ladder svg');
  const H = await helpers(page);
  const { text, attr, hasClass, stLines, stVals, hlLines, hlCount, scanNum, pixelsNear, vars } = H;

  console.log('\n== page ==');
  check('title', (await page.title()) === 'ラダー→ST 変換のしくみ', await page.title());
  const tocOk = await page.$$eval('.toc a[href^="#"]', as => as.every(a => document.querySelector(a.getAttribute('href'))));
  check('toc: 6 chapter links all resolve', tocOk && (await page.$$eval('.toc a[href^="#"]', a => a.length)) === 6);
  check('link to part 2 present', (await page.$$eval('.toc a[href^="https://claude.ai/artifact/"]', a => a.length)) === 1);
  check('all 8 ladders rendered as svg', (await page.$$eval('.ladder svg.ld', s => s.length)) === 8);

  console.log('\n== demo 1: scan loop ==');
  check('initial SCAN 0000', await text('#d1-scan') === '0000');
  check('initial ST line', eq(await stLines('#d1-st'), ['Y0 := X0;']), JSON.stringify(await stLines('#d1-st')));
  check('initial ST value FALSE', eq(await stVals('#d1-st'), ['FALSE']));
  check('initial no highlight', await hlCount('#d1-ladder') === 0);
  await page.click('#d1-sw');
  check('switch latches ON', await attr('#d1-sw', 'aria-pressed') === 'true' && await text('#d1-sw .stt') === 'ON');
  await page.click('#d1-step');
  await sleep(80);
  check('phase ① active right after click', await hasClass('#d1-p0', 'active'));
  check('step button disabled during scan', await page.$eval('#d1-step', b => b.disabled));
  check('input image copied in phase ①', await text('#d1-img') === 'ON');
  check('lamp still OFF before phase ③', !(await hasClass('#d1-lamp', 'on')));
  await sleep(400);
  check('phase ② active', await hasClass('#d1-p1', 'active'));
  check('ST shows TRUE after execute', eq(await stVals('#d1-st'), ['TRUE']));
  await page.waitForFunction(() => document.querySelector('#d1-scan').textContent === '0001', null, { timeout: 4000 });
  check('SCAN 0001 after full scan', await text('#d1-scan') === '0001');
  check('lamp ON after phase ③', await hasClass('#d1-lamp', 'on'));
  check('contact + coil highlighted (2)', await hlCount('#d1-ladder') === 2, String(await hlCount('#d1-ladder')));
  check('no phase active at rest', !(await hasClass('#d1-p0', 'active')) && !(await hasClass('#d1-p1', 'active')) && !(await hasClass('#d1-p2', 'active')));
  check('step button re-enabled', !(await page.$eval('#d1-step', b => b.disabled)));
  await page.click('#d1-sw'); await page.click('#d1-step');
  await page.waitForFunction(() => document.querySelector('#d1-scan').textContent === '0002', null, { timeout: 4000 });
  check('switch OFF → lamp OFF next scan', !(await hasClass('#d1-lamp', 'on')) && await hlCount('#d1-ladder') === 0);

  console.log('\n== chapter 2: clickable legend ==');
  check('4 legend cards', (await page.$$eval('#legend .card', c => c.length)) === 4);
  check('a接点 ST', eq(await stLines('#lgst-0'), ['Y0 := X0;']) && eq(await stVals('#lgst-0'), ['FALSE']));
  await page.click('#lg-0 .hit[data-dev="X0"]');
  check('a接点: click X0 → TRUE, 2 highlights', eq(await stVals('#lgst-0'), ['TRUE']) && await hlCount('#lg-0') === 2);
  check('b接点 initially TRUE (NOT X0)', eq(await stLines('#lgst-1'), ['Y0 := NOT X0;']) && eq(await stVals('#lgst-1'), ['TRUE']));
  await page.click('#lg-1 .hit[data-dev="X0"]');
  check('b接点: click X0 → FALSE', eq(await stVals('#lgst-1'), ['FALSE']));
  check('直列 ST', eq(await stLines('#lgst-2'), ['Y0 := X0 AND X1;']));
  await page.click('#lg-2 .hit[data-dev="X0"]');
  check('直列: X0 only → FALSE', eq(await stVals('#lgst-2'), ['FALSE']));
  await page.click('#lg-2 .hit[data-dev="X1"]');
  check('直列: X0 and X1 → TRUE', eq(await stVals('#lgst-2'), ['TRUE']));
  check('並列 ST', eq(await stLines('#lgst-3'), ['Y0 := X0 OR X1;']));
  await page.click('#lg-3 .hit[data-dev="X1"]');
  check('並列: X1 only → TRUE', eq(await stVals('#lgst-3'), ['TRUE']));

  console.log('\n== demo 3: self-holding ==');
  check('ST lines auto-generated', eq(await stLines('#d3-st'), ['M100 := (X0 OR M100) AND NOT X1;', 'Y0 := M100;']), JSON.stringify(await stLines('#d3-st')));
  check('initial FALSE', eq(await stVals('#d3-st'), ['FALSE', 'FALSE']));
  await page.click('#d3-x0'); await page.click('#d3-step');
  check('start pressed + scan → M100, Y0 TRUE', eq(await stVals('#d3-st'), ['TRUE', 'TRUE']) && await hasClass('#d3-lamp', 'on') && await text('#d3-scan') === '0001');
  await page.click('#d3-x0'); await page.click('#d3-step');
  check('start released + scan → still TRUE (self hold)', eq(await stVals('#d3-st'), ['TRUE', 'TRUE']) && await attr('#d3-x0', 'aria-pressed') === 'false');
  await page.click('#d3-step');
  check('one more scan → still TRUE', eq(await stVals('#d3-st'), ['TRUE', 'TRUE']));
  await page.click('#d3-x1'); await page.click('#d3-step');
  check('stop pressed + scan → FALSE', eq(await stVals('#d3-st'), ['FALSE', 'FALSE']) && !(await hasClass('#d3-lamp', 'on')));
  await page.click('#d3-x1'); await page.click('#d3-step');
  check('stop released → stays FALSE', eq(await stVals('#d3-st'), ['FALSE', 'FALSE']));
  check('trace drew blue bars', (await pixelsNear('#d3-trace', '--on')) > 50, String(await pixelsNear('#d3-trace', '--on')));
  await page.click('#d3-run');
  check('auto button shows stop state', await hasClass('#d3-run', 'on') && (await text('#d3-run')).includes('停止'));
  await sleep(800);
  const s3a = await scanNum('#d3-scan');
  check('auto run advances scans', s3a >= 7, String(s3a));
  await page.click('#d3-run');
  await sleep(400);
  check('auto stopped, counter frozen', (await scanNum('#d3-scan')) === s3a && (await text('#d3-run')).includes('自動'));
  await page.click('#d3-reset');
  check('reset clears everything', await text('#d3-scan') === '0000' && eq(await stVals('#d3-st'), ['FALSE', 'FALSE']) && await attr('#d3-x0', 'aria-pressed') === 'false');

  console.log('\n== demo 4: step chain vs state machine ==');
  check('opens mid-cycle at SCAN 0012', await text('#d4-scan') === '0012');
  check('opens with step = 1 (FWD)', (await text('#d4-stepbig')).startsWith('step = 1'));
  check('opens with reading 工程 1', (await text('#d4-reading')).includes('工程 1'));
  check('direct translation lines', eq(await stLines('#d4-st1'), EXPECT_D4_ST), JSON.stringify(await stLines('#d4-st1')));
  check('SM highlight on FWD branch', (await hlLines('#d4-st2')).some(l => l.startsWith('FWD:')));
  const rodX = await page.$eval('#d4-plant .rod', l => +l.getAttribute('x2'));
  check('cylinder rod extended to pos 60 (x2≈294)', Math.abs(rodX - 294) < 1, String(rodX));
  await page.click('#d4-reset');
  check('reset → SCAN 0000, step 0, 全部 OFF', await text('#d4-scan') === '0000' && (await text('#d4-stepbig')).startsWith('step = 0') && (await text('#d4-reading')).includes('全部 OFF'));
  let v = await vars('#d4-vars');
  check('reset → only lsBwd (X3) TRUE', v['lsBwd ← X3'] === 'TRUE' && v['lsFwd ← X2'] === 'FALSE' && v['solFwd → Y0'] === 'FALSE', JSON.stringify(v));
  check('reset → rod retracted, X3 sensor lit', (await page.$eval('#d4-plant .rod', l => +l.getAttribute('x2'))) === 96 && (await page.$$eval('#d4-plant .ls.on', e => e.length)) === 1);
  await page.click('#d4-start');
  check('start button pending ON', await text('#d4-start .stt') === 'ON');
  await page.click('#d4-step');
  check('1 scan → M101/Y0 TRUE, start consumed', eq(await stVals('#d4-st1'), ['TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE', 'FALSE']) && await text('#d4-start .stt') === 'OFF');
  check('1 scan → ST step = 1', (await text('#d4-stepbig')).startsWith('step = 1'));
  await page.click('#d4-step10'); await page.click('#d4-step10');
  check('after 21 scans: transition scan, M101 and M102 both ON', eq(await stVals('#d4-st1'), ['TRUE', 'TRUE', 'FALSE', 'TRUE', 'TRUE', 'FALSE']) && await text('#d4-scan') === '0021', JSON.stringify(await stVals('#d4-st1')));
  check('reading says 同時に ON', (await text('#d4-reading')).includes('同時に ON'), await text('#d4-reading'));
  v = await vars('#d4-vars');
  check('ST side already step 2 with solFwd FALSE (the 1-scan difference)', (await text('#d4-stepbig')).startsWith('step = 2') && v['solFwd → Y0'] === 'FALSE' && v['clamp → Y2'] === 'FALSE', JSON.stringify(v));
  check('amber mismatch marker drawn in trace', (await pixelsNear('#d4-trace', '--warn')) > 5, String(await pixelsNear('#d4-trace', '--warn')));
  await page.click('#d4-step');
  check('next scan: only M102 ON → 工程 2', eq(await stVals('#d4-st1'), ['FALSE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE']) && (await text('#d4-reading')).includes('工程 2'));
  // run the rest of the cycle automatically and record the ST step sequence
  await page.click('#d4-run');
  const seq = ['2']; const t0 = Date.now(); let idle = false;
  while (Date.now() - t0 < 20000) {
    const st = (await text('#d4-stepbig')).match(/step = (\d)/)[1];
    if (seq[seq.length - 1] !== st) seq.push(st);
    if (st === '0' && seq.includes('3')) { idle = true; break; }
    await sleep(25);
  }
  await page.click('#d4-run');
  check('auto run completes the cycle 2 → 3 → 0', idle && eq(seq, ['2', '3', '0']), JSON.stringify(seq));
  await sleep(200);
  const s4 = await scanNum('#d4-scan');
  check('cycle length plausible (45-50 scans)', s4 >= 45 && s4 <= 50, String(s4));
  check('back to idle: all outputs FALSE', eq(await stVals('#d4-st1'), ['FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE']));
  v = await vars('#d4-vars');
  check('back to idle: ST vars FALSE, lsBwd TRUE', v['solFwd → Y0'] === 'FALSE' && v['clamp → Y2'] === 'FALSE' && v['solBwd → Y1'] === 'FALSE' && v['lsBwd ← X3'] === 'TRUE', JSON.stringify(v));
  check('back to idle: rod retracted, jaws open', (await page.$eval('#d4-plant .rod', l => +l.getAttribute('x2'))) === 96 && !(await page.$eval('#d4-plant .jaw', j => j.classList.contains('on'))));
  check('SM highlight back on IDLE', (await hlLines('#d4-st2')).some(l => l.startsWith('IDLE:')));
  check('trace shows blue + amber', (await pixelsNear('#d4-trace', '--on')) > 200 && (await pixelsNear('#d4-trace', '--warn')) > 5);

  console.log('\n== demo 5: rung order ==');
  check('default order A→B', await page.isChecked('#d5-ab') && eq(await stLines('#d5-st'), ['M1 := X0;', 'Y0 := M1;']));
  await page.click('#d5-x0'); await page.click('#d5-step');
  check('A→B: Y0 ON in the same scan', eq(await stVals('#d5-st'), ['TRUE', 'TRUE']) && (await text('#d5-msg')).includes('遅れ 0 スキャン'), await text('#d5-msg'));
  await page.click('label:has(#d5-ba)');
  check('switch to B→A resets and reorders', await page.isChecked('#d5-ba') && await text('#d5-scan') === '0000' && await attr('#d5-x0', 'aria-pressed') === 'false' && eq(await stLines('#d5-st'), ['Y0 := M1;', 'M1 := X0;']));
  await page.click('#d5-x0'); await page.click('#d5-step');
  check('B→A scan 1: M1 ON but Y0 still OFF', eq(await stVals('#d5-st'), ['FALSE', 'TRUE']) && (await text('#d5-msg')).includes('まだ OFF'), await text('#d5-msg'));
  await page.click('#d5-step');
  check('B→A scan 2: Y0 ON, 遅れ 1 スキャン', eq(await stVals('#d5-st'), ['TRUE', 'TRUE']) && (await text('#d5-msg')).includes('遅れ 1 スキャン'), await text('#d5-msg'));
  await page.click('#d5-reset');
  check('reset', await text('#d5-scan') === '0000' && eq(await stVals('#d5-st'), ['FALSE', 'FALSE']));

  console.log('\n== theme ==');
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await sleep(50);
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('data-theme=dark changes body background', bgLight !== bgDark && bgDark === 'rgb(14, 19, 25)', bgLight + ' → ' + bgDark);
  check('dark: trace redrawn with dark accent', (await pixelsNear('#d4-trace', '--on')) > 200);
  check('dark: energized wire uses dark accent', (await page.$eval('#d4-ladder .w.on, #d3-ladder .w.on, #d1-ladder .w', el => getComputedStyle(el).stroke)) !== '');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  check('data-theme=light restores', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === bgLight);

  console.log('\n== errors ==');
  check('no page errors / console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  console.log('\n== phone width (400px) ==');
  const m = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mp = await m.newPage(); const merr = [];
  mp.on('pageerror', e => merr.push(e.message));
  await mp.goto(url); await mp.waitForSelector('#d5-ladder svg');
  const sw = await mp.evaluate(() => [document.scrollingElement.scrollWidth, window.innerWidth]);
  check('no horizontal page scroll at 400px', sw[0] <= sw[1], sw.join(' > '));
  const wide = await mp.$$eval('body *', els => els.filter(e => {
    if (e.getBoundingClientRect().right <= window.innerWidth + 1) return false;
    for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return false; } /* inside a scrollable code/diagram box: allowed */
    return true;
  }).map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className : '')).slice(0, 6));
  check('no element sticks out past the viewport (outside scroll boxes)', wide.length === 0, JSON.stringify(wide));
  const scrollBoxes = await mp.$$eval('.ladder, .st, pre.blk, .tblwrap', els => els.every(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)));
  check('code/diagram boxes are their own scroll containers', scrollBoxes);
  const cols = await mp.$eval('#ch4 .cols', el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check('two-column benches stack to one column', cols === 1, String(cols));
  await mp.tap('#d3-x0'); await mp.tap('#d3-step');
  const MH = await helpers(mp);
  check('touch: self-hold demo works by tapping', eq(await MH.stVals('#d3-st'), ['TRUE', 'TRUE']));
  check('phone: no errors', merr.length === 0, merr.join('|'));
  await m.close();

  console.log('\n== reduced motion ==');
  const r = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const rp = await r.newPage(); await rp.goto(url); await rp.waitForSelector('#d1-ladder svg');
  await rp.click('#d1-sw'); await rp.click('#d1-step');
  check('reduced motion: scan completes synchronously', (await rp.textContent('#d1-scan')) === '0001' && await rp.$eval('#d1-lamp', l => l.classList.contains('on')));
  await r.close();

  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed  (${target})`);
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error('E2E crashed:', e); process.exit(2); });
