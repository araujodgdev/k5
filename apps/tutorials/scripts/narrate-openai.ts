import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const speechSettings = {
  model: 'gpt-4o-mini-tts',
  voice: 'marin',
  response_format: 'wav',
  speed: 1,
  instructions: 'Narre um tutorial de software em português brasileiro, com sotaque brasileiro neutro. Use voz natural, acolhedora e profissional, como uma pessoa ensinando um colega. Mantenha dicção clara, volume constante e ritmo ágil de aproximadamente 180 palavras por minuto, sem correr nem arrastar sílabas. Faça pausas curtas nas vírgulas e entre frases. Dê ênfase discreta aos nomes de botões e módulos. Evite tom publicitário, teatral ou excessivamente animado. Pronuncie Lume como lú-mi; IA como i-á; DOCX como dóc xis; Gmail como djí-meil; WhatsApp como uóts-ép; Kanban como cân-ban. Leia somente o texto fornecido, sem acrescentar saudações, explicações ou comentários. Mantenha o mesmo estilo de voz ao longo de todos os trechos.',
};

export async function narrateOpenAI(texts: string[], directory: string) {
  mkdirSync(directory, { recursive: true });
  async function generate(index: number, input: string) {
    const payload = JSON.stringify({ ...speechSettings, input });
    const hash = createHash('sha256').update(payload).digest('hex');
    const audio = resolve(directory, `${index}.wav`);
    const receipt = resolve(directory, `${index}.sha256`);
    if (existsSync(audio) && existsSync(receipt) && readFileSync(receipt, 'utf8') === hash) return;
    const fromEnvironment = process.env.OPENAI_API_KEY;
    const keyFile = process.env.OPENAI_API_KEY_FILE;
    const candidates = fromEnvironment ? [fromEnvironment] : keyFile
      ? [...new Set(readFileSync(keyFile, 'utf8').match(/sk-proj-[A-Za-z0-9_-]{20,}/g) ?? [])] : [];
    if (candidates.length !== 1 || !candidates[0]) throw new Error('Configure OPENAI_API_KEY ou OPENAI_API_KEY_FILE com uma única chave OpenAI.');
    const apiKey = candidates[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: payload, signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await new Promise(done => setTimeout(done, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`OpenAI TTS: HTTP ${response.status}, trecho ${index + 1}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Áudio WAV inválido no trecho ${index + 1}.`);
      writeFileSync(`${audio}.tmp`, bytes);
      renameSync(`${audio}.tmp`, audio);
      writeFileSync(receipt, hash);
      console.log(`Narração OpenAI ${index + 1}/${texts.length}`);
      return;
    }
  }
  for (let index = 0; index < texts.length; index += 3) {
    await Promise.all(texts.slice(index, index + 3).map((text, offset) => generate(index + offset, text)));
  }
  writeFileSync(resolve(directory, 'settings.json'), JSON.stringify(speechSettings, null, 2));
}
