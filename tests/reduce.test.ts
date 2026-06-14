import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../src/reduce.js';

const BODY_SENTENCE =
  'The quick brown fox jumps over the lazy dog and then keeps on running across the meadow.';

const NOISY_HTML = `<!doctype html>
<html>
  <head>
    <style>.x { color: red; } /* a big pile of css rules here to bloat tokens */</style>
    <script>window.analytics = function(){ /* tracking junk that should be removed */ };</script>
  </head>
  <body>
    <nav class="site-nav">
      <ul><li>Home</li><li>About</li><li>Contact</li><li>Login</li><li>Signup</li></ul>
    </nav>
    <header class="masthead">SiteName Mega Header With Logo And Search</header>
    <div class="cookie-banner">We use cookies. Accept all cookies to continue browsing.</div>
    <main>
      <article>
        <h1>Article Title</h1>
        <p>${BODY_SENTENCE}</p>
      </article>
    </main>
    <aside class="sidebar">Related links, advertisements, and newsletter subscribe form.</aside>
    <footer class="page-footer">Copyright 2026. All rights reserved. Privacy policy and terms.</footer>
    <script>console.log('more noise at the bottom of the page');</script>
  </body>
</html>`;

describe('htmlToMarkdown', () => {
  const md = htmlToMarkdown(NOISY_HTML);

  it('keeps the primary body text', () => {
    expect(md).toContain('Article Title');
    expect(md).toContain('quick brown fox');
  });

  it('strips nav / script / footer / header / aside noise', () => {
    expect(md).not.toContain('window.analytics');
    expect(md).not.toContain('color: red');
    expect(md).not.toMatch(/Home.*About.*Contact/s);
    expect(md).not.toContain('Copyright 2026');
    expect(md).not.toContain('Mega Header');
    expect(md).not.toContain('We use cookies');
    expect(md).not.toContain('newsletter subscribe');
  });

  it('produces output much shorter than the input', () => {
    expect(md.length).toBeLessThan(NOISY_HTML.length / 2);
  });
});
