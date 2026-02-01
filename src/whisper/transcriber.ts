import { nodewhisper } from 'nodejs-whisper';

const MODEL_NAME = 'small';

export async function transcribeAudio(audioPath: string): Promise<string> {
  const transcript = await nodewhisper(audioPath, {
    modelName: MODEL_NAME,
    autoDownloadModelName: MODEL_NAME,
    removeWavFileAfterTranscription: false,
  });

  return transcript || '';
}
