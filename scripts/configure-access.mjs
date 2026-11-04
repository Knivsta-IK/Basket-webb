import { emitKeypressEvents } from 'node:readline';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sealAccess } from '../src/access.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function secret(prompt) {
  if (!process.stdin.isTTY) throw new Error('Kör konfigurationen i en lokal interaktiv terminal.');
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume(); let value = '';
    const finish = () => { process.stdin.removeListener('keypress', handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const handler = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Avbrutet.')); }
      else if (key.name === 'return') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0,-1).join('');
      else if (str && !key.ctrl && !key.meta && !str.includes('\u001b')) value += str;
    };
    process.stdin.on('keypress', handler);
  });
}
try {
  console.log('Engångskonfiguration för materialbiblioteket. Inga hemligheter visas eller skrivs till disk.');
  console.log('Skapa en fine-grained GitHub-token: Knivsta-IK → endast Basket → Contents: Read and write.');
  console.log('Välj begränsad giltighetstid. Använd inte din vanliga administratörstoken.');
  console.log('Alla som får lösenordet får samma tillgång till materialet. Använd en lång, unik lösenfras.\n');
  let token = (await secret('Ny repo-begränsad token (dold): ')).trim();
  if (!token.startsWith('github_pat_')) throw new Error('Använd en fine-grained token begränsad till Basket. Vanliga administratörstoken accepteras inte.');
  const response = await fetch('https://api.github.com/repos/Knivsta-IK/Basket', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error('Nyckeln kan inte öppna materialet. Kontrollera behörighet och eventuellt organisationsgodkännande.');
  const repo = await response.json();
  if (repo.full_name !== 'Knivsta-IK/Basket' || !repo.private) throw new Error('Fel materialarkiv.');
  let password = await secret('Välj lösenfras, minst 16 tecken (dold): ');
  let repeat = await secret('Skriv lösenfrasen igen (dold): ');
  if (password !== repeat) throw new Error('Lösenfraserna stämmer inte överens.');
  const envelope = await sealAccess(token, password);
  token = ''; password = ''; repeat = '';
  await mkdir(resolve(root, 'public'), { recursive: true });
  const destination = resolve(root, 'public/access.json');
  await writeFile(`${destination}.tmp`, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  await rename(`${destination}.tmp`, destination);
  console.log('Klart. Endast krypterad data finns i public/access.json.');
  if (process.argv.includes('--publish')) {
    execFileSync('git', ['add', '--', 'public/access.json'], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['-c', 'user.name=Viktor Jonsson', '-c', 'user.email=99993714+svenviktorjonsson@users.noreply.github.com', 'commit', '-m', 'Aktivera lösenordsinloggning för materialbiblioteket', '--only', '--', 'public/access.json'], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
    console.log('Konfigurationen är skickad för publicering.');
  } else console.log('Publicera public/access.json med nästa webbversion.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
