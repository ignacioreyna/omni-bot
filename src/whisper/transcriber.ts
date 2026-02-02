import { nodewhisper } from 'nodejs-whisper';

const MODEL_NAME = 'small';

export async function transcribeAudio(audioPath: string): Promise<string> {
  const transcript = await nodewhisper(audioPath, {
    modelName: MODEL_NAME,
    autoDownloadModelName: MODEL_NAME,
    removeWavFileAfterTranscription: false,
  });

  // Strip Whisper timestamp markers like [00:00:00.000 --> 00:00:02.500]
  const cleaned = (transcript || '')
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return cleaned;
}
