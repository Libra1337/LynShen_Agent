import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, expect } from '@playwright/test';

const server = await createServer({ configFile: false, plugins: [svelte({compilerOptions:{runes:true}})], resolve: {alias:{$lib:resolve('src/lib')}}, server:{host:'127.0.0.1',port:1438,strictPort:true} });
await server.listen();
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = 'http://127.0.0.1:1438/tests/browser/index.html';
  await page.goto(base + '?projects');
  for (let i=1;i<=3;i++) {
    await page.getByRole('button',{name:'新项目',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    await page.getByRole('button',{name:'新会话',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    await expect(page.getByTestId('count')).toHaveText(String(i*2));
  }
  assert.equal(await page.evaluate(() => window.__calls.some(c => c.command === 'daemon_endpoint')), false);
  await page.goto(base);
  await page.getByRole('button',{name:'在浏览器中授权',exact:true}).click();
  await expect(page.getByText('ABCDEF-123456')).toBeVisible();
  assert.ok(await page.evaluate(() => window.__calls.some(c => c.command === 'plugin:opener|open_url')));
  await page.getByRole('button',{name:'取消授权',exact:true}).click();
  await page.goto(base + '?loggedIn');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'欢迎页'})).toBeVisible();
  await page.goto(base);
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('button').filter({hasText:'Openai'}).first().click();
  await expect(page.getByPlaceholder('请输入 API Key')).toBeVisible();
  await page.getByRole('button',{name:'在浏览器中授权 ChatGPT / Codex'}).click();
  await expect(page.getByRole('button',{name:'重新打开授权页面'})).toBeVisible();
  assert.ok(await page.evaluate(() => window.__calls.some(c => c.command === 'provider_oauth_start' && c.args.provider === 'openai-codex')));
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: reactive drafts, account authorization, logout, API key label, provider OAuth.');
} finally { await browser.close(); await server.close(); }
