/**
 * shoot.mjs
 *
 * Renders the app in a real browser at phone size and writes screenshots.
 * Usage: node scripts/shoot.mjs [outputDir]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'shots');
const PORT = 842;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') path = '/index.html';

  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise(resolve => server.listen(PORT, resolve));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

// iPhone-ish portrait viewport
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const shots = [];
async function shoot(name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  console.log('  shot', name);
}

const seed = settings => page.evaluateOnNewDocument(s => {
  localStorage.clear();
  if (s) localStorage.setItem('ccapp:v1', JSON.stringify({ settings: s }));
}, settings);

/** Click a button by its visible text */
async function tap(text) {
  const handle = await page.evaluateHandle(label => {
    const match = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().toLowerCase().includes(label.toLowerCase()));
    return match || null;
  }, text);

  const element = handle.asElement();
  if (!element) throw new Error(`no button matching "${text}"`);
  await element.click();
  await new Promise(r => setTimeout(r, 350));
}

const base = `http://localhost:${PORT}/`;

// --- betting screen ---
await seed(null);
await page.goto(base, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 500));
await shoot('01-betting');

// --- mid hand ---
await tap('25');
await tap('deal');
await new Promise(r => setTimeout(r, 500));

// An ace upcard opens the insurance prompt; decline so the table is showing
const insurance = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some(b => /no thanks/i.test(b.textContent)));
if (insurance) {
  await shoot('02a-insurance');
  await tap('no thanks');
}
await shoot('02-hand');

// --- menu ---
await tap('menu');
await shoot('03-menu');

// --- strategy drill ---
await tap('strategy drill');
await shoot('04-strategy-drill');

// Answer wrongly on purpose to capture the coaching panel
await page.evaluate(() => {
  const drill = window.trainer.strategyDrill;
  drill.spot.cards = [{ id: 1, suit: 'spades', rank: '4', faceUp: true },
                      { id: 2, suit: 'hearts', rank: '5', faceUp: true }];
  drill.spot.upCard = { id: 3, suit: 'clubs', rank: '7', faceUp: true };
  drill.hand = { total: 9, soft: false, pairValue: null, cardCount: 2 };
  drill.up = 7;
  drill.render();
  drill.answer('double');
});
await new Promise(r => setTimeout(r, 200));
await shoot('05-drill-wrong');

await page.evaluate(() => window.trainer.strategyDrill.destroy(true));
await new Promise(r => setTimeout(r, 200));

// --- the book ---
await tap('menu');
await tap('the book');
await shoot('06-the-book');

// --- ratings ---
await page.evaluate(() => window.trainer._openRatings());
await new Promise(r => setTimeout(r, 200));
await shoot('07-ratings');

// --- deviation drill ---
await page.evaluate(() => {
  const app = window.trainer;
  app._closeSheet();
  app._startDeviationDrill();
  const d = app.deviationDrill;
  d.entry = d.constructor && d.entry;
});
await new Promise(r => setTimeout(r, 250));
await shoot('09-deviation-drill');

await page.evaluate(() => {
  const d = window.trainer.deviationDrill;
  d.answer(d.entry.basicPlay === d.entry.atOrAbove ? d.entry.below : d.entry.atOrAbove);
});
await new Promise(r => setTimeout(r, 200));
await shoot('10-deviation-feedback');

await page.evaluate(() => window.trainer.deviationDrill.destroy(true));
await new Promise(r => setTimeout(r, 200));

// --- deviation reference ---
await page.evaluate(() => window.trainer._openDeviations());
await new Promise(r => setTimeout(r, 200));
await shoot('11-deviation-reference');
await page.evaluate(() => window.trainer._closeSheet());

// --- multi-seat table ---
await page.evaluate(() => {
  const app = window.trainer;
  app.settings.otherPlayers = 3;
  app.settings.seatIndex = 2;
  app.settings.seatDelayMs = 30;
  app._closeSheet();
  app._restart();
  app.pendingBet = 25;
  app.render();
});
await new Promise(r => setTimeout(r, 200));
await tap('deal');
await new Promise(r => setTimeout(r, 900));
await shoot('08-multi-seat');

await browser.close();
server.close();

console.log('\nWrote', shots.length, 'screenshots to', OUT);
