(function assistantWidget() {
  var root = document.getElementById('assistant-widget');
  if (!root) return;

  var toggleBtn = document.getElementById('assistant-toggle');
  var panel = document.getElementById('assistant-panel');
  var closeBtn = document.getElementById('assistant-close');
  var form = document.getElementById('assistant-form');
  var input = document.getElementById('assistant-input');
  var sendBtn = document.getElementById('assistant-send');
  var messagesEl = document.getElementById('assistant-messages');
  var errorEl = document.getElementById('assistant-error');
  var tooltipEl = document.getElementById('assistant-tooltip');
  var attachBtn = document.getElementById('assistant-attach');
  var imageInput = document.getElementById('assistant-image');

  var userId = root.getAttribute('data-user-id') || 'unknown';
  var mode = root.getAttribute('data-assistant-mode') || 'auth';
  var plan = root.getAttribute('data-user-plan') || 'free';
  var storageKey = 'auditpro_assistant_history_' + userId;
  var tipKey = 'auditpro_assistant_tip_dismissed_' + userId;
  var freeMsgLimit = 20; // UI gating; server should still enforce if needed.
  var MAX_MESSAGE_CHARS = 2000;

  var pendingImage = null; // { mimeType, data, name }
  var sessionMessages = [];

  function monthKey() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    return d.getFullYear() + '-' + m;
  }

  function usageStorageKey() {
    return 'auditpro_assistant_free_msgs_' + userId + '_' + monthKey();
  }

  function getFreeUsageCount() {
    try {
      var raw = localStorage.getItem(usageStorageKey());
      var n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function incFreeUsageCount() {
    try {
      var next = getFreeUsageCount() + 1;
      localStorage.setItem(usageStorageKey(), String(next));
      return next;
    } catch (e) {
      return null;
    }
  }

  function isFreeLimitReached() {
    if (String(plan).toLowerCase() === 'pro') return false;
    return getFreeUsageCount() >= freeMsgLimit;
  }

  function showUpgradeMessage() {
    setError('Free plan assistant limit reached. Upgrade to Pro to continue and to upload images.');
    renderMessage({
      role: 'assistant',
      content: 'Free plan limit reached. Upgrade to Pro to continue.\n\nGo to: /pricing?upgrade=1'
    });
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (attachBtn) attachBtn.disabled = true;
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.add('hidden');
    try { localStorage.setItem(tipKey, '1'); } catch (e) {}
  }

  function maybeShowTooltip(history) {
    if (!tooltipEl) return;
    try {
      if (localStorage.getItem(tipKey)) return;
    } catch (e) {
      // ignore
    }
    // Only show the tip when there's no conversation yet.
    if (!history || history.length === 0) {
      tooltipEl.classList.remove('hidden');
      // Auto-hide after a few seconds.
      setTimeout(function () {
        hideTooltip();
      }, 7000);
    }
  }

  function setError(text) {
    if (!errorEl) return;
    if (!text) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
      return;
    }
    errorEl.textContent = text;
    errorEl.classList.remove('hidden');
  }

  function openPanel() {
    if (!panel) return;
    panel.classList.remove('hidden');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    setError('');
    hideTooltip();
    if (input) input.focus();
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.add('hidden');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    setError('');
  }

  function scrollToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeText(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMessage(msg) {
    if (!messagesEl) return;

    var isAssistant = msg.role === 'assistant';
    var wrapper = document.createElement('div');
    wrapper.className = 'flex ' + (isAssistant ? 'justify-start' : 'justify-end');

    var bubble = document.createElement('div');
    bubble.className =
      'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed border ' +
      (isAssistant
        ? 'bg-white text-slate-800 border-slate-200'
        : 'bg-indigo-600 text-white border-indigo-600');

    bubble.innerHTML = escapeText(msg.content).replace(/\n/g, '<br>');

    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  function renderAll(history) {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';

    if (!history || history.length === 0) {
      renderMessage({
        role: 'assistant',
        content: 'Hi! Ask me SEO questions about your website. I’ll reply in simple, practical steps.'
      });
      return;
    }

    history.forEach(renderMessage);
  }

  function clampText(value, maxLen) {
    var text = String(value || '').trim();
    if (!maxLen || text.length <= maxLen) return text;
    return text.slice(0, maxLen);
  }

  function sanitizeHistory(history, maxItems) {
    if (!Array.isArray(history)) return [];
    var normalized = history
      .map(function (m) {
        var role = (m && m.role === 'assistant') ? 'assistant' : 'user';
        var content = clampText(m && m.content, MAX_MESSAGE_CHARS);
        if (!content) return null;
        return { role: role, content: content };
      })
      .filter(Boolean);
    return trimHistory(normalized, maxItems);
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return sanitizeHistory(Array.isArray(parsed) ? parsed : [], 50);
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history));
    } catch (e) {
      // ignore storage errors
    }
  }

  function trimHistory(history, max) {
    if (!Array.isArray(history)) return [];
    if (history.length <= max) return history;
    return history.slice(history.length - max);
  }

  function addToHistory(history, msg) {
    if (!Array.isArray(history)) history = [];
    var role = (msg && msg.role === 'assistant') ? 'assistant' : 'user';
    var content = clampText(msg && msg.content, MAX_MESSAGE_CHARS);
    if (!content) return trimHistory(history, 50);
    history.push({ role: role, content: content });
    return trimHistory(history, 50);
  }

  // Memory history is kept per-user for AI context but is NOT rendered on load
  // (prevents showing old prompts on shared devices after re-login).
  var memoryHistory = String(mode).toLowerCase() === 'guest' ? [] : loadHistory();
  maybeShowTooltip(memoryHistory);
  renderAll([]);

  if (String(mode).toLowerCase() === 'guest') {
    renderAll([{ role: 'assistant', content: 'Hi! Please log in to use the assistant.' }]);
  }

  if (String(mode).toLowerCase() === 'auth' && isFreeLimitReached()) {
    showUpgradeMessage();
  }

  function setBusy(isBusy) {
    if (!sendBtn || !input) return;
    sendBtn.disabled = !!isBusy;
    input.disabled = !!isBusy;
    sendBtn.classList.toggle('opacity-70', !!isBusy);
    sendBtn.classList.toggle('cursor-not-allowed', !!isBusy);
  }

  function addThinkingIndicator() {
    if (!messagesEl) return null;

    var wrapper = document.createElement('div');
    wrapper.className = 'flex justify-start';

    var bubble = document.createElement('div');
    bubble.className = 'max-w-[85%] rounded-2xl px-3 py-2 text-sm border bg-white text-slate-500 border-slate-200';
    bubble.textContent = 'Thinking…';

    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    scrollToBottom();

    return wrapper;
  }

  function removeThinkingIndicator(node) {
    if (!node || !node.parentNode) return;
    node.parentNode.removeChild(node);
  }

  async function sendMessage(text) {
    if (String(mode).toLowerCase() === 'guest') {
      setError('Please log in to chat.');
      return;
    }

    if (isFreeLimitReached()) {
      showUpgradeMessage();
      return;
    }

    var content = clampText(text, MAX_MESSAGE_CHARS);
    if (!content && !pendingImage) return;

    setError('');

    // Track free-plan usage locally for UX; server should still enforce.
    if (String(plan).toLowerCase() !== 'pro') {
      incFreeUsageCount();
    }

    if (content) {
      sessionMessages.push({ role: 'user', content: content });
      renderMessage({ role: 'user', content: content });
      memoryHistory = addToHistory(memoryHistory, { role: 'user', content: content });
    }

    if (pendingImage) {
      sessionMessages.push({ role: 'user', content: '[Image attached]' });
      renderMessage({ role: 'user', content: '[Image attached]' });
      memoryHistory = addToHistory(memoryHistory, { role: 'user', content: '[User attached an image]' });
    }

    saveHistory(memoryHistory);

    var thinkingNode = addThinkingIndicator();
    setBusy(true);

    try {
      var contextLines = [];
      contextLines.push('App page: ' + window.location.pathname);

      // If we're on an audit result page, try to grab the audited site URL from the page header.
      if (window.location.pathname && window.location.pathname.indexOf('/audit/') === 0) {
        var auditTitle = document.querySelector('main h1');
        if (auditTitle && auditTitle.textContent) {
          var maybeUrl = String(auditTitle.textContent).trim();
          if (maybeUrl && (maybeUrl.indexOf('http://') === 0 || maybeUrl.indexOf('https://') === 0)) {
            contextLines.push('Audited site URL: ' + maybeUrl);
          }
        }
      }

      var response = await fetch('/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: content,
          context: contextLines.join('\n'),
          page: window.location.pathname,
          history: sanitizeHistory(memoryHistory, 20),
          image: pendingImage ? { mimeType: pendingImage.mimeType, data: pendingImage.data, name: pendingImage.name } : undefined
        })
      });

      var data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      if (!response.ok || !data || !data.success) {
        var msg = (data && (data.message || data.error)) || 'Assistant request failed. Please try again.';
        setError(msg);
        return;
      }

      var reply = String(data.reply || '').trim();
      if (!reply) reply = 'Sorry — I did not get a response. Please try again.';

      sessionMessages.push({ role: 'assistant', content: reply });
      renderMessage({ role: 'assistant', content: reply });
      memoryHistory = addToHistory(memoryHistory, { role: 'assistant', content: reply });
      saveHistory(memoryHistory);
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      removeThinkingIndicator(thinkingNode);
      setBusy(false);
      pendingImage = null;
      if (imageInput) imageInput.value = '';
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      if (!panel) return;
      var isOpen = !panel.classList.contains('hidden');
      if (isOpen) closePanel();
      else openPanel();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closePanel();
    });
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', function () {
      if (String(mode).toLowerCase() !== 'auth') return;

      if (String(plan).toLowerCase() !== 'pro') {
        // Pro-only feature gate
        setError('Image upload is Pro-only. Upgrade to Pro to use it.');
        try { window.location.href = '/pricing?upgrade=1'; } catch (e) {}
        return;
      }

      if (!imageInput) return;
      imageInput.click();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', function () {
      if (!imageInput.files || imageInput.files.length === 0) return;
      var file = imageInput.files[0];

      if (String(plan).toLowerCase() !== 'pro') {
        setError('Image upload is Pro-only. Upgrade to Pro to use it.');
        pendingImage = null;
        imageInput.value = '';
        try { window.location.href = '/pricing?upgrade=1'; } catch (e) {}
        return;
      }

      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        setError('Please select a valid image file.');
        pendingImage = null;
        imageInput.value = '';
        return;
      }

      // Keep it small to avoid huge request bodies.
      var maxBytes = 2 * 1024 * 1024; // 2MB
      if (file.size > maxBytes) {
        setError('Image too large. Please use an image under 2MB.');
        pendingImage = null;
        imageInput.value = '';
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        try {
          var dataUrl = String(reader.result || '');
          var parts = dataUrl.split(',');
          if (parts.length < 2) throw new Error('bad data url');
          var base64 = parts[1];
          pendingImage = { mimeType: file.type, data: base64, name: file.name || 'image' };
          setError('');
        } catch (e) {
          setError('Failed to read image. Try again.');
          pendingImage = null;
          imageInput.value = '';
        }
      };
      reader.onerror = function () {
        setError('Failed to read image. Try again.');
        pendingImage = null;
        imageInput.value = '';
      };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!panel) return;
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      closePanel();
    }
  });

  // Close when clicking outside the panel
  document.addEventListener('click', function (e) {
    if (!panel || panel.classList.contains('hidden')) return;
    if (!root.contains(e.target)) {
      closePanel();
    }
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!input) return;
      var text = input.value;
      input.value = '';
      sendMessage(text);
    });
  }
})();
