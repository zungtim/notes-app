import test from 'node:test';
import assert from 'node:assert/strict';
import {panePreferences, sidebarBounds, headerBounds, clamp} from '../src/public/pane-layout.js';

test('pane preferences reject malformed storage and preserve automatic defaults', () => {
  assert.deepEqual(panePreferences(null), {version:1,sidebarWidth:null,headerHeight:null});
  assert.deepEqual(panePreferences({version:2,sidebarWidth:200}), panePreferences(null));
  assert.deepEqual(panePreferences({version:1,sidebarWidth:'200',headerHeight:NaN}), panePreferences(null));
  assert.deepEqual(panePreferences({version:1,sidebarWidth:-4,headerHeight:9999}), {version:1,sidebarWidth:72,headerHeight:2000});
});

test('sidebar bounds keep main space usable and can restore preferred width after shrinking', () => {
  const preferred = panePreferences({version:1,sidebarWidth:400,headerHeight:100});
  const small = sidebarBounds(800);
  assert.equal(clamp(preferred.sidebarWidth, small.min, small.max), 312);
  const large = sidebarBounds(1440);
  assert.equal(clamp(preferred.sidebarWidth, large.min, large.max), 400);
  assert.equal(preferred.sidebarWidth, 400);
  assert.deepEqual(sidebarBounds(500), {min:72,max:72});
});

test('header limits account for wrapped controls and reserve graph height', () => {
  assert.deepEqual(headerBounds(800,92.3), {min:93,max:360});
  assert.deepEqual(headerBounds(650,110), {min:110,max:360});
  assert.deepEqual(headerBounds(480,150), {min:150,max:192});
  assert.deepEqual(headerBounds(300,160), {min:160,max:160});
  assert.equal(clamp(20,110,90),110);
});
