import 'dotenv/config';
import { pickRandomImage } from './images.js';

export async function postBlog(page, article) {
  const {
    naviName,
    title,
    slug,
    description,
    h1Text,
    keywords,
    tags = [],
    bodyHtml,
    category,
  } = article;

  console.log(`📝 投稿開始: ${title}`);

  const easyAddUrl = new URL('newpages/simple-add/blog/', process.env.ADMIN_URL).href;
  await page.goto(easyAddUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.locator('#page_name').fill(naviName || title);

  for (const tag of tags) {
    await page.locator('#inputTag').fill(tag);
    await page.locator('button:has-text("追加")').first().click().catch(() => {});
    await page.waitForTimeout(250);
  }

  await page.evaluate(({ title, description, keywords, h1Text }) => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (el && val) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    set('#slug', slug);
    set('#page_title', title);
    set('#page_description', description);
    set('input[name="Newpages[keywords]"]', keywords);
    set('#page_h1', h1Text || title);

    const displayPublic = document.querySelector('#newpages-display-flag-1');
    if (displayPublic) {
      displayPublic.checked = true;
      displayPublic.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { title, description, keywords, h1Text });

  await setEditorHtml(page, bodyHtml);

  if (category) {
    await page.evaluate((cat) => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"][name*="blog_categories"]');
      for (const cb of checkboxes) {
        const label = document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim() ||
          cb.closest('label')?.textContent?.trim() || '';
        if (label === cat || label.includes(cat)) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, category);
  }

  await page.evaluate(({ fb, tw }) => {
    const fbCb = document.querySelector('#facebook_flag');
    const twCb = document.querySelector('#twitter_flag');
    if (fbCb) { fbCb.checked = fb; fbCb.dispatchEvent(new Event('change', { bubbles: true })); }
    if (twCb) { twCb.checked = tw; twCb.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { fb: process.env.SNS_FACEBOOK === 'true', tw: process.env.SNS_TWITTER === 'true' });

  if (article.publishAt) {
    await page.evaluate((dateStr) => {
      const el = document.querySelector('input[name="Newpages[release_date]"]');
      if (el) {
        el.value = dateStr;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, article.publishAt);
    console.log(`📅 公開日時設定: ${article.publishAt}`);
  }

  if (process.env.SKIP_IMAGE !== 'true') {
    const eyecatchImage = pickRandomImage();
    if (eyecatchImage) {
      await setEyecatchImage(page, eyecatchImage);
    }
  }

  await page.screenshot({ path: `debug-before-submit-${Date.now()}.png`, fullPage: true });

  if (process.env.DRY_RUN === 'true') {
    console.log('🟡 DRY_RUN モード: 登録ボタンは押しません');
    return { success: true, dryRun: true };
  }

  const networkRequests = [];
  page.on('request', req => {
    if (req.method() === 'POST') networkRequests.push({ url: req.url(), method: req.method() });
  });
  page.on('response', async res => {
    if (res.request().method() === 'POST' && res.url().includes('blog')) {
      networkRequests.push({ url: res.url(), status: res.status() });
    }
  });

  const beforeUrl = page.url();

  const submitResult = await page.evaluate(() => {
    const form = document.forms.MainForm || document.querySelector('form[name="MainForm"]');
    if (!form) return { ok: false, reason: 'MainForm not found' };
    if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances) {
      Object.values(CKEDITOR.instances).forEach(e => e.updateElement());
    }
    form.submit();
    return { ok: true, action: form.action };
  });
  console.log('🚀 form.submit():', submitResult);

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(6000); // CMS側の保存・リダイレクト完了を待つ

  const afterUrl = page.url();
  await page.screenshot({ path: `debug-after-submit-${Date.now()}.png`, fullPage: true });

  console.log('📡 POSTリクエスト:', networkRequests);
  console.log(`URL: ${beforeUrl} → ${afterUrl}`);

  return { success: true, url: afterUrl, urlChanged: beforeUrl !== afterUrl, networkRequests };
}

async function setEyecatchImage(page, image) {
  const result = await page.evaluate(({ filename, url }) => {
    const hidden = document.querySelector('#upload_image_hidden');
    if (!hidden) return 'no-hidden';
    hidden.value = filename;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));

    const preview = document.querySelector('#upload_image');
    if (preview) {
      preview.src = url;
      preview.style.display = 'block';
    }
    return 'ok';
  }, image);
  console.log(`🖼️ アイキャッチ設定: ${image.filename} (${result})`);
}

async function setEditorHtml(page, html) {
  const result = await page.evaluate((bodyHtml) => {
    if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances) {
      const keys = Object.keys(CKEDITOR.instances);
      if (keys.length > 0) {
        const editor = CKEDITOR.instances[keys[0]];
        editor.setData(bodyHtml);
        editor.updateElement();
        const ta = document.querySelector('textarea[name="editor"]');
        if (ta) {
          ta.value = bodyHtml;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return 'ckeditor';
      }
    }
    const ta = document.querySelector('textarea[name="editor"]');
    if (ta) {
      ta.value = bodyHtml;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'textarea';
    }
    return 'none';
  }, html);
  console.log(`📝 本文入力方式: ${result}`);
}
