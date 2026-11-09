export const DEMO_PASSWORD = 'demo2580';

function canvasUrl(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  paint(ctx);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function makeDemoMember(sport: string) {
  const stamp = Date.now().toString().slice(-6);
  const name = 'Demo Member';
  const code = `DM-${stamp}`;
  const portrait = canvasUrl(360, 360, (ctx) => {
    ctx.fillStyle = '#2a0a0c';
    ctx.fillRect(0, 0, 360, 360);
    ctx.fillStyle = '#5a1a1e';
    ctx.beginPath();
    ctx.arc(180, 148, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a2428';
    ctx.beginPath();
    ctx.ellipse(180, 340, 130, 120, 0, Math.PI, 0, true);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '700 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('DM', 180, 168);
  });
  const idPhoto = canvasUrl(720, 440, (ctx) => {
    ctx.fillStyle = '#1a0808';
    ctx.fillRect(0, 0, 720, 440);
    ctx.fillStyle = '#f4efe6';
    roundRect(ctx, 24, 24, 672, 392, 18);
    ctx.fill();
    ctx.fillStyle = '#8b1219';
    ctx.fillRect(24, 24, 672, 64);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '600 28px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('GYMKHANA', 48, 66);
    ctx.font = '500 16px Georgia, serif';
    ctx.textAlign = 'right';
    ctx.fillText('DEMO MEMBER ID', 672, 64);
    ctx.fillStyle = '#d7cfc2';
    ctx.fillRect(48, 116, 148, 178);
    ctx.fillStyle = '#5a1a1e';
    ctx.beginPath();
    ctx.arc(122, 178, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a2428';
    ctx.beginPath();
    ctx.ellipse(122, 268, 70, 64, 0, Math.PI, 0, true);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = '700 28px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, 220, 160);
    ctx.font = '500 18px Georgia, serif';
    ctx.fillStyle = '#444';
    ctx.fillText(`ID  ${code}`, 220, 198);
    ctx.fillText(sport || 'Badminton', 220, 230);
    ctx.fillText('Valid for testing only', 220, 262);
    ctx.fillStyle = '#8b1219';
    ctx.font = '600 14px Georgia, serif';
    ctx.fillText('NOT A GOVERNMENT DOCUMENT', 220, 304);
    ctx.fillStyle = '#888';
    ctx.font = '500 13px Georgia, serif';
    ctx.fillText('Gymkhana desk demo · Sector 19', 48, 384);
  });
  return {
    name,
    email: `demo.${stamp}@gymkhana.test`,
    password: DEMO_PASSWORD,
    mobile: `98${stamp}${String(10 + (Number(stamp) % 89)).padStart(2, '0')}`.slice(0, 10),
    portrait,
    idPhoto,
    code,
  };
}
