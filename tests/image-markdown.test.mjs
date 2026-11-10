import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, safeImageURL, safeURL } from '../src/public/markdown.js';

const image = `/images/${'a'.repeat(64)}.png`;

test('saved local images render with escaped captions and a large-image control', () => {
  const html = renderMarkdown(`一段正文\n\n![<b>实验图 & "照片"</b>](${image})\n\n下一段。`);
  assert.ok(html.includes(`<img src="${image}"`));
  assert.ok(html.includes(`data-image-open="${image}"`));
  assert.ok(html.includes('alt="&lt;b&gt;实验图 &amp; &quot;照片&quot;&lt;/b&gt;"'));
  assert.ok(!html.includes('<b>实验图'));
  assert.ok(html.includes('loading="lazy"'));
});

test('arbitrary remote, executable and traversal image URLs remain text', () => {
  const unsafe = ['https://example.com/tracking.png', '//example.com/image.png', 'file:///D:/secret.png', 'data:image/png;base64,AAAA', 'javascript:alert', `/images/../${'a'.repeat(64)}.png`, `/images/${'a'.repeat(64)}.svg`, `/images/${'a'.repeat(64)}.png?x=1`, `/images/${'a'.repeat(63)}.png`];
  for (const url of unsafe) {
    assert.equal(safeImageURL(url), null);
    const html = renderMarkdown(`![图片](${url})`);
    assert.ok(!html.includes('<img'), url);
    assert.ok(!html.includes('href='), url);
    assert.ok(html.includes('image-unavailable'), url);
  }
  assert.equal(safeImageURL(image), image);
  for (const extension of ['jpg', 'webp', 'gif']) assert.ok(safeImageURL(image.replace('.png', `.${extension}`)));
});

test('image syntax in code stays literal and does not affect normal link handling', () => {
  const inline = renderMarkdown(`\`![diagram](${image})\``);
  assert.ok(!inline.includes('<img'));
  assert.ok(inline.includes('<code>![diagram]'));
  const block = renderMarkdown(`\`\`\`markdown\n![diagram](${image})\n\`\`\``);
  assert.ok(!block.includes('<img'));
  assert.ok(renderMarkdown('[paper](https://doi.org/10.1021/cr200349r)').includes('href="https://doi.org/10.1021/cr200349r"'));
  assert.equal(safeURL('file:///D:/secret'), null);
});

test('user token characters cannot impersonate generated renderer tokens', () => {
  assert.ok(!renderMarkdown(`\u00000\u0000 ![figure](${image})`).includes('undefined'));
  assert.equal((renderMarkdown(`\u00000\u0000 ![figure](${image})`).match(/<img /g) || []).length, 1);
});
