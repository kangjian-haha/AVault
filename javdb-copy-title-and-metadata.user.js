// ==UserScript==
// @name         JavDB 复制标题和影片信息 HTML
// @namespace    https://javdb.com/
// @version      1.1.0
// @description  在影片详情页复制标题和元数据面板的 HTML 内容
// @match        *://javdb.com/*
// @match        *://www.javdb.com/*
// @grant        GM_setClipboard
// @grant        window.onurlchange
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'javdb-copy-title-metadata-button';
  const BUTTON_CONTAINER_SELECTOR =
    'body > section > div > div.video-detail > div.video-meta-panel > div > div:nth-child(2) > nav > div.panel-block.first-block';
  const TITLE_SELECTOR = 'body > section > div > div.video-detail > h2';
  const META_PANEL_SELECTOR =
    'body > section > div > div.video-detail > div.video-meta-panel';
  const COVER_COLUMN_SELECTOR =
    'body > section > div > div.video-detail > div.video-meta-panel > div > div.column.column-video-cover';
  const COVER_IMAGE_SELECTOR = `${COVER_COLUMN_SELECTOR} > a > img`;
  const OBSERVE_TIMEOUT_MS = 10_000;

  function isVideoDetailPage() {
    return /^\/v\//.test(window.location.pathname);
  }

  function setButtonState(button, label, isError = false) {
    button.textContent = label;
    button.classList.toggle('is-danger', isError);
    button.classList.toggle('is-success', !isError && label === '已复制');

    window.setTimeout(() => {
      button.textContent = '复制信息';
      button.classList.remove('is-danger', 'is-success');
    }, 1_500);
  }

  async function copyMetadata(button) {
    const title = document.querySelector(TITLE_SELECTOR);
    const metaPanel = document.querySelector(META_PANEL_SELECTOR);
    if (!title || !metaPanel) {
      setButtonState(button, '未找到内容', true);
      return;
    }

    const html = `${title.outerHTML}\n${metaPanel.outerHTML}`;

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(html, 'text/html');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(html);
      } else {
        throw new Error('Clipboard API is unavailable');
      }

      setButtonState(button, '已复制');
    } catch (error) {
      console.error('[JavDB 复制信息] 复制失败：', error);
      setButtonState(button, '复制失败', true);
    }
  }

  function moveCoverImage() {
    const coverColumn = document.querySelector(COVER_COLUMN_SELECTOR);
    if (!coverColumn) {
      return false;
    }

    const image = document.querySelector(COVER_IMAGE_SELECTOR);
    if (!image) {
      return Boolean(coverColumn.querySelector(':scope > img'));
    }

    const link = image.parentElement;
    coverColumn.appendChild(image);
    if (link?.tagName === 'A' && link.childElementCount === 0) {
      link.remove();
    }
    return true;
  }

  function insertButton() {
    if (!isVideoDetailPage() || document.getElementById(BUTTON_ID)) {
      return Boolean(document.getElementById(BUTTON_ID));
    }

    const container = document.querySelector(BUTTON_CONTAINER_SELECTOR);
    if (!container) {
      return false;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'button is-small is-info';
    button.textContent = '复制信息';
    button.style.marginLeft = '0.5rem';
    button.addEventListener('click', () => copyMetadata(button));
    container.appendChild(button);
    return true;
  }

  function initialize() {
    if (!isVideoDetailPage()) {
      return;
    }

    const isCoverMoved = moveCoverImage();
    const isButtonInserted = insertButton();
    if (isCoverMoved && isButtonInserted) {
      return;
    }

    const observer = new MutationObserver(() => {
      const coverMoved = moveCoverImage();
      const buttonInserted = insertButton();
      if (coverMoved && buttonInserted) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
      }
    });
    const timeoutId = window.setTimeout(() => observer.disconnect(), OBSERVE_TIMEOUT_MS);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  if (typeof window.onurlchange !== 'undefined') {
    window.addEventListener('urlchange', initialize);
  }
})();
