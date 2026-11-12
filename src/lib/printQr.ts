import QRCode from 'qrcode';
import { tableLabel, type TableInfo } from '../../shared/domain';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function doorCheckInUrl() {
  return `${window.location.origin}/in`;
}

export async function doorQrDataUrl(size = 640) {
  return QRCode.toDataURL(await doorCheckInUrl(), { width: size, margin: 1, errorCorrectionLevel: 'M' });
}

export async function printTableQr(table: TableInfo, cafeName = 'After Dunes') {
  const url = `${window.location.origin}/menu?table=${encodeURIComponent(table.qrCode)}`;
  const src = await QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: '#2c2218', light: '#fbf6ee' } });
  printQrHtml(
    `<article><h1>${escapeHtml(cafeName)}</h1><p>Table ${escapeHtml(tableLabel(table.name))}</p><img src="${src}" alt=""><p>${escapeHtml(url)}</p></article>`,
    `QR ${tableLabel(table.name)}`,
  );
}

export async function printActivityQr(sport: string, slug: string) {
  const url = `${window.location.origin}/in/${encodeURIComponent(slug)}`;
  const src = await QRCode.toDataURL(url, { width: 560, margin: 1 });
  printQrHtml(
    `<article><h1>Gymkhana</h1><p>${escapeHtml(sport)}</p><img src="${src}" alt="Door QR"><p>Scan with camera</p></article>`,
    `${sport} gate`,
  );
}

export async function printDoorQr() {
  const url = await doorCheckInUrl();
  const src = await doorQrDataUrl(720);
  printQrHtml(
    `<article class="door">
      <h1>Gymkhana</h1>
      <p class="tag">Door check-in</p>
      <img src="${src}" alt="Door QR code">
      <p class="hint">Register once. Then scan to enter.</p>
    </article>`,
    'Door QR',
  );
}

export async function printAllTableQr(tables: TableInfo[], cafeName = 'After Dunes') {
  const cards = await Promise.all(tables.map(async (table) => {
    const url = `${window.location.origin}/menu?table=${encodeURIComponent(table.qrCode)}`;
    const src = await QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: '#2c2218', light: '#fbf6ee' } });
    return `<article><h1>${escapeHtml(cafeName)}</h1><p>Table ${escapeHtml(tableLabel(table.name))}</p><img src="${src}" alt=""><p>${escapeHtml(url)}</p></article>`;
  }));
  printQrHtml(cards.join(''), 'Table QR codes');
}

/** Prints only the QR sheet via a hidden iframe — never the POS page. */
function printQrHtml(body: string, title: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 12mm; size: auto; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font: 16px/1.35 -apple-system, Segoe UI, sans-serif; color: #111; }
      article {
        break-inside: avoid;
        page-break-inside: avoid;
        text-align: center;
        margin: 0 auto;
        padding: 24px 16px;
        max-width: 420px;
      }
      article.door img { width: 320px; height: 320px; }
      img { width: 260px; height: 260px; image-rendering: pixelated; }
      h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.04em; }
      .tag { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
      .hint { margin: 16px 0 0; font-size: 14px; color: #444; }
      p { margin: 0 0 8px; }
    </style></head><body>${body}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win?.document;
  if (!doc || !win) {
    iframe.remove();
    throw new Error('Could not open the print sheet. Allow popups and try again.');
  }

  doc.open();
  doc.write(html);
  doc.close();

  const finish = () => {
    try {
      win.focus();
      win.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1500);
    }
  };

  const img = doc.querySelector('img');
  if (img && !img.complete) {
    img.onload = finish;
    img.onerror = finish;
    window.setTimeout(finish, 1200);
  } else {
    window.setTimeout(finish, 50);
  }
}
