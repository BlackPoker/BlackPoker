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
  const settleScroll = async () => {
    const settled = await page.evaluate(() => new Promise((resolve) => {
      let previous = scrollY, stable = 0, frames = 0;
      const check = () => {
        stable = Math.abs(scrollY - previous) < .1 ? stable + 1 : 0;
        previous = scrollY;
        if (stable >= 10 || ++frames >= 180) resolve(stable >= 10);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    assert.equal(settled, true);
  };
  const metrics = async (id) => section(id).evaluate((element) => ({
    sectionTop: element.getBoundingClientRect().top,
    boardDistance: element.querySelector('.persistent-board')?.getBoundingClientRect().top - element.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
    playerOrder: [...element.querySelectorAll('.player-half')].map((half) => half.className),
    minTarget: Math.min(...[...element.querySelectorAll('.card-slot')].map((card) => card.getBoundingClientRect().width)),
  }));
  const findings = {};
  const checkBattlefield = async (id) => {
    const layout = await section(id).evaluate((root) => {
      const rect = (selector) => { const r = root.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; };
      return { bWall: rect('.player-B .zone-bulwarks'), bSoldier: rect('.player-B .zone-soldiers'),
        aSoldier: rect('.player-A .zone-soldiers'), aWall: rect('.player-A .zone-bulwarks'),
        hiddenHand: root.querySelector('.player-B .zone-hand [data-card]') === null,
        cardWidth: root.querySelector('.board-card').getBoundingClientRect().width };
    });
    assert.ok(layout.bWall.bottom <= layout.bSoldier.top);
    assert.ok(layout.bSoldier.bottom <= layout.aSoldier.top);
    assert.ok(layout.aSoldier.bottom <= layout.aWall.top);
    assert.equal(layout.hiddenHand, true);
    assert.ok(layout.cardWidth >= 30);
    return layout;
  };
  try {
    const url = new URL(baseURL);
    // Viteの開発用Host制限を広げず、DockerホストのIPでローカルサーバーへ接続。
    if (url.hostname === 'host.docker.internal') url.hostname = (await dns.lookup(url.hostname, { family: 4 })).address;
    await page.goto(url.href);
    await page.getByRole('button', { name: 'はじめる ↓' }).click();
    assert.equal(await page.locator('[data-track="learn-more"]').getAttribute('open'), null);
    assert.equal(await page.locator('[data-track="reference"]').getAttribute('open'), null);
    for (const id of ['about', 'game-purpose', 'board-overview', 'orientation']) {
      assert.equal(await section(id).count(), 1);
      if (id === 'orientation') {
        const diagram = section(id).locator('.attack-concept');
        await diagram.scrollIntoViewIfNeeded(); await settleScroll();
        assert.equal(await diagram.locator('[data-attacker="true"]').count(), 2);
        assert.equal(await diagram.locator('[data-attacker="false"]').count(), 1);
        assert.equal(await diagram.locator('.attack-player-flow .playing-card').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, 'mobile-attack-concept-390x844.png') });
      }
      await next(id);
    }
    assert.equal(await section('entry16').count(), 0);
    const attack = 'unblocked-attack';
    // smooth scroll完了を位置で待つ（固定sleepに依存しない）。
    await page.waitForFunction(() => Math.abs(document.getElementById('unblocked-attack').getBoundingClientRect().top - 60) < 2);
    findings.mobile = await metrics(attack);
    findings.mobileLayout = await checkBattlefield(attack);
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
    await settleScroll();
    assert.match(await card('first-battle', 'B', 'C6').getAttribute('aria-label'), /アタック中/);
    await card('first-battle', 'A', 'H7').click();
    assert.match(await card('first-battle', 'A', 'H7').getAttribute('aria-label'), /縦向き ブロッカー/);
    await page.screenshot({ path: path.join(output, 'mobile-block-390x844.png') });
    await complete('first-battle');
    assert.match(await section('first-battle').locator('.combat-result').textContent(), /ライフ.*減らない/);
    await section('first-battle').locator('.persistent-board').screenshot({ path: path.join(output, 'mobile-block-board.png') });
    await next('first-battle');
    await settleScroll();
    const wall = 'bulwark-block';
    await card(wall, 'A', 'C6').click();
    assert.match(await card(wall, 'A', 'C6').getAttribute('aria-label'), /裏向き 縦向き/);
    await waitForPrompt(wall, 'あなたの裏向きの防壁');
    await card(wall, 'A', 'C6').click();
    assert.match(await card(wall, 'A', 'C6').getAttribute('aria-label'), /表向き 縦向き/);
    await waitForPrompt(wall, 'あなたの♣6');
    await card(wall, 'A', 'C6').click();
    await zone(wall, 'A', 'grave').getByRole('button', { name: 'PLAYER Aの墓地へ移す' }).click();
    await complete(wall);
    assert.match(await section(wall).locator('.combat-result').textContent(), /数字が一致.*墓地.*減らない/);
    await section(wall).locator('.scene-result').scrollIntoViewIfNeeded(); await settleScroll();
    await page.screenshot({ path: path.join(output, 'mobile-wall-result-390x844.png') });
    assert.equal(await page.locator('[data-section-id]').count(), 7);
    await next(wall);
    await card('soldier', 'A', 'D5').click();
    await waitForPrompt('soldier', 'ライフの一番上');
    await card('soldier', 'A', 'S3').click();
    await card('soldier', 'A', 'C6').click(); // 墓地の既存カードを宛先としてタップ
    await waitForPrompt('soldier', 'あなたの♠2');
    await card('soldier', 'A', 'S2').click();
    await zone('soldier', 'A', 'soldiers').getByRole('button', { name: 'PLAYER Aの兵士へ移す' }).click();
    await complete('soldier'); await next('soldier');
    await section('pass-turn').getByRole('button', { name: 'エンド', exact: true }).click();
    await complete('pass-turn'); await next('pass-turn');
    await page.waitForFunction(() => { const r = document.getElementById('first-game-ready').getBoundingClientRect(); return r.top >= 58 && r.bottom < innerHeight; });
    await settleScroll();
    await page.screenshot({ path: path.join(output, 'mobile-milestone-390x844.png') });
    await section('first-game-ready').getByRole('button', { name: '実物カードで遊ぶ →' }).click();
    assert.equal(await page.getByLabel('段階的な遊び方').isVisible(), false);
    await next('entry16');
    for (let i = 0; i < 6; i++) await section('real-game').getByRole('button', { name: /準備できた/ }).last().click();
    await section('real-game').getByRole('radio', { name: 'PLAYER A', exact: true }).check();
    for (let i = 0; i < 2; i++) await section('real-game').getByRole('button', { name: /準備できた/ }).last().click();
    await section('real-game').getByRole('button', { name: '対戦を始める', exact: true }).click();
    await page.locator('#after-game').waitFor();
    assert.equal(await page.getByLabel('まず遊ぶの進捗').textContent().then((v) => v.includes('12 / 12')), true);
    assert.equal(await section('bulwark').count(), 0);
    assert.equal(await section('up').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    findings.mobileFullRoute = '表紙から実物9操作・対戦開始まで完了、応用の強制なし';
    await settleScroll();
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, -700);
    await page.waitForFunction((before) => scrollY < before - 500, scrollBefore);
    assert.equal(await section('first-battle').count(), 1);
    await page.getByRole('button', { name: '目次を開く' }).click();
    await page.getByRole('complementary', { name: 'HowToの目次' }).getByRole('button', { name: /BlackPokerとは/ }).click();
    assert.equal(await page.getByRole('button', { name: '目次を開く' }).getAttribute('aria-expanded'), 'false');
    assert.match(page.url(), /#about$/);
    assert.equal(await section(wall).count(), 1);
    await settleScroll();
    await page.getByRole('button', { name: '目次を開く' }).click();
    await page.waitForFunction(() => {
      const drawer = document.querySelector('.sidebar-wrap');
      return getComputedStyle(drawer).transform === 'matrix(1, 0, 0, 1, 0, 0)';
    });
    const drawerRect = await page.getByRole('complementary', { name: 'HowToの目次' }).boundingBox();
    assert.equal(drawerRect.y, 0);
    assert.ok(drawerRect.height >= 840);
    await page.screenshot({ path: path.join(output, 'mobile-toc-390x844.png') });
    await page.getByRole('button', { name: 'メニューを閉じる', exact: true }).click();

    await page.setViewportSize({ width: 1440, height: 900 });
    const contents = page.getByRole('complementary', { name: 'HowToの目次' });
    await contents.getByRole('button', { name: /カードの向き/ }).click();
    await section('orientation').locator('.attack-concept').scrollIntoViewIfNeeded(); await settleScroll();
    await page.screenshot({ path: path.join(output, 'desktop-attack-concept-1440x900.png') });
    await contents.getByRole('button', { name: /兵士で守ってみる/ }).click();
    await section('first-battle').getByRole('button', { name: /もう一度やる/ }).click();
    await card('first-battle', 'A', 'H7').press('Enter');
    await complete('first-battle');
    await contents.getByRole('button', { name: /兵士を召喚する/ }).click();
    const summon = 'soldier';
    await section(summon).getByRole('button', { name: /もう一度やる/ }).click();
    await waitForPrompt(summon, '裏向きの防壁');
    await card(summon, 'A', 'D5').press('Enter');
    await waitForPrompt(summon, 'ライフの一番上');
    await card(summon, 'A', 'S3').scrollIntoViewIfNeeded(); await settleScroll();
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
    findings.desktopLayout = await checkBattlefield(attack);
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
    await contents.locator('[data-track="learn-more"] > summary').click();
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
    assert.equal(await section('pass-turn').count(), 1); // 以前の本文を保持
    await contents.getByRole('button', { name: /カウンター/ }).click();
    assert.match(page.url(), /#counter$/);
    assert.ok((await section('counter').textContent()).includes('準備中'));
    await section('counter').getByText('解説と公式ルールを見る', { exact: true }).click();
    assert.ok(await section('counter').getByRole('link').count() > 0);
    await page.getByRole('button', { name: 'ルール早見', exact: true }).click();
    await page.getByRole('dialog', { name: 'ルール早見' }).waitFor();
    findings.reference = '応用直行・hash・折りたたみ公式リンク・早見ダイアログ確認';
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', ...findings, screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
