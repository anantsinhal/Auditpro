const puppeteer = require('puppeteer-extra');

function getLaunchOptions() {
  const args = ['--disable-dev-shm-usage'];

  // Common for containers/CI.
  if (process.env.NODE_ENV === 'production') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return {
    headless: true,
    args
  };
}

async function generatePdfBufferFromHtml(html, pdfOptions = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('generatePdfBufferFromHtml: html must be a non-empty string.');
  }

  const browser = await puppeteer.launch(getLaunchOptions());
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });

    const buffer = await page.pdf({
      format: pdfOptions.format || 'A4',
      printBackground: typeof pdfOptions.printBackground === 'boolean' ? pdfOptions.printBackground : true,
      margin: pdfOptions.margin || { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    return buffer;
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdfBufferFromHtml };
