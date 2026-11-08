import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, API_HOST } from '../web/api.js';

test('public pages call the API at its own address; anywhere else it is same-origin', () => {
  assert.equal(API_HOST, 'https://neuro-api.sawasdeecoin.com');
  for (const h of ['neuro.sawasdeecoin.com', 'app.sawasdeecoin.com', 'zetaphy-neuro.pages.dev', 'zetaphy-hub.pages.dev']) {
    assert.equal(apiBase(h), API_HOST, h);
  }
  for (const h of ['neuro-api.sawasdeecoin.com', 'swd-amm-zetaphy-neuro.vercel.app', 'localhost:8787', '127.0.0.1:5173', 'evil.example']) {
    assert.equal(apiBase(h), '', h);
  }
});
