// 任意の実ブラウザ検証。Playwrightは一時Docker内だけに用意し、アプリ依存へ追加しない。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const baseURL = process.env.TUTORIAL_URL || 'http://host.docker.internal:5174/';
const output = path.resolve(process.env.BROWSER_OUTPUT || 'test-results/browser');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const section = (id) => page.locator(`[data-section-id="${id}"]`);
  const card = (id, player, code) => section(id).locator(`.player-${player} .card-slot`).filter({ has: page.locator(`[data-card="${code}"]`) });
  const zone = (id, player, name) => section(id).getByTestId(`${player}-${name}`);
  const next = async (id) => section(id).getByRole('button', { name: '次へ →', exact: true }).click();
  const waitForPrompt = async (id, text) => {
    await section(id).locator('.interaction-guide').filter({ hasText: text }).waitFor();
  };
  const complete = async (id) => section(id).getByRole('status').waitFor();
  const metrics = async (id) => section(id).evaluate((element) => ({
    sectionTop: element.getBoundingClientRect().top,
    boardDistance: element.querySelector('.persistent-board')?.getBoundingClientRect().top - element.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
    playerOrder: [...element.querySelectorAll('.player-half')].map((half) => half.className),
    minTarget: Math.min(...[...element.querySelectorAll('.card-slot')].map((card) => card.getBoundingClientRect().width)),
  }));
  const findings = {};
  try {
    const url = new URL(baseURL);
    // Viteの開発用Host制限を広げず、DockerホストのIPでローカルサーバーへ接続。
    if (url.hostname === 'host.docker.internal') url.hostname = (await dns.lookup(url.hostname, { family: 4 })).address;
    await page.goto(url.href);
    await page.getByRole('button', { name: 'はじめる ↓' }).click();
    for (const id of ['about', 'game-purpose', 'entry16', 'board-overview', 'orientation']) {
      assert.equal(await section(id).count(), 1);
      await next(id);
    }
    const attack = 'unblocked-attack';
    // smooth scroll完了を位置で待つ（固定sleepに依存しない）。
    await page.waitForFunction(() => Math.abs(document.getElementById('unblocked-attack').getBoundingClientRect().top - 60) < 2);
    findings.mobile = await metrics(attack);
    assert.equal(findings.mobile.overflow, false);
    assert.ok(findings.mobile.boardDistance + findings.mobile.sectionTop < 251);
    assert.ok(findings.mobile.minTarget >= 44);
    await page.screenshot({ path: path.join(output, 'mobile-390x844.png') });
    await card(attack, 'A', 'S2').click();
    await waitForPrompt(attack, '相手はブロッカーを指定しません');
    await waitForPrompt(attack, '攻撃が通ったので');
    await complete(attack); // Bの入力なしでライフ2枚まで進む
    assert.equal(await zone(attack, 'B', 'grave').locator('[data-card="SK"]').count(), 1);
    await next(attack);
    await card('first-battle', 'A', 'H7').click();
    await card('first-battle', 'B', 'C6').click();
    await complete('first-battle');
    await next('first-battle');
    const wall = 'bulwark-block';
    await card(wall, 'A', 'C6').click(); await card(wall, 'B', 'C6').click();
    assert.match(await card(wall, 'A', 'C6').getAttribute('aria-label'), /裏向き 縦向き/);
    await waitForPrompt(wall, 'あなたの裏向きの防壁');
    await card(wall, 'A', 'C6').click();
    assert.match(await card(wall, 'A', 'C6').getAttribute('aria-label'), /表向き 縦向き/);
    await waitForPrompt(wall, 'あなたの♣6');
    await card(wall, 'A', 'C6').click();
    await zone(wall, 'A', 'grave').getByRole('button', { name: 'PLAYER Aの墓地へ移す' }).click();
    await complete(wall);
    assert.equal(await page.locator('[data-section-id]').count(), 8);
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, -700);
    await page.waitForFunction((before) => scrollY < before - 500, scrollBefore);
    assert.equal(await section('first-battle').count(), 1);
    await page.getByRole('button', { name: '目次を開く' }).click();
    await page.getByRole('complementary', { name: 'HowToの目次' }).getByRole('button', { name: /BlackPokerとは/ }).click();
    assert.equal(await page.getByRole('button', { name: '目次を開く' }).getAttribute('aria-expanded'), 'false');
    assert.match(page.url(), /#about$/);
    assert.equal(await section(wall).count(), 1);

    await page.setViewportSize({ width: 1440, height: 900 });
    const contents = page.getByRole('complementary', { name: 'HowToの目次' });
    await contents.locator('summary').filter({ hasText: '戦力を増やす' }).click();
    await contents.getByRole('button', { name: /兵士を召喚する/ }).click();
    const summon = 'soldier';
    await waitForPrompt(summon, '裏向きの防壁');
    await card(summon, 'A', 'D5').press('Enter');
    await waitForPrompt(summon, 'ライフの一番上');
    // native pointer events：マウスでライフ→墓地へドラッグ。
    const source = await card(summon, 'A', 'S3').boundingBox();
    const target = await zone(summon, 'A', 'grave').boundingBox();
    assert.ok(source && target);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.screenshot({ path: path.join(output, 'desktop-drag-1440x900.png') });
    await page.mouse.up();
    await waitForPrompt(summon, 'あなたの♠2');
    assert.equal(await zone(summon, 'A', 'grave').locator('[data-card="S3"]').count(), 1);
    await card(summon, 'A', 'S2').press('Enter');
    await zone(summon, 'A', 'soldiers').getByRole('button', { name: 'PLAYER Aの兵士へ移す' }).press('Space');
    await complete(summon);
    await contents.getByRole('button', { name: /まずは攻撃してみよう/ }).click();
    await section(attack).getByRole('button', { name: /もう一度やる/ }).click();
    await contents.getByRole('button', { name: /まずは攻撃してみよう/ }).click();
    await page.waitForFunction(() => Math.abs(document.getElementById('unblocked-attack').getBoundingClientRect().top - 20) < 2);
    findings.desktop = await metrics(attack);
    assert.equal(findings.desktop.overflow, false);
    await page.screenshot({ path: path.join(output, 'desktop-1440x900.png') });
    findings.cardColors = await section(attack).locator('.card-face').evaluateAll((cards) => [...new Map(cards.map((card) => [card.className, getComputedStyle(card).color])).entries()]);
    assert.ok(findings.cardColors.some(([name, color]) => name.includes('red-suit') && color === 'rgb(185, 28, 28)'));
    assert.ok(findings.cardColors.some(([name, color]) => name.includes('black-suit') && color === 'rgb(24, 24, 27)'));
    await page.reload();
    await section(attack).waitFor();
    assert.equal(await section(wall).count(), 1);
    assert.equal(await section(summon).getByRole('status').count(), 1);
    assert.match(page.url(), /#unblocked-attack$/);
    await contents.locator('summary').filter({ hasText: '戦力を増やす' }).click();
    await contents.getByRole('button', { name: /防壁を増やす/ }).click();
    const setup = 'bulwark';
    await card(setup, 'A', 'SA').click();
    await zone(setup, 'A', 'grave').getByRole('button', { name: 'PLAYER Aの墓地へ移す' }).click();
    await waitForPrompt(setup, 'あなたの♦8');
    await card(setup, 'A', 'D8').click();
    // 置き場の中央に既存カードがある場合も、そのカードを宛先としてタップできる。
    await card(setup, 'A', 'D5').click();
    await complete(setup);
    assert.match(await card(setup, 'A', 'D8').getAttribute('aria-label'), /裏向き 縦向き/);
    assert.equal(await section('pass-turn').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', ...findings, screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
